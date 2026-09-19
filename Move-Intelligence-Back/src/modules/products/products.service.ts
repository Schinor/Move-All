import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import {
  SupplierClusterRow,
  suppliersFromCluster,
} from '../../shared/contract/supplier';
import { CreateWatchlistItemDto } from './dto/create-watchlist-item.dto';
import {
  FillMonteCarloPremisesWithAiDto,
  MonteCarloPremisesDto,
  RunMonteCarloDto,
} from './dto/run-monte-carlo.dto';
import { MONTE_CARLO_ANALYST_SYSTEM_PROMPT } from './monte-carlo-ai.prompt';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { DEFAULT_BUSINESS_RULES } from '../../shared/business-rules/business-rules.defaults';
import { computeMomentum } from '../scoring/momentum';
import { classifyQuadrant, scoreBandFromScore } from '../scoring/decision-quadrant';
import { buildRiskExplanation } from '../scoring/risk-explanation';
import {
  ParsedRecommendation,
  extractJsonObject,
  fallbackRationale,
  isQuadrantAction,
  isRawRationale,
  parseRecommendationPayload,
} from './ai-recommendation-json';

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  // C3 (decisão 9): janela 60d + comparação sobreposta com o período anterior.
  '60d': 60 * 24 * 60 * 60 * 1000,
  '3m': 90 * 24 * 60 * 60 * 1000,
  '6m': 180 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  'all': Number.MAX_SAFE_INTEGER,
};

type PremiseSource =
  | 'csv'
  | 'exchange_rate'
  | 'default'
  | 'derived_default'
  | 'override'
  | 'ai_suggestion';

type MonteCarloPremises = Required<MonteCarloPremisesDto>;

type ClusterForSimulation = {
  id: string;
  canonicalName: string;
  category: string | null;
  simulatedAt?: Date | null;
  snapshots: {
    marketplace: string;
    currency?: string | null;
    priceMin: unknown;
    salesSignalRaw: unknown;
    salesSignalType: string | null;
    reviewCount: number | null;
    rating: unknown;
    moq: number | null;
    collectedAt: Date;
    externalProductId?: string;
    sellerName?: string | null;
  }[];
};

type AiPremiseResponse = {
  premises?: MonteCarloPremisesDto;
  rationale?: string;
  warnings?: string[];
  fragile_assumptions?: string[];
};

/** Resumo do batch de simulações que alimenta a coluna "Risco" do ranking. */
export type MonteCarloBatchSummary = {
  candidates: number;
  simulated: number;
  failed: number;
  results: { product_cluster_id: string; risk_level: string; financial_score: number }[];
};

import { RedisCacheService } from '../../shared/redis/redis-cache.service';
import { DEFAULT_FX_CNY_USD, DEFAULT_FX_USD_BRL } from '../../shared/fx/fx.constants';
import {
  HistoryObservation,
  PREMISES_DATA_VERSION,
  derivePremisesFromHistory,
} from '../scoring/premises-from-history';
import {
  EMPTY_MOVE_SCORE,
  loadLatestMoveScores,
} from '../../shared/scoring/product-score-loader';
import { includeSyntheticData, syntheticSnapshotWhere } from '../../shared/synthetic-data/synthetic-data.filter';
import { buildReviewSentimentSeries } from '../../shared/scoring/review-sentiment';

/** Cenários do lote OFICIAL que grava o ProductScore (F2.4). */
const OFFICIAL_SCENARIO_COUNT = 50_000;
/** Seed fixa do lote oficial (reprodutibilidade). */
const OFFICIAL_SEED = 7;
/** Teto de clusters lidos por consulta ao procurar candidatos ao batch. */
const BATCH_CANDIDATE_SCAN = 500;
/** Universo varrido para candidatos ao lote (mesmo teto do ranking). */
const BATCH_RANKING_SCAN = 20_000;

/** Faixa configurável B1 (70/50) aplicada no backend; script só devolve métricas. */
function localScoreBand(score: number): 'green' | 'yellow' | 'red' {
  return scoreBandFromScore(score, DEFAULT_BUSINESS_RULES.moveScoreBands) ?? 'red';
}

function riskLevelFromScore(score: number): string {
  const band = localScoreBand(score);
  return band === 'green' ? 'baixo' : band === 'yellow' ? 'medio' : 'alto';
}

/** Decisão legada temporária (B1: 70/50); B3 substitui por action. */
function decisionFromScore(score: number): string {
  const band = localScoreBand(score);
  return band === 'green' ? 'AVANCAR' : band === 'yellow' ? 'AVANCAR COM RESSALVAS' : 'REPROVAR';
}

/** Série semanal de vendas (últimas 8 semanas) para o momentum no lote (B2/B3). */
function buildSalesWeekly(
  snapshots: Array<{ salesSignalRaw: unknown; collectedAt: Date }>,
): number[] {
  const points = snapshots
    .map((s) => ({
      t: s.collectedAt instanceof Date ? s.collectedAt.getTime() : NaN,
      v: Number(s.salesSignalRaw),
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0)
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) return [];
  const WEEK = 7 * 86_400_000;
  const end = points[points.length - 1].t;
  const buckets = new Array(8).fill(0);
  for (const p of points) {
    const diff = end - p.t;
    if (diff < 0 || diff >= 8 * WEEK) continue;
    const idx = 7 - Math.floor(diff / WEEK);
    buckets[idx] += p.v;
  }
  return buckets.filter((v) => v > 0).slice(-8);
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterService,
    private readonly cache?: RedisCacheService,
  ) {}

  private async cached<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    if (!this.cache) return factory();
    return this.cache.wrap(key, ttlSeconds, factory);
  }

  getSnapshots(productClusterId: string) {
    // Com INCLUDE_SYNTHETIC_DATA=false, telas de detalhe não veem snapshots sintéticos.
    return this.prisma.productListingSnapshot.findMany({
      where: { productClusterId, ...syntheticSnapshotWhere() },
      orderBy: { collectedAt: 'asc' },
      take: 5_000,
    });
  }

  async getMonteCarloDefaults(productClusterId: string) {
    return this.cached(`monte-carlo:defaults:${productClusterId}`, 3600, async () => {
      const cluster = await this.getSimulationCluster(productClusterId);
      const { premises, sources } = await this.defaultMonteCarloPremises(cluster);

      return {
        product_cluster_id: productClusterId,
        canonical_name: cluster.canonicalName,
        premises,
        premise_sources: sources,
        scenario_count: 1_000_000,
        seed: 7,
        price_scan: true,
        price_scan_scenarios: 4_000,
      };
    });
  }

  async runMonteCarloSimulation(productClusterId: string, dto: RunMonteCarloDto = {}) {
    const hasOverrides = Boolean(dto.premises && Object.keys(dto.premises).length > 0);
    const compute = async () => {
      const cluster = await this.getSimulationCluster(productClusterId);
      const { premises, sources } = await this.defaultMonteCarloPremises(cluster);
      this.applyPremiseOverrides(premises, sources, dto.premises ?? {});

      const payload = {
        premises,
        scenario_count: this.normalizedCount(dto.scenario_count, 1_000_000, 1_000_000),
        seed: dto.seed ?? 7,
        price_scan: dto.price_scan ?? true,
        price_scan_scenarios: this.normalizedCount(
          dto.price_scan_scenarios,
          4_000,
          50_000,
        ),
      };

      const result = await this.runMonteCarloPython(payload);

      // Só a simulação SEM overrides (e o lote, em simulateBatchForRanking)
      // grava riskLevel/financialScore e vira o score oficial do ranking. Um
      // cenário "e se" do usuário nunca sobrescreve o score oficial nem
      // invalida o cache do ranking (ver RELATORIO_ANALISE_DADOS_E_SCORES.md
      // seção 3.2 S7 — antes o ranking ficava não reprodutível).
      if (!hasOverrides) {
        await this.persistSimulationOutcome(productClusterId, result);
        await this.cache?.delPattern('dashboard:trends:products:*');
      }

      return {
        product_cluster_id: productClusterId,
        canonical_name: cluster.canonicalName,
        premise_sources: sources,
        is_user_scenario: hasOverrides,
        ...result,
      };
    };

    if (hasOverrides) {
      return compute();
    }
    return this.cached(`monte-carlo:sim:${productClusterId}`, 3600, compute);
  }

  /**
   * Lote OFICIAL (F2.4): deriva premissas do histórico (F2.2), roda 50.000
   * cenários com seed fixa e grava o `ProductScore` vigente por cluster
   * (sequencialmente, um spawn por vez). Sem dados suficientes, grava só a
   * confiança (`score` nulo, decisão `SEM_SCORE`). Os campos legados do
   * cluster seguem gravados até F2.7. Falha de um cluster não aborta os demais.
   */
  async simulateBatchForRanking(limit = 50): Promise<MonteCarloBatchSummary> {
    const targets = await this.findClustersNeedingSimulation(limit);
    const summary: MonteCarloBatchSummary = {
      candidates: targets.length,
      simulated: 0,
      failed: 0,
      results: [],
    };

    for (const cluster of targets) {
      try {
        const observations = this.toHistoryObservations(cluster.snapshots);
        const fxCnyUsd = await this.fxCnyUsd();
        const { premises: derived, dataConfidence } = derivePremisesFromHistory(
          observations,
          { fxCnyUsd },
        );
        if (!derived) {
          // Sem score: só a confiança, sem número (B3: ação DADOS_INSUFICIENTES).
          await this.prisma.productScore.create({
            data: {
              productClusterId: cluster.id,
              score: null,
              decision: 'SEM_SCORE',
              pVplPositivo: null,
              cvar5: null,
              vplMediano: null,
              premises: {},
              premisesHash: '',
              dataVersion: PREMISES_DATA_VERSION,
              dataConfidence,
              scenarioCount: 0,
              action: 'DADOS_INSUFICIENTES',
              momentumDirection: 'estavel',
              momentumGrowthPct: 0,
              momentumConfidence: 'insuficiente',
              scoreBand: null,
            },
          });
          summary.simulated += 1;
          continue;
        }
        // Parâmetros de negócio (D7 pendente: mantém os atuais) + derivação F2.2.
        const { premises: base } = await this.defaultMonteCarloPremises(cluster);
        const scriptPremises = {
          ...base,
          demanda_referencia: derived.demanda_referencia,
          crescimento_demanda_mensal: derived.crescimento_demanda_mensal,
          vol_crescimento: derived.incerteza_crescimento ?? 0,
          vol_demanda: derived.vol_demanda,
          vol_preco: derived.vol_preco,
          preco_venda: derived.preco_venda,
          preco_referencia: Math.round(derived.preco_venda * 0.95),
          custo_usd: derived.custo_usd,
        };
        const result = await this.runMonteCarloPython({
          premises: scriptPremises,
          scenario_count: OFFICIAL_SCENARIO_COUNT,
          seed: OFFICIAL_SEED,
          price_scan: false,
          data_version: PREMISES_DATA_VERSION,
        });
        const outcome = await this.persistSimulationOutcome(cluster.id, result);
        if (!outcome) {
          summary.failed += 1;
          continue;
        }
        const metrics = (result.metrics ?? {}) as Record<string, number>;
        const decision =
          typeof result.decision === 'string' ? result.decision : decisionFromScore(outcome.financialScore);
        // B2/B3: momentum de vendas (sem busca no lote) + quadrante + faixa.
        const salesWeekly = buildSalesWeekly(cluster.snapshots);
        const momentumTuning = DEFAULT_BUSINESS_RULES.momentum;
        const momentum = computeMomentum(
          { salesWeekly, searchWeekly: [] },
          {
            salesWeight: momentumTuning.salesWeight,
            searchWeight: momentumTuning.searchWeight,
            upThresholdPct: momentumTuning.upThresholdPct,
            downThresholdPct: momentumTuning.downThresholdPct,
          },
        );
        const band = scoreBandFromScore(outcome.financialScore, DEFAULT_BUSINESS_RULES.moveScoreBands);
        const action = classifyQuadrant({
          score: outcome.financialScore,
          scoreBand: band,
          dataConfidence,
          momentum,
          financialThreshold: DEFAULT_BUSINESS_RULES.quadrant.financialThreshold,
        });
        // B4: drivers do Monte Carlo + causas estruturais → texto de tooltip.
        const rawDrivers = Array.isArray((result as Record<string, unknown>).risk_drivers)
          ? ((result as Record<string, unknown>).risk_drivers as Array<Record<string, unknown>>)
          : [];
        const drivers = rawDrivers
          .filter((d) => typeof d?.factor === 'string' && Number.isFinite(Number(d?.share)))
          .map((d) => ({ factor: String(d.factor), share: Number(d.share) }));
        const riskTuning = DEFAULT_BUSINESS_RULES.riskCauses;
        const risk = buildRiskExplanation({
          riskLevel: outcome.riskLevel,
          premises: (result.premises ?? scriptPremises ?? {}) as Record<string, number>,
          drivers,
          tuning: {
            lowMarginPct: riskTuning.lowMarginPct,
            highImportCostPct: riskTuning.highImportCostPct,
            highInvestmentMonths:
              (riskTuning as Record<string, number>).highInvestmentMonths ?? 2,
          },
        });
        await this.prisma.productScore.create({
          data: {
            productClusterId: cluster.id,
            score: outcome.financialScore,
            decision,
            action,
            momentumDirection: momentum.direction,
            momentumGrowthPct: momentum.growthPct,
            momentumConfidence: momentum.confidence,
            scoreBand: band,
            riskExplanation: risk.text,
            riskDrivers: drivers as unknown as Prisma.InputJsonValue,
            pVplPositivo: Number.isFinite(metrics.p_vpl_positivo) ? metrics.p_vpl_positivo : null,
            cvar5: Number.isFinite(metrics.cvar_5) ? metrics.cvar_5 : null,
            vplMediano: Number.isFinite(metrics.vpl_mediano) ? metrics.vpl_mediano : null,
            premises: JSON.parse(JSON.stringify(result.premises ?? {})) as Prisma.InputJsonValue,
            premisesHash: typeof result.premises_hash === 'string' ? result.premises_hash : '',
            dataVersion:
              typeof result.data_version === 'string' ? result.data_version : PREMISES_DATA_VERSION,
            dataConfidence,
            scenarioCount: OFFICIAL_SCENARIO_COUNT,
          },
        });
        summary.simulated += 1;
        summary.results.push({
          product_cluster_id: cluster.id,
          risk_level: outcome.riskLevel,
          financial_score: outcome.financialScore,
        });
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(
          `Monte Carlo em lote falhou para o cluster ${cluster.id}: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }

    this.logger.log(
      `Monte Carlo em lote: ${summary.simulated} simulados, ${summary.failed} falhas, ${summary.candidates} candidatos.`,
    );
    if (summary.simulated > 0) {
      await this.cache?.delPattern('monte-carlo:*');
      await this.cache?.delPattern('dashboard:trends:products:*');
    }
    return summary;
  }

  /** Snapshots do cluster no formato do módulo puro F2.2. */
  private toHistoryObservations(
    snapshots: ClusterForSimulation['snapshots'],
  ): HistoryObservation[] {
    return snapshots.map((snapshot) => ({
      // Chave estável do anúncio (não da observação): o painel balanceado
      // exige o mesmo anúncio nas duas metades da janela.
      listingKey: `${snapshot.marketplace}:${snapshot.externalProductId ?? snapshot.sellerName ?? 'na'}`,
      marketplace: snapshot.marketplace,
      currency: snapshot.currency,
      priceMin: this.toPositiveNumber(snapshot.priceMin),
      salesSignal: this.toPositiveNumber(snapshot.salesSignalRaw),
      collectedAt: snapshot.collectedAt,
    }));
  }

  /** Paridade CNY→USD pela PTAX; fallback único documentado. */
  private async fxCnyUsd(): Promise<number> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { quoteCurrency: 'BRL' },
      orderBy: { capturedAt: 'desc' },
      take: 10,
    });
    const rate = (base: string): number | null => {
      const row = rows.find((item) => item.baseCurrency === base);
      const value = row ? Number(row.rate) : NaN;
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const cnyBrl = rate('CNY');
    const usdBrl = rate('USD');
    if (cnyBrl !== null && usdBrl !== null) {
      return cnyBrl / usdBrl;
    }
    return DEFAULT_FX_CNY_USD;
  }

  /**
   * Clusters que precisam de simulação: sem `simulatedAt` ou com simulação
   * anterior ao último snapshot coletado. Ordem estável por criação (o
   * ranking agora ordena pelo Move Score oficial, sem Trend Engine).
   */
  private async findClustersNeedingSimulation(
    limit: number,
  ): Promise<ClusterForSimulation[]> {
    const take = Math.max(0, Math.min(limit, BATCH_CANDIDATE_SCAN));
    if (take === 0) {
      return [];
    }

    // Com INCLUDE_SYNTHETIC_DATA=false (default), candidatos ao Monte Carlo em
    // lote só consideram snapshots reais — senão o batch simula clusters cujo
    // único histórico é a curva sintética do historical-collection.
    const clusters = (await this.prisma.productCluster.findMany({
      where: {
        cardStatus: { notIn: ['provisional', 'merged'] },
        snapshots: { some: syntheticSnapshotWhere() },
      },
      include: {
        snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' }, take: 1_000 },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH_RANKING_SCAN,
    })) as unknown as ClusterForSimulation[];

    const needsSimulation = clusters.filter((cluster) => {
      const lastSnapshot = cluster.snapshots.at(-1)?.collectedAt ?? null;
      const simulatedAt = cluster.simulatedAt ?? null;
      return (
        simulatedAt === null ||
        (lastSnapshot !== null && lastSnapshot > simulatedAt)
      );
    });

    return needsSimulation.slice(0, take);
  }

  /** Grava o resultado da simulação no cluster; deriva faixa/risco no backend (B1). */
  private async persistSimulationOutcome(
    productClusterId: string,
    result: Record<string, unknown>,
  ): Promise<{ riskLevel: string; financialScore: number } | null> {
    const financialScore = Number(result.financial_score);
    if (!Number.isFinite(financialScore)) {
      return null;
    }
    const rounded = Math.round(financialScore);
    // B1: script devolve só métricas; faixa e risco aplicados aqui (70/50).
    const riskLevel =
      typeof result.risk_level === 'string'
        ? result.risk_level
        : riskLevelFromScore(rounded);
    const outcome = { riskLevel, financialScore: rounded };
    await this.prisma.productCluster.update({
      where: { id: productClusterId },
      data: { ...outcome, simulatedAt: new Date() },
    });
    return outcome;
  }

  async fillMonteCarloPremisesWithAi(
    productClusterId: string,
    dto: FillMonteCarloPremisesWithAiDto = {},
  ) {
    const cluster = await this.getSimulationCluster(productClusterId);
    const { premises, sources } = await this.defaultMonteCarloPremises(cluster);
    this.applyPremiseOverrides(premises, sources, dto.premises ?? {});

    const aiResult = await this.callOpenRouterPremiseAnalyst({
      cluster,
      premises,
      sources,
      userNotes: dto.user_notes,
    });
    const sanitized = this.sanitizeAiPremises(aiResult.premises ?? {});
    const sourceOverrides = Object.fromEntries(
      Object.entries(sanitized)
        .filter(([key, value]) =>
          this.premiseChanged(premises[key as keyof MonteCarloPremises], value),
        )
        .map(([key]) => [key, 'ai_suggestion']),
    );

    return {
      product_cluster_id: productClusterId,
      canonical_name: cluster.canonicalName,
      premises: {
        ...premises,
        ...sanitized,
      },
      premise_sources: {
        ...sources,
        ...sourceOverrides,
      },
      rationale: aiResult.rationale ?? null,
      warnings: aiResult.warnings ?? [],
      fragile_assumptions: aiResult.fragile_assumptions ?? [],
    };
  }

  private async getSimulationCluster(productClusterId: string): Promise<ClusterForSimulation> {
    // Idem: premissas do Monte Carlo não podem se apoiar em snapshots
    // sintéticos quando INCLUDE_SYNTHETIC_DATA=false.
    const cluster = (await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      include: { snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' } } },
    })) as unknown as ClusterForSimulation | null;

    if (!cluster || cluster.snapshots.length === 0) {
      throw new NotFoundException(`Product cluster not found: ${productClusterId}`);
    }

    return cluster;
  }

  /** Fornecedores no formato do contrato (Supplier), derivados dos snapshots TradeAtlas. */
  async getSuppliers(productClusterId: string) {
    const cluster = (await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      // Com INCLUDE_SYNTHETIC_DATA=false, fornecedores derivam só de snapshots reais.
      include: { snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'desc' } } },
    })) as unknown as SupplierClusterRow | null;

    return cluster ? suppliersFromCluster(cluster) : [];
  }

  /** Série de preço no formato do contrato (Series { window, points }). */
  async getPriceHistory(productClusterId: string, window = '30d', compare?: string) {
    if (compare === 'previous') {
      const { current, previous } = await this.seriesPointsCompared(productClusterId, window, 'price');
      return { window, points: current, current, previous };
    }
    const points = await this.seriesPoints(productClusterId, window, 'price');
    return { window, points };
  }

  /** Série de reviews no formato do contrato. */
  async getReviewHistory(productClusterId: string, window = '30d', compare?: string) {
    if (compare === 'previous') {
      const { current, previous } = await this.seriesPointsCompared(productClusterId, window, 'reviews');
      return { window, points: current, current, previous };
    }
    const points = await this.seriesPoints(productClusterId, window, 'reviews');
    return { window, points };
  }

  /**
   * Avaliações positivas (4–5★), neutras (3★) e negativas (1–2★) por semana +
   * nota média, lidas da distribuição de estrelas das observações dos anúncios
   * do cluster (product_cluster_items → tracked_listings → listing_observations).
   */
  async getReviewSentiment(productClusterId: string, window = '6m') {
    const windowMs = WINDOW_MS[window] ?? Number.MAX_SAFE_INTEGER;
    const items = await this.prisma.productClusterItem.findMany({
      where: { clusterId: productClusterId },
      select: { marketplace: true, externalProductId: true },
      take: 500,
    });
    if (items.length === 0) return { window, points: [], totals: null };
    const listings = await this.prisma.trackedListing.findMany({
      where: { OR: items.map((item) => ({ source: item.marketplace, nativeId: item.externalProductId })) },
      select: { id: true },
      take: 500,
    });
    if (listings.length === 0) return { window, points: [], totals: null };
    const observations = await this.prisma.listingObservation.findMany({
      where: {
        listingId: { in: listings.map((listing) => listing.id) },
        scrapeStatus: 'ok',
        ...(includeSyntheticData() ? {} : { isSynthetic: false }),
      },
      orderBy: { observedAt: 'asc' },
      select: { listingId: true, observedAt: true, rating: true, reviewsCount: true, ratingDistribution: true },
      take: 50_000,
    });
    const series = buildReviewSentimentSeries(
      observations.map((row) => ({
        listingId: row.listingId,
        observedAt: row.observedAt,
        rating: row.rating === null ? null : Number(row.rating),
        reviewsCount: row.reviewsCount,
        distribution: row.ratingDistribution,
      })),
      windowMs,
    );
    return { window, ...series };
  }

  /** Série de volume no formato do contrato (Series { window, points }). */
  async getVolumeHistory(productClusterId: string, window = '30d', compare?: string) {
    if (compare === 'previous') {
      const { current, previous } = await this.seriesPointsCompared(productClusterId, window, 'volume');
      return { window, points: current, current, previous };
    }
    const points = await this.seriesPoints(productClusterId, window, 'volume');
    return { window, points };
  }

  /** C3: período atual + anterior de mesmo tamanho (curva anterior tracejada). */
  private async seriesPointsCompared(
    productClusterId: string,
    window: string,
    metricType: 'volume' | 'price' | 'reviews' | 'general' = 'general',
  ): Promise<{ current: Array<{ t: string; v: number }>; previous: Array<{ t: string; v: number }> }> {
    const windowMs = WINDOW_MS[window] ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isFinite(windowMs) || windowMs === Number.MAX_SAFE_INTEGER) {
      const current = await this.seriesPoints(productClusterId, window, metricType);
      return { current, previous: [] };
    }
    // Sem cache aqui (combina dois intervalos); seriesPoints tem cache próprio.
    const allSnapshots = await this.prisma.productListingSnapshot.findMany({
      where: { productClusterId, ...syntheticSnapshotWhere() },
      orderBy: { collectedAt: 'asc' },
      take: 5_000,
    });
    if (allSnapshots.length === 0) return { current: [], previous: [] };
    const latestTime = allSnapshots[allSnapshots.length - 1].collectedAt.getTime();
    const currentCutoff = latestTime - windowMs;
    const previousCutoff = latestTime - 2 * windowMs;
    const currentSnapshots = allSnapshots.filter((s) => s.collectedAt.getTime() >= currentCutoff);
    const previousSnapshots = allSnapshots.filter(
      (s) => s.collectedAt.getTime() >= previousCutoff && s.collectedAt.getTime() < currentCutoff,
    );
    const current = await this.pointsFromSnapshots(productClusterId, currentSnapshots, metricType);
    const previous = await this.pointsFromSnapshots(productClusterId, previousSnapshots, metricType);
    return { current, previous };
  }

  private async pointsFromSnapshots(
    _productClusterId: string,
    filtered: Array<{
      collectedAt: Date;
      priceMin: unknown;
      salesSignalRaw: unknown;
      reviewCount: number | null;
      currency?: string | null;
      marketplace: string;
    }>,
    metricType: 'volume' | 'price' | 'reviews' | 'general' = 'general',
  ): Promise<Array<{ t: string; v: number }>> {
    const byDate = new Map<string, { snapshots: typeof filtered; rawDate: Date }>();
    for (const snapshot of filtered) {
      const dateKey = snapshot.collectedAt.toISOString().slice(0, 10);
      const curr = byDate.get(dateKey) ?? { snapshots: [], rawDate: snapshot.collectedAt };
      curr.snapshots.push(snapshot);
      byDate.set(dateKey, curr);
    }
    const exchange = metricType === 'price' ? await this.usdBrlExchangeContext() : null;
    const exchangeRate = exchange?.rate ?? DEFAULT_FX_USD_BRL;
    const points: { t: string; v: number }[] = [];
    for (const [, { snapshots, rawDate }] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      let val = 0;
      if (metricType === 'volume') {
        val = snapshots.reduce((acc, s) => {
          const num = Number(s.salesSignalRaw);
          return acc + (Number.isFinite(num) && num > 0 ? num : 0);
        }, 0);
      } else if (metricType === 'price') {
        const validPrices = snapshots
          .map((s) => {
            const rawPrice = Number(s.priceMin);
            if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
            const isUsd =
              s.currency === 'USD' || s.marketplace === 'alibaba' || s.marketplace === 'aliexpress' || s.marketplace === '1688';
            return isUsd ? rawPrice * exchangeRate : rawPrice;
          })
          .filter((p): p is number => p !== null && p > 0);
        val = validPrices.length > 0 ? validPrices.reduce((a, b) => a + b, 0) / validPrices.length : 0;
      } else if (metricType === 'reviews') {
        val = snapshots.reduce((acc, s) => {
          const num = Number(s.reviewCount);
          return acc + (Number.isFinite(num) && num > 0 ? num : 0);
        }, 0);
      }
      if (metricType === 'price' && val <= 0) continue;
      points.push({ t: rawDate.toISOString(), v: Math.round(val * 100) / 100 });
    }
    return points;
  }


  addToWatchlist(dto: CreateWatchlistItemDto) {
    return this.prisma.watchlistItem.upsert({
      where: { productClusterId: dto.productClusterId },
      update: { note: dto.note, createdBy: dto.createdBy },
      create: {
        productClusterId: dto.productClusterId,
        note: dto.note,
        createdBy: dto.createdBy,
      },
    });
  }

  private async defaultMonteCarloPremises(cluster: ClusterForSimulation): Promise<{
    premises: MonteCarloPremises;
    sources: Record<keyof MonteCarloPremises, PremiseSource>;
  }> {
    const usdPrices = cluster.snapshots
      .filter((s) => s.currency === 'USD' || s.marketplace === 'alibaba' || s.marketplace === 'aliexpress' || s.marketplace === 'amazon')
      .map((s) => this.toPositiveNumber(s.priceMin))
      .filter((v): v is number => v !== null);

    const brlPrices = cluster.snapshots
      .filter((s) => s.currency === 'BRL' || s.marketplace.includes('_br') || s.marketplace === 'mercado_livre')
      .map((s) => this.toPositiveNumber(s.priceMin))
      .filter((v): v is number => v !== null);

    const allPrices = cluster.snapshots
      .map((snapshot) => this.toPositiveNumber(snapshot.priceMin))
      .filter((value): value is number => value !== null);
    const prices = allPrices;

    const volumes = cluster.snapshots
      .map((snapshot) => this.toPositiveNumber(snapshot.salesSignalRaw))
      .filter((value): value is number => value !== null);
    const exchange = await this.usdBrlExchangeContext();
    const logistics = await this.prisma.logisticsCostParam.findFirst({
      where: { productCategory: cluster.category ?? 'equipment' },
      orderBy: { validFrom: 'desc' },
    });

    const custoUsd = this.round(
      this.median(usdPrices) ??
        (brlPrices.length > 0
          ? (this.median(brlPrices)! / exchange.rate) * 0.35
          : this.median(allPrices) ?? 14),
    );
    const freteUsd = this.round(
      logistics?.internationalFreightEstimate
        ? Number(logistics.internationalFreightEstimate)
        : Math.max(3, custoUsd * 0.2),
    );
    const impostoImportacao = logistics?.importTaxRate
      ? Number(logistics.importTaxRate)
      : 0.35;
    const landedCost =
      (custoUsd * (1 + impostoImportacao) + freteUsd) * exchange.rate;
    const precoVenda =
      brlPrices.length > 0
        ? Math.round(this.median(brlPrices)!)
        : Math.round(Math.max(1, landedCost * 1.75));
    const demandaReferencia = Math.round(Math.max(1, this.median(volumes) ?? 520));
    const volPreco = this.clamp(
      this.coefficientOfVariation(brlPrices.length > 0 ? brlPrices : allPrices) ?? 0.05,
      0.03,
      0.5,
    );
    const volDemanda = this.clamp(
      this.coefficientOfVariation(volumes) ?? 0.15,
      0.05,
      0.75,
    );

    const premises: MonteCarloPremises = {
      preco_venda: precoVenda,
      tma_mensal: 0.015,
      folga_estoque: 0.05,
      horizonte_meses: 6,
      preco_referencia: Math.round(precoVenda * 0.95),
      demanda_referencia: demandaReferencia,
      elasticidade: 2.5,
      custo_usd: custoUsd,
      frete_usd_unidade: freteUsd,
      imposto_importacao: impostoImportacao,
      cambio_base: exchange.rate,
      marketing_inicial: 5_000,
      comissao_marketplace: 0.16,
      imposto_venda: 0.08,
      frete_cliente: 8,
      custo_fixo_mensal: 500,
      lead_time_dias: 35,
      fracao_salvage: 0.45,
      curva_rampa: [0.05, 0.12, 0.22, 0.26, 0.21, 0.14],
      vol_cambio: exchange.volatility ?? 0.06,
      vol_preco: volPreco,
      vol_demanda: volDemanda,
      vol_lead: 0.2,
      corr_cambio_lead: 0.35,
    };

    const sources = Object.fromEntries(
      Object.keys(premises).map((key) => [key, 'default']),
    ) as Record<keyof MonteCarloPremises, PremiseSource>;
    sources.custo_usd = prices.length ? 'csv' : 'default';
    sources.demanda_referencia = volumes.length ? 'csv' : 'default';
    sources.vol_preco = prices.length >= 2 ? 'csv' : 'default';
    sources.vol_demanda = volumes.length >= 2 ? 'csv' : 'default';
    sources.frete_usd_unidade = logistics?.internationalFreightEstimate
      ? 'csv'
      : 'derived_default';
    sources.imposto_importacao = logistics?.importTaxRate ? 'csv' : 'default';
    sources.cambio_base = exchange.source;
    sources.vol_cambio = exchange.volatility === null ? 'default' : 'exchange_rate';
    sources.preco_venda = 'derived_default';
    sources.preco_referencia = 'derived_default';

    return { premises, sources };
  }

  private applyPremiseOverrides(
    premises: MonteCarloPremises,
    sources: Record<keyof MonteCarloPremises, PremiseSource>,
    overrides: MonteCarloPremisesDto,
  ): void {
    for (const [key, value] of Object.entries(overrides) as [
      keyof MonteCarloPremises,
      number | number[] | undefined,
    ][]) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        const clean = value.filter((item) => Number.isFinite(item));
        if (clean.length > 0) {
          premises[key] = clean as never;
          sources[key] = 'override';
        }
        continue;
      }
      if (Number.isFinite(value)) {
        premises[key] = value as never;
        sources[key] = 'override';
      }
    }
  }

  private runMonteCarloPython(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pythonBin = process.env.PYTHON_BIN ?? 'python3';
    const scriptPath = join(process.cwd(), 'scripts', 'monte-carlo-vpl.py');

    return new Promise((resolve, reject) => {
      const child = spawn(pythonBin, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new InternalServerErrorException(
            'Monte Carlo simulation timed out before completion.',
          ),
        );
      }, 180_000);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(
          new InternalServerErrorException(
            `Failed to start Monte Carlo Python runner: ${error.message}`,
          ),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(
            new InternalServerErrorException(
              `Monte Carlo Python runner failed: ${stderr || `exit ${code}`}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Record<string, unknown>);
        } catch (error) {
          reject(
            new InternalServerErrorException(
              `Monte Carlo Python runner returned invalid JSON: ${
                error instanceof Error ? error.message : 'unknown error'
              }`,
            ),
          );
        }
      });

      child.stdin.end(JSON.stringify(payload));
    });
  }

  async getAiRecommendation(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      include: {
        // Com INCLUDE_SYNTHETIC_DATA=false, a recomendação usa só snapshots reais.
        snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' } },
        alerts: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });

    if (!cluster) {
      throw new NotFoundException(`Product cluster not found: ${productClusterId}`);
    }

    // 1. Cache de 24h na tabela ai_recommendations. Linhas inválidas
    // (ação fora das 5 ou rationale cru com ```/{) são ignoradas e regeradas.
    const cached = await this.prisma.aiRecommendation.findFirst({
      where: {
        productClusterId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (cached && isQuadrantAction(cached.action) && !isRawRationale(cached.rationale)) {
      const reparsed = this.reparseGeneratedRecommendation(cached.generatedText);
      return {
        id: cached.id,
        product_cluster_id: productClusterId,
        decision: cached.decision ?? cached.action,
        action: cached.action,
        rationale: cached.rationale as string,
        generated_text: cached.generatedText,
        key_drivers: reparsed?.key_drivers ?? [],
        recommended_next_step: reparsed?.recommended_next_step ?? null,
        model_version: cached.modelVersion,
        cached: true,
        created_at: cached.createdAt.toISOString(),
      };
    }

    // 2. Move Score oficial como único contexto de score (F2.7): decisão,
    // P(VPL>0), CVaR e premissas + origem. Sem score, só a confiança.
    const scores = await loadLatestMoveScores(this.prisma, [productClusterId]);
    const moveScore = scores.get(productClusterId) ?? EMPTY_MOVE_SCORE;

    const prices = cluster.snapshots
      .map((s) => Number(s.priceMin))
      .filter((p) => p > 0);
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;

    const contextPayload = {
      product: {
        id: cluster.id,
        name: cluster.canonicalName,
        category: cluster.category,
        snapshots_count: cluster.snapshots.length,
      },
      move_score: {
        score: moveScore.moveScore,
        action: moveScore.action,
        score_band: moveScore.scoreBand,
        data_confidence: moveScore.dataConfidence,
        p_vpl_positivo: moveScore.pVplPositivo,
        cvar5: moveScore.cvar5,
        momentum: {
          direction: moveScore.momentumDirection,
          growth_pct: moveScore.momentumGrowthPct,
          confidence: moveScore.momentumConfidence,
        },
        risk_explanation: moveScore.riskExplanation,
        risk_drivers: moveScore.riskDrivers,
      },
      pricing: {
        avg_price_usd: avgPrice ? Math.round(avgPrice * 100) / 100 : null,
        min_price_usd: minPrice || null,
        max_price_usd: maxPrice || null,
      },
      recent_alerts: cluster.alerts.map((a) => a.message),
    };

    const systemPrompt = `Você é o Move AI, especialista em inteligência de mercado fitness e tomada de decisão comercial de importação.
Sua função é fornecer um parecer executivo rigoroso sobre a oportunidade comercial do produto analisado.
PRINCÍPIO OBRIGATÓRIO: A IA explica e contextualiza, NÃO inventa métricas. As REGRAS classificam (ação por quadrante); use estritamente Move Score, ação, momentum, P(VPL>0), CVaR, causas do risco e premissas do contexto. Sem Move Score (data_confidence diferente de "suficiente") ou ação DADOS_INSUFICIENTES, recomende aguardar mais histórico em vez de chutar um número. Cite só produtos que existem nos dados.

Responda APENAS um objeto JSON com o seguinte formato:
{
  "action": "DECIDIR_AGORA" | "NEGOCIAR_CUSTO" | "TESTAR_DEMANDA" | "IGNORAR" | "DADOS_INSUFICIENTES",
  "rationale": "Justificativa analítica concisa (2 a 4 frases) explicando a ação com base no Move Score, momentum, P(VPL>0), CVaR e causas do risco.",
  "key_drivers": ["principal fator positivo", "principal fator de atenção"],
  "recommended_next_step": "Ação operacional imediata sugerida para o time comercial."
}`;

    // A ação exibida é sempre a das regras (regras classificam, IA explica).
    const rulesAction = isQuadrantAction(moveScore.action) ? moveScore.action : 'DADOS_INSUFICIENTES';

    const callStarted = Date.now();
    const aiResponse = await this.openRouter.chatCompletion(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Analise a viabilidade comercial deste produto fitness com base nos dados reais:\n${JSON.stringify(
            contextPayload,
            null,
            2,
          )}`,
        },
      ],
      {
        endpointName: 'ai_recommendation_card',
        responseFormat: { type: 'json_object' },
        temperature: 0.2,
        maxTokens: 1500,
        metadata: { productClusterId },
      },
    );

    // Extração robusta: cercas em qualquer posição + recorte {…}. Se a IA
    // divergir na ação, o campo dela é ignorado (vale a das regras).
    let parsed = this.reparseGeneratedRecommendation(aiResponse.content ?? '');
    let usedFallback = false;
    if (!parsed) {
      await this.logAiRecommendationRejection(
        aiResponse.model,
        callStarted,
        aiResponse.content ?? '',
        productClusterId,
      );
      parsed = {
        action: null,
        rationale: fallbackRationale({
          score: moveScore.moveScore,
          scoreBand: moveScore.scoreBand,
          action: rulesAction,
          riskText: moveScore.riskExplanation,
        }),
        key_drivers: [],
        recommended_next_step: null,
      };
      usedFallback = true;
    }

    const saved = await this.prisma.aiRecommendation.create({
      data: {
        productClusterId,
        decision: rulesAction,
        action: rulesAction,
        rationale: parsed.rationale as string,
        generatedText: aiResponse.content ?? '',
        modelVersion: aiResponse.model,
        promptVersion: usedFallback ? 'v2.1-deterministic-fallback' : 'v2.1-rules-action',
        scoreSnapshotId: cluster.snapshots.at(-1)?.id ?? null,
      },
    });

    return {
      id: saved.id,
      product_cluster_id: productClusterId,
      decision: saved.decision,
      action: saved.action,
      rationale: saved.rationale,
      generated_text: saved.generatedText,
      key_drivers: parsed.key_drivers ?? [],
      recommended_next_step: parsed.recommended_next_step ?? null,
      model_version: saved.modelVersion,
      cached: false,
      created_at: saved.createdAt.toISOString(),
    };
  }

  /** Re-parseia `generatedText` para devolver key_drivers/next_step no cache. */
  private reparseGeneratedRecommendation(
    generatedText: string | null | undefined,
  ): ParsedRecommendation | null {
    if (!generatedText) return null;
    try {
      return parseRecommendationPayload(extractJsonObject(generatedText));
    } catch {
      return null;
    }
  }

  /** Registra parse/validação rejeitada em ai_call_logs (best-effort). */
  private async logAiRecommendationRejection(
    model: string,
    started: number,
    content: string,
    productClusterId: string,
  ): Promise<void> {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          endpoint: 'ai_recommendation_card',
          model,
          latencyMs: Date.now() - started,
          status: 'rejected_validation',
          error: content.slice(0, 2000) || 'empty_response',
          metadata: { productClusterId } as never,
        },
      });
    } catch {
      // Log é best-effort; nunca quebra o parecer.
    }
  }

  private async callOpenRouterPremiseAnalyst(params: {
    cluster: ClusterForSimulation;
    premises: MonteCarloPremises;
    sources: Record<keyof MonteCarloPremises, PremiseSource>;
    userNotes?: string;
  }): Promise<AiPremiseResponse> {
    const userContent = JSON.stringify({
      task:
        'Audite e preencha premissas para o simulador Monte Carlo + VPL. Responda apenas JSON no schema solicitado.',
      response_schema: {
        premises:
          'objeto com as mesmas chaves snake_case das premissas, somente números ou curva_rampa numérica',
        rationale: 'resumo curto da lógica usada',
        warnings: ['alertas de unidade, escala ou limitação do modelo'],
        fragile_assumptions: ['premissas mais incertas'],
      },
      product: {
        id: params.cluster.id,
        canonical_name: params.cluster.canonicalName,
        category: params.cluster.category,
      },
      current_premises: params.premises,
      premise_sources: params.sources,
      data_summary: this.simulationDataSummary(params.cluster),
      user_notes: params.userNotes ?? null,
      rules: [
        'Não use porcentagens inteiras; use frações.',
        'Não invente dados externos. Se não houver base, mantenha o valor atual e explique.',
        'Mantenha todas as chaves de premises com snake_case.',
        'Não retorne markdown.',
      ],
    });

    const response = await this.openRouter.chatCompletion(
      [
        { role: 'system', content: MONTE_CARLO_ANALYST_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      {
        endpointName: 'monte_carlo_ai_premises',
        temperature: 0.2,
        topP: 0.8,
        maxTokens: 4096,
        metadata: { productClusterId: params.cluster.id },
      },
    );

    if (!response.content) {
      throw new ServiceUnavailableException('OpenRouter premise analyst returned no content.');
    }

    return this.parseAiJson(response.content);
  }

  private simulationDataSummary(cluster: ClusterForSimulation) {
    const prices = cluster.snapshots
      .map((snapshot) => this.toPositiveNumber(snapshot.priceMin))
      .filter((value): value is number => value !== null);
    const volumes = cluster.snapshots
      .map((snapshot) => this.toPositiveNumber(snapshot.salesSignalRaw))
      .filter((value): value is number => value !== null);
    const moqs = cluster.snapshots
      .map((snapshot) => snapshot.moq)
      .filter((value): value is number => value !== null && value > 0);

    return {
      snapshot_count: cluster.snapshots.length,
      price_min_usd: prices.length ? Math.min(...prices) : null,
      price_max_usd: prices.length ? Math.max(...prices) : null,
      price_median_usd: this.median(prices),
      volume_min: volumes.length ? Math.min(...volumes) : null,
      volume_max: volumes.length ? Math.max(...volumes) : null,
      volume_median: this.median(volumes),
      moq_median: this.median(moqs),
      first_collected_at: cluster.snapshots.at(0)?.collectedAt ?? null,
      last_collected_at: cluster.snapshots.at(-1)?.collectedAt ?? null,
      note:
        'Dados simulados derivados de CSV antigo; use como aproximação de produto, não como dado atual de mercado.',
    };
  }

  private parseAiJson(content: string): AiPremiseResponse {
    const trimmed = content.trim();
    const jsonText = trimmed.startsWith('```')
      ? trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
      : trimmed;

    try {
      return JSON.parse(jsonText) as AiPremiseResponse;
    } catch (error) {
      throw new ServiceUnavailableException(
        `OpenRouter premise analyst returned invalid JSON: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private sanitizeAiPremises(premises: MonteCarloPremisesDto): MonteCarloPremisesDto {
    const clean: MonteCarloPremisesDto = {};
    for (const [key, value] of Object.entries(premises) as [
      keyof MonteCarloPremisesDto,
      number | number[] | undefined,
    ][]) {
      if (Array.isArray(value)) {
        const curve = value.filter((item) => Number.isFinite(item));
        if (curve.length > 0) {
          clean[key] = curve as never;
        }
        continue;
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        clean[key] = value as never;
      }
    }
    return clean;
  }

  private premiseChanged(current: unknown, suggested: unknown): boolean {
    if (Array.isArray(current) || Array.isArray(suggested)) {
      return JSON.stringify(current) !== JSON.stringify(suggested);
    }
    if (typeof current === 'number' && typeof suggested === 'number') {
      return Math.abs(current - suggested) > 1e-9;
    }
    return current !== suggested;
  }

  private async usdBrlExchangeContext(): Promise<{
    rate: number;
    volatility: number | null;
    source: 'exchange_rate' | 'default';
  }> {
    const rows = await this.prisma.exchangeRate.findMany({
      where: { baseCurrency: 'USD', quoteCurrency: 'BRL' },
      orderBy: { capturedAt: 'desc' },
      take: 60,
    });

    const rates = rows
      .map((row) => Number(row.rate))
      .filter((rate) => Number.isFinite(rate) && rate > 0);
    if (rates.length === 0) {
      // Sem cotação: fallback único documentado (F1.7).
      return { rate: DEFAULT_FX_USD_BRL, volatility: null, source: 'default' };
    }

    return {
      rate: rates[0],
      volatility: rates.length >= 2 ? this.coefficientOfVariation(rates) : null,
      source: 'exchange_rate',
    };
  }

  private normalizedCount(
    value: number | undefined,
    fallback: number,
    max: number,
  ): number {
    if (!value || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(100, Math.round(value)));
  }

  private median(values: number[]): number | null {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  private coefficientOfVariation(values: number[]): number | null {
    if (values.length < 2) {
      return null;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0) {
      return null;
    }
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance) / mean;
  }

  private toPositiveNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private async seriesPoints(
    productClusterId: string,
    window: string,
    metricType: 'volume' | 'price' | 'reviews' | 'general' = 'general',
  ) {
    return this.cached(`products:series:${productClusterId}:${window}:${metricType}`, 3600, async () => {
      // Com INCLUDE_SYNTHETIC_DATA=false, as séries ignoram snapshots sintéticos.
      const allSnapshots = await this.prisma.productListingSnapshot.findMany({
        where: { productClusterId, ...syntheticSnapshotWhere() },
        orderBy: { collectedAt: 'asc' },
        take: 5_000,
      });

      if (allSnapshots.length === 0) {
        return [];
      }

      const latestTime = allSnapshots[allSnapshots.length - 1].collectedAt.getTime();
      const windowMs = WINDOW_MS[window] ?? Number.MAX_SAFE_INTEGER;
      const cutoffTime =
        window && window !== 'all' && windowMs && windowMs !== Number.MAX_SAFE_INTEGER
          ? latestTime - windowMs
          : 0;

      const filtered = allSnapshots.filter(
        (s) => s.collectedAt.getTime() >= cutoffTime,
      );

      const byDate = new Map<string, { snapshots: typeof filtered; rawDate: Date }>();
      for (const snapshot of filtered) {
        const dateKey = snapshot.collectedAt.toISOString().slice(0, 10);
        const curr = byDate.get(dateKey) ?? { snapshots: [], rawDate: snapshot.collectedAt };
        curr.snapshots.push(snapshot);
        byDate.set(dateKey, curr);
      }

      const points: { t: string; v: number }[] = [];
      // Taxa de câmbio da MESMA função do resto do backend (F1.7); sem
      // cotação, o fallback único documentado.
      const exchange = metricType === 'price' ? await this.usdBrlExchangeContext() : null;
      const exchangeRate = exchange?.rate ?? DEFAULT_FX_USD_BRL;


      for (const [, { snapshots, rawDate }] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        let val = 0;

        if (metricType === 'volume') {
          // Volume consolidado de vendas: soma das vendas mensais dos canais de varejo
          val = snapshots.reduce((acc, s) => {
            const num = Number(s.salesSignalRaw);
            return acc + (Number.isFinite(num) && num > 0 ? num : 0);
          }, 0);
        } else if (metricType === 'price') {
          // Preço Médio Nacionalizado/BRL praticado no mercado
          const validPrices = snapshots
            .map((s) => {
              const rawPrice = Number(s.priceMin);
              if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
              const isUsd = s.currency === 'USD' || s.marketplace === 'alibaba' || s.marketplace === 'aliexpress' || s.marketplace === '1688';
              return isUsd ? rawPrice * exchangeRate : rawPrice;
            })
            .filter((p): p is number => p !== null && p > 0);

          val =
            validPrices.length > 0
              ? validPrices.reduce((a, b) => a + b, 0) / validPrices.length
              : 0;
        } else if (metricType === 'reviews') {
          // Total de avaliações acumuladas
          val = snapshots.reduce((acc, s) => {
            const num = Number(s.reviewCount);
            return acc + (Number.isFinite(num) && num > 0 ? num : 0);
          }, 0);
        }

        // Omitir pontos sem valor real no gráfico de preço para evitar linha caindo a zero
        if (metricType === 'price' && val <= 0) {
          continue;
        }

        points.push({
          t: rawDate.toISOString(),
          v: Math.round(val * 100) / 100,
        });
      }

      return points;
    });
  }

  async exportCsv(productClusterId: string): Promise<string> {
    const snapshots = await this.getSnapshots(productClusterId);
    const headers = [
      'Data Coleta',
      'Marketplace',
      'Titulo',
      'Preco Min',
      'Preco Max',
      'Moeda',
      'Vendas Mensais Estimadas',
      'Avaliacao',
      'Total Avaliacoes',
      'Fornecedor / Vendedor',
      'URL Produto',
    ];

    const rows = snapshots.map((s) => [
      `"${s.collectedAt.toISOString().slice(0, 10)}"`,
      `"${s.marketplace}"`,
      `"${(s.title || '').replace(/"/g, '""')}"`,
      s.priceMin ?? '',
      s.priceMax ?? '',
      `"${s.currency ?? 'BRL'}"`,
      s.salesSignalRaw ?? '',
      s.rating ?? '',
      s.reviewCount ?? '',
      `"${(s.sellerName || '').replace(/"/g, '""')}"`,
      `"${(s.productUrl || '').replace(/"/g, '""')}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }

  async exportPdf(productClusterId: string): Promise<string> {
    const cluster = await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      include: {
        // Com INCLUDE_SYNTHETIC_DATA=false, o PDF usa só snapshots reais.
        snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' }, take: 1000 },
      },
    });

    if (!cluster) {
      throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    }

    const volumeHistory = await this.getVolumeHistory(productClusterId, 'all');
    const priceHistory = await this.getPriceHistory(productClusterId, 'all');
    const suppliers = await this.getSuppliers(productClusterId);
    const defaults = await this.getMonteCarloDefaults(productClusterId);

    const firstVol = volumeHistory.points[0]?.v ?? 0;
    const lastVol = volumeHistory.points[volumeHistory.points.length - 1]?.v ?? 0;
    const growth = firstVol > 0 ? Math.round(((lastVol - firstVol) / firstVol) * 100) : 0;
    const avgPrice =
      priceHistory.points.length > 0
        ? Math.round(
            priceHistory.points.reduce((acc, p) => acc + p.v, 0) /
              priceHistory.points.length,
          )
        : 0;
    // Ausência de score/risco real vira "—"/"Não simulado" no PDF, nunca um
    // número inventado (ver RELATORIO_ANALISE_DADOS_E_SCORES.md seção 4.1).
    const riskLabel = cluster.riskLevel ?? '—';
    const financialScoreLabel =
      cluster.financialScore !== null && cluster.financialScore !== undefined
        ? `${cluster.financialScore}/100`
        : 'Não simulado';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Dossiê Executivo - ${cluster.canonicalName} | Move Intelligence</title>
  <style>
    @page { size: A4; margin: 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; line-height: 1.5; margin: 0; padding: 20px; }
    .header { border-bottom: 2px solid #0f766e; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
    .logo { font-size: 20px; font-weight: 800; color: #0f766e; letter-spacing: -0.5px; }
    .logo span { color: #64748b; font-weight: 400; font-size: 14px; margin-left: 8px; }
    .date { font-size: 12px; color: #64748b; }
    .title-section { margin-bottom: 24px; }
    .title-section h1 { font-size: 24px; color: #0f172a; margin: 0 0 6px 0; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-cat { background: #f1f5f9; color: #475569; }
    .badge-growth { background: #dcfce7; color: #15803d; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; }
    .kpi-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .kpi-val { font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 15px; font-weight: 700; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f1f5f9; text-align: left; padding: 8px 10px; color: #475569; font-weight: 600; border-bottom: 1px solid #cbd5e1; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { .no-print { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px; text-align: right;">
    <button onclick="window.print()" style="background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:600;cursor:pointer;">🖨️ Imprimir / Salvar PDF</button>
  </div>

  <div class="header">
    <div class="logo">MOVE INTELLIGENCE <span>Dossiê Executivo de Produto</span></div>
    <div class="date">Gerado em: ${new Date().toLocaleDateString('pt-BR')}</div>
  </div>

  <div class="title-section">
    <h1>${cluster.canonicalName}</h1>
    <span class="badge badge-cat">Categoria: ${cluster.category || 'Geral'}</span>
    <span class="badge badge-growth">Crescimento no período observado: ${growth >= 0 ? '+' : ''}${growth}%</span>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Volume Atual</div>
      <div class="kpi-val">${new Intl.NumberFormat('pt-BR').format(lastVol)} un/mês</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Preço Médio</div>
      <div class="kpi-val">R$ ${avgPrice}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Risco Financeiro</div>
      <div class="kpi-val" style="text-transform: capitalize;">${riskLabel}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Score Financeiro</div>
      <div class="kpi-val">${financialScoreLabel}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">📊 Evolução Histórica de Compras e Demanda (Série Temporal)</div>
    <table>
      <thead>
        <tr>
          <th>Data de Referência</th>
          <th>Volume Mensal (un)</th>
          <th>Preço Médio Registrado</th>
        </tr>
      </thead>
      <tbody>
        ${volumeHistory.points.slice(-12).map((pt, idx) => `
          <tr>
            <td>${new Date(pt.t).toLocaleDateString('pt-BR')}</td>
            <td><strong>${new Intl.NumberFormat('pt-BR').format(pt.v)} un</strong></td>
            <td>R$ ${priceHistory.points[idx]?.v ? priceHistory.points[idx].v : avgPrice}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">🏭 Fornecedores e Mapeamento de Sourcing</div>
    <table>
      <thead>
        <tr>
          <th>Fornecedor</th>
          <th>Origem / Marketplace</th>
          <th>MOQ</th>
          <th>Preço FOB Estimado</th>
          <th>Avaliação</th>
        </tr>
      </thead>
      <tbody>
        ${suppliers.slice(0, 5).map((sup) => `
          <tr>
            <td><strong>${sup.name || 'Não identificado'}</strong></td>
            <td>${sup.country || 'Não informado'} ${sup.flag || ''}</td>
            <td>${sup.moq ?? '—'} un</td>
            <td>${sup.fob ? `USD ${sup.fob}` : 'Sob consulta'}</td>
            <td>${sup.score?.value ? `★ ${(sup.score.value / 20).toFixed(1)}` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Move Intelligence Platform • Dossiê gerado a partir dos dados coletados para este produto.
  </div>
</body>
</html>`;
  }

  async getUnitEconomicsDefaults(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      // Com INCLUDE_SYNTHETIC_DATA=false, os defaults usam só snapshots reais.
      include: { snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'desc' }, take: 50 } },
    });
    if (!cluster) {
      throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    }

    const prices = cluster.snapshots
      .map((s) => Number(s.priceMin))
      .filter((p) => Number.isFinite(p) && p > 0);
    const avgPriceBrl =
      prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : 499;

    const volumes = cluster.snapshots
      .map((s) => Number(s.salesSignalRaw))
      .filter((v) => Number.isFinite(v) && v > 0);
    const latestVol = volumes.length > 0 ? Math.round(volumes[0]) : 200;

    // Câmbio da MESMA função do resto do backend (F1.7), não um fixo
    // divergente. A fórmula do FOB (18% do preço) está mantida.
    const exchange = await this.usdBrlExchangeContext();
    const cambioUsd = exchange.rate;
    const fobUsd = Math.round((avgPriceBrl / cambioUsd) * 0.18 * 100) / 100 || 25.0;

    return {
      precoVendaBrl: avgPriceBrl,
      fobUsd,
      cambioUsd,
      freteUnitarioUsd: 6.5,
      impostoImportacaoPct: 35.0,
      icmsPct: 18.0,
      comissaoMarketplacePct: 16.0,
      custoFulfillmentBrl: 32.0,
      custoFixoMensalBrl: 4500.0,
      elasticidadePreco: -1.6,
      volumeBaseMensal: latestVol,
      // Origem explícita dos defaults (fórmulas mantidas): a calculadora exibe
      // o que é observado e o que é estimativa/default.
      premiseSources: {
        precoVendaBrl: prices.length > 0 ? 'observado' : 'default',
        fobUsd: 'estimativa_18pct_do_preco',
        volumeBaseMensal: volumes.length > 0 ? 'observado' : 'default',
        cambioUsd: exchange.source === 'exchange_rate' ? 'observado' : 'default',
      },
    };
  }

  async simulateUnitEconomics(
    productClusterId: string,
    custom?: {
      precoVendaBrl?: number;
      fobUsd?: number;
      cambioUsd?: number;
      freteUnitarioUsd?: number;
      impostoImportacaoPct?: number;
      icmsPct?: number;
      comissaoMarketplacePct?: number;
      custoFulfillmentBrl?: number;
      custoFixoMensalBrl?: number;
      elasticidadePreco?: number;
      volumeBaseMensal?: number;
    },
  ) {
    const defaults = await this.getUnitEconomicsDefaults(productClusterId);
    const p = { ...defaults, ...custom };

    const precoVendaBrl = p.precoVendaBrl ?? defaults.precoVendaBrl;
    const fobUsd = p.fobUsd ?? defaults.fobUsd;
    const cambioUsd = p.cambioUsd ?? defaults.cambioUsd;
    const freteUnitarioUsd = p.freteUnitarioUsd ?? defaults.freteUnitarioUsd;
    const impostoImportacaoPct = p.impostoImportacaoPct ?? defaults.impostoImportacaoPct;
    const icmsPct = p.icmsPct ?? defaults.icmsPct;
    const comissaoMarketplacePct = p.comissaoMarketplacePct ?? defaults.comissaoMarketplacePct;
    const custoFulfillmentBrl = p.custoFulfillmentBrl ?? defaults.custoFulfillmentBrl;
    const custoFixoMensalBrl = p.custoFixoMensalBrl ?? defaults.custoFixoMensalBrl;
    const elasticidadePreco = p.elasticidadePreco ?? defaults.elasticidadePreco;
    const volumeBaseMensal = p.volumeBaseMensal ?? defaults.volumeBaseMensal;

    const fobBrl = fobUsd * cambioUsd;
    const freteBrl = freteUnitarioUsd * cambioUsd;
    const impostosImportacaoBrl = (fobBrl + freteBrl) * (impostoImportacaoPct / 100);
    const custoLandedBrl = Math.round((fobBrl + freteBrl + impostosImportacaoBrl) * 100) / 100;

    const impostosVendaBrl = Math.round(precoVendaBrl * (icmsPct / 100) * 100) / 100;
    const comissaoBrl = Math.round(precoVendaBrl * (comissaoMarketplacePct / 100) * 100) / 100;
    const custoVariavelTotalBrl =
      Math.round((custoLandedBrl + impostosVendaBrl + comissaoBrl + custoFulfillmentBrl) * 100) / 100;

    const margemContribuicaoBrl = Math.round((precoVendaBrl - custoVariavelTotalBrl) * 100) / 100;
    const margemContribuicaoPct =
      precoVendaBrl > 0 ? Math.round((margemContribuicaoBrl / precoVendaBrl) * 1000) / 10 : 0;

    // Demanda iso-elástica: V = V0 * (P / P0) ^ Ed, ancorada no preço de
    // referência do cluster. A forma linear (1 + Ed * delta) zerava o volume a
    // partir de P0 * (1 + 1/|Ed|) — com Ed = -1.6 isso acontecia já em 1.6x o
    // preço de referência, travando lucro e ROI no resto da faixa do slider.
    const precoReferenciaBrl = defaults.precoVendaBrl;
    const projetarVolume = (preco: number): number => {
      if (!(precoReferenciaBrl > 0) || !(preco > 0)) return volumeBaseMensal;
      const volume = volumeBaseMensal * Math.pow(preco / precoReferenciaBrl, elasticidadePreco);
      return Number.isFinite(volume) ? Math.max(0, Math.round(volume)) : 0;
    };

    const volumeProjetado = projetarVolume(precoVendaBrl);

    const breakEvenUnits =
      margemContribuicaoBrl > 0 ? Math.ceil(custoFixoMensalBrl / margemContribuicaoBrl) : 0;
    const receitaTotalMensal = Math.round(volumeProjetado * precoVendaBrl);
    const lucroLiquidoMensal = Math.round(volumeProjetado * margemContribuicaoBrl - custoFixoMensalBrl);
    const investimentoEstoque = Math.round(volumeProjetado * custoLandedBrl);
    const roiPct =
      investimentoEstoque > 0 ? Math.round((lucroLiquidoMensal / investimentoEstoque) * 1000) / 10 : 0;

    const curvaSensibilidade = [-0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4].map((delta) => {
      // Ancorada no preço simulado para que a curva acompanhe o slider; o
      // volume continua saindo da mesma curva de demanda (P0, V0), então em
      // delta = 0 o ponto coincide com volumeProjetado.
      const pTest = Math.round(precoVendaBrl * (1 + delta));
      const vTest = projetarVolume(pTest);
      const impVenda = pTest * (icmsPct / 100);
      const comiss = pTest * (comissaoMarketplacePct / 100);
      const cVar = custoLandedBrl + impVenda + comiss + custoFulfillmentBrl;
      const mUnit = pTest - cVar;
      const lucroTest = Math.round(vTest * mUnit - custoFixoMensalBrl);
      return {
        preco: pTest,
        volume: vTest,
        lucroMensal: lucroTest,
        margemPct: pTest > 0 ? Math.round((mUnit / pTest) * 1000) / 10 : 0,
      };
    });

    return {
      inputs: p,
      breakdown: {
        fobBrl: Math.round(fobBrl * 100) / 100,
        freteBrl: Math.round(freteBrl * 100) / 100,
        impostosImportacaoBrl: Math.round(impostosImportacaoBrl * 100) / 100,
        custoLandedBrl,
        impostosVendaBrl,
        comissaoBrl,
        custoFulfillmentBrl,
        custoVariavelTotalBrl,
      },
      metrics: {
        margemContribuicaoBrl,
        margemContribuicaoPct,
        volumeProjetado,
        breakEvenUnits,
        receitaTotalMensal,
        lucroLiquidoMensal,
        investimentoEstoque,
        roiPct,
      },
      curvaSensibilidade,
    };
  }

  async getCompetitorMatrix(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      include: {
        // Com INCLUDE_SYNTHETIC_DATA=false, a matriz usa só snapshots reais.
        snapshots: {
          where: syntheticSnapshotWhere(),
          orderBy: { collectedAt: 'desc' },
          take: 200,
        },
      },
    });
    if (!cluster) {
      throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    }

    const bySeller = new Map<
      string,
      {
        sellerName: string | null;
        marketplace: string;
        prices: number[];
        sales: number[];
        ratings: number[];
        reviewCounts: number[];
        url?: string;
      }
    >();

    for (const s of cluster.snapshots) {
      // Nome real do vendedor quando existir; sem inventar "MercadoLíder
      // Platinum Pro"/"Amazon Store Oficial". Snapshots sem vendedor
      // identificado são agrupados por marketplace, mas o nome exibido fica null.
      const name = s.sellerName?.trim() || null;
      const key = `${s.marketplace}:${name ?? 'sem_vendedor_identificado'}`;
      const existing = bySeller.get(key) ?? {
        sellerName: name,
        marketplace: s.marketplace,
        prices: [],
        sales: [],
        ratings: [],
        reviewCounts: [],
        url: s.productUrl ?? undefined,
      };
      if (s.priceMin) existing.prices.push(Number(s.priceMin));
      if (s.salesSignalRaw) existing.sales.push(Number(s.salesSignalRaw));
      if (s.rating) existing.ratings.push(Number(s.rating));
      if (s.reviewCount) existing.reviewCounts.push(Number(s.reviewCount));
      bySeller.set(key, existing);
    }

    // Só entra no cálculo de market share quem realmente tem sinal de vendas;
    // vendedor sem dado não pode ganhar uma fatia inventada (antes usava 50
    // como default e distribuía o resto igualmente entre todos).
    const sellersWithSales = [...bySeller.values()].filter((s) => s.sales.length > 0);
    const totalClusterSales = sellersWithSales.reduce((sum, s) => sum + s.sales[0], 0);

    const competitors = [...bySeller.values()]
      .map((s) => {
        const avgPrice =
          s.prices.length > 0
            ? Math.round(s.prices.reduce((a, b) => a + b, 0) / s.prices.length)
            : null;
        const latestSales = s.sales.length > 0 ? Math.round(s.sales[0]) : null;
        const sharePct =
          latestSales !== null && totalClusterSales > 0
            ? Math.round((latestSales / totalClusterSales) * 1000) / 10
            : null;
        const rating =
          s.ratings.length > 0
            ? Math.round((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length) * 10) / 10
            : null;
        const reviews = s.reviewCounts.length > 0 ? Math.max(...s.reviewCounts) : null;

        return {
          id: `${s.marketplace}_${s.sellerName ?? 'sem_vendedor_identificado'}`,
          sellerName: s.sellerName,
          marketplace: s.marketplace,
          // Reputação, fulfillment e "vencedor do buybox" não têm fonte real
          // hoje (não vêm do scrape) — não inventar por posição na lista.
          reputation: null,
          fulfillment: null,
          avgPrice,
          minPrice: s.prices.length > 0 ? Math.min(...s.prices) : null,
          maxPrice: s.prices.length > 0 ? Math.max(...s.prices) : null,
          monthlySalesEst: latestSales,
          marketSharePct: sharePct,
          rating,
          reviewCount: reviews,
          buyboxWinner: null,
          url: s.url,
        };
      })
      .sort((a, b) => (b.marketSharePct ?? -1) - (a.marketSharePct ?? -1))
      .slice(0, 5);

    return {
      productClusterId,
      canonicalName: cluster.canonicalName,
      totalCompetitorsIdentified: bySeller.size,
      topCompetitors: competitors,
      hhiIndex: competitors.reduce((acc, c) => acc + Math.pow(c.marketSharePct ?? 0, 2), 0),
    };
  }

  async getSeasonalityForecast(productClusterId: string) {
    const cluster = await this.prisma.productCluster.findUnique({
      where: { id: productClusterId },
      // Com INCLUDE_SYNTHETIC_DATA=false, a sazonalidade usa só snapshots reais.
      include: { snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' }, take: 1000 } },
    });
    if (!cluster) {
      throw new NotFoundException(`Produto não encontrado: ${productClusterId}`);
    }

    const volumeHistory = await this.getVolumeHistory(productClusterId, 'all');
    const currentVol = volumeHistory.points.at(-1)?.v ?? 200;

    const SEASONAL_FACTORS: Record<number, { factor: number; label: string }> = {
      0: { factor: 1.35, label: 'Pico de Verão / Resoluções de Ano Novo' },
      1: { factor: 1.15, label: 'Pós-Carnaval / Retomada Fitness' },
      2: { factor: 1.05, label: 'Outono / Estabilidade' },
      3: { factor: 0.95, label: 'Transição' },
      4: { factor: 0.88, label: 'Inverno / Demanda Indoor Moderada' },
      5: { factor: 0.85, label: 'Vale Sazonal' },
      6: { factor: 0.92, label: 'Início Aquecimento Segundo Semestre' },
      7: { factor: 1.05, label: 'Preparação Primavera' },
      8: { factor: 1.18, label: 'Primavera / Projeto Verão' },
      9: { factor: 1.25, label: 'Aquecimento Black Friday' },
      10: { factor: 1.45, label: 'Super Pico Black Friday & Cyber Week' },
      11: { factor: 1.3, label: 'Pico Natal e Festas' },
    };

    const now = new Date();
    const currentMonth = now.getMonth();

    const forecastNext6Months = [];
    for (let i = 1; i <= 6; i++) {
      const targetDate = new Date(now.getFullYear(), currentMonth + i, 1);
      const m = targetDate.getMonth();
      const sInfo = SEASONAL_FACTORS[m];
      const base = currentVol / (SEASONAL_FACTORS[currentMonth]?.factor || 1);
      const projectedVolume = Math.round(base * sInfo.factor);
      forecastNext6Months.push({
        monthIndex: m + 1,
        monthName: targetDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        projectedVolume,
        seasonalFactor: sInfo.factor,
        demandStatus:
          sInfo.factor >= 1.2 ? 'SUPER_ALTA' : sInfo.factor >= 1.0 ? 'ESTAVEL' : 'MODERADA',
        notes: sInfo.label,
      });
    }

    const peak = [...forecastNext6Months].sort((a, b) => b.projectedVolume - a.projectedVolume)[0];
    const leadTimeDays = 90;
    const targetPeakDate = new Date(now.getFullYear(), peak.monthIndex - 1, 15);
    const orderDeadline = new Date(
      targetPeakDate.getTime() - leadTimeDays * 24 * 60 * 60 * 1000,
    );
    const daysRemainingToOrder = Math.round(
      (orderDeadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );

    return {
      productClusterId,
      canonicalName: cluster.canonicalName,
      currentMonthlyVolume: currentVol,
      // Fatores sazonais fixos e genéricos — não derivam do histórico do produto.
      method: 'fatores_genericos_fixos',
      forecastNext6Months,
      optimalSourcingWindow: {
        targetPeakMonth: peak.monthName,
        targetPeakVolume: peak.projectedVolume,
        totalLeadTimeDays: leadTimeDays,
        leadTimeBreakdown: {
          productionDays: 35,
          oceanFreightDays: 40,
          customsClearanceDays: 15,
        },
        orderDeadlineDate: orderDeadline.toISOString().slice(0, 10),
        daysRemainingToOrder,
        status:
          daysRemainingToOrder <= 30
            ? 'JANELA_URGENTE'
            : daysRemainingToOrder <= 60
              ? 'PLANEJAMENTO_ATIVO'
              : 'MONITORAMENTO',
        recommendation:
          daysRemainingToOrder <= 30
            ? `🚨 URGENTE: Emitir pedido FOB na China até ${orderDeadline.toLocaleDateString('pt-BR')} para garantir estoque no pico de ${peak.monthName}.`
            : `📦 Planejamento: Iniciar cotações com fornecedores para consolidar pedido até ${orderDeadline.toLocaleDateString('pt-BR')}.`,
      },
    };
  }

  async compareProducts(ids: string[]) {
    const cleanIds = ids.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, 4);
    if (cleanIds.length === 0) return [];

    const clusters = await this.prisma.productCluster.findMany({
      where: { id: { in: cleanIds } },
      include: {
        // Com INCLUDE_SYNTHETIC_DATA=false, o comparador usa só snapshots reais.
        snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' }, take: 1000 },
      },
    });
    // Move Score oficial (F2.5): uma query para os clusters comparados.
    const scores = await loadLatestMoveScores(
      this.prisma,
      clusters.map((c) => c.id),
    );

    return Promise.all(
      clusters.map(async (c) => {
        const vol = await this.getVolumeHistory(c.id, 'all');
        const price = await this.getPriceHistory(c.id, 'all');
        const econ = await this.simulateUnitEconomics(c.id);
        const suppliers = await this.getSuppliers(c.id);
        const moveScore = scores.get(c.id) ?? EMPTY_MOVE_SCORE;

        const firstVol = vol.points[0]?.v ?? 0;
        const lastVol = vol.points.at(-1)?.v ?? 0;
        const growthPct =
          firstVol > 0 ? Math.round(((lastVol - firstVol) / firstVol) * 100) : 0;

        // C1: review_summary por faixa (B5); distribuição via última observação quando houver.
        let reviewSummary: { by_band: Record<string, unknown>; distribution: unknown } | null = null;
        try {
          const rows = await this.prisma.reviewSummary.findMany({
            where: { productClusterId: c.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });
          const by_band: Record<string, unknown> = {};
          for (const r of rows) {
            if (!by_band[r.band]) {
              by_band[r.band] = { summary: r.summary, top_reasons: r.topReasons, sample_size: r.sampleSize };
            }
          }
          reviewSummary = { by_band, distribution: null };
        } catch {
          reviewSummary = null;
        }

        return {
          id: c.id,
          canonicalName: c.canonicalName,
          category: c.category,
          riskLevel: c.riskLevel ?? null,
          // Move Score oficial (F2.7: único score do comparador).
          moveScore: moveScore.moveScore,
          decision: moveScore.decision,
          dataConfidence: moveScore.dataConfidence,
          pVplPositivo: moveScore.pVplPositivo,
          cvar5: moveScore.cvar5,
          // C1: contrato estendido.
          action: moveScore.action ?? null,
          score_band: moveScore.scoreBand ?? null,
          momentum: {
            direction: moveScore.momentumDirection ?? null,
            growth_pct: moveScore.momentumGrowthPct ?? null,
            confidence: moveScore.momentumConfidence ?? null,
          },
          risk_explanation:
            moveScore.riskExplanation != null || moveScore.riskDrivers != null
              ? { text: moveScore.riskExplanation ?? null, drivers: moveScore.riskDrivers ?? [] }
              : null,
          detected_on: [...new Set(c.snapshots.map((s) => s.marketplace))],
          top_supplier: suppliers[0]
            ? {
                name: (suppliers[0] as Record<string, unknown>).name ?? null,
                source: (suppliers[0] as Record<string, unknown>).marketplace ?? null,
              }
            : null,
          review_summary: reviewSummary,
          growthPct,
          currentVolume: lastVol,
          avgPrice: econ.inputs.precoVendaBrl,
          margemPct: econ.metrics.margemContribuicaoPct,
          lucroMensalEst: econ.metrics.lucroLiquidoMensal,
          roiPct: econ.metrics.roiPct,
          topSupplier: suppliers[0]?.name || null,
          volumeSeries: vol.points.slice(-24),
          priceSeries: price.points.slice(-24),
        };
      }),
    );
  }
}
