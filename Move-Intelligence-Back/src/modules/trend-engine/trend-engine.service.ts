import { Injectable } from '@nestjs/common';
import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { SalesSignalType } from '../../shared/types/marketplace.types';
import { TrendScoreBreakdown } from '../../shared/types/scoring.types';

export interface TrendSnapshotInput {
  marketplace: string;
  category?: string | null;
  priceMin?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  salesSignalRaw?: number | null;
  salesSignalType?: SalesSignalType | null;
  collectedAt: Date;
}

/**
 * Peso do componente "baseline" (sinal absoluto) dentro de cada eixo do
 * breakdown. O baseline é somado ao componente de crescimento, nunca o
 * substitui: assim um cluster com histórico real sempre pontua acima do mesmo
 * cluster sem histórico, e a primeira importação (1 snapshot por cluster) já
 * produz uma ordenação coerente em vez de zerar tudo.
 */
const BASELINE_WEIGHT = 0.5;

/**
 * Crédito dado à simples presença de preço no snapshot. Preço conhecido é
 * pré-requisito para qualquer análise de margem, mas por si só não é sinal de
 * demanda — por isso vale pouco.
 */
const PRICE_PRESENCE_CREDIT = 0.2;

/** Rating (0–5) abaixo deste valor não gera crédito de qualidade. */
const RATING_FLOOR = 3;

/** Rating a partir do qual o crédito de qualidade satura em 1. */
const RATING_CEILING = 5;

/** Participação do rating na composição do baseline de marketplace. */
const RATING_SHARE = 0.3;

@Injectable()
export class TrendEngineService {
  constructor(private readonly rules: BusinessRulesService) {}

  calculateFromSnapshots(
    snapshots: TrendSnapshotInput[],
    category?: string,
  ): TrendScoreBreakdown {
    const ordered = [...snapshots].sort(
      (a, b) => a.collectedAt.getTime() - b.collectedAt.getTime(),
    );

    const first = ordered.at(0);
    const latest = ordered.at(-1);

    if (!first || !latest) {
      return this.emptyScore();
    }

    const signalScore = this.rules.normalizeSalesSignal(
      latest.salesSignalRaw,
      latest.salesSignalType,
    );

    if (!this.hasMinimumRelevance(latest, signalScore, category)) {
      return this.emptyScore();
    }

    const earliestTime = ordered[0].collectedAt.getTime();
    const latestTime = ordered[ordered.length - 1].collectedAt.getTime();
    const firstGroup = ordered.filter(
      (s) => Math.abs(s.collectedAt.getTime() - earliestTime) <= 24 * 3600 * 1000,
    );
    const latestGroup = ordered.filter(
      (s) => Math.abs(s.collectedAt.getTime() - latestTime) <= 24 * 3600 * 1000,
    );

    const avg = (items: number[]) =>
      items.length ? items.reduce((a, b) => a + b, 0) / items.length : null;

    const firstSignal = avg(
      firstGroup
        .map((s) => s.salesSignalRaw)
        .filter((v): v is number => v !== null && v !== undefined && v > 0),
    );
    const latestSignal = avg(
      latestGroup
        .map((s) => s.salesSignalRaw)
        .filter((v): v is number => v !== null && v !== undefined && v > 0),
    );

    const firstReviews = avg(
      firstGroup
        .map((s) => s.reviewCount)
        .filter((v): v is number => v !== null && v !== undefined),
    );
    const latestReviews = avg(
      latestGroup
        .map((s) => s.reviewCount)
        .filter((v): v is number => v !== null && v !== undefined),
    );

    const firstPrice = avg(
      firstGroup
        .map((s) => s.priceMin)
        .filter((v): v is number => v !== null && v !== undefined && v > 0),
    );
    const latestPrice = avg(
      latestGroup
        .map((s) => s.priceMin)
        .filter((v): v is number => v !== null && v !== undefined && v > 0),
    );

    // --- Componente de crescimento (exige série histórica) ----------------
    const isRank =
      this.isRankSignal(latest.salesSignalType) ||
      this.isRankSignal(first.salesSignalType);
    const reviewGrowth = this.relativeGrowth(firstReviews, latestReviews);
    const rawMarketplaceGrowth = this.relativeGrowth(firstSignal, latestSignal);
    const marketplaceGrowth = isRank ? -rawMarketplaceGrowth : rawMarketplaceGrowth;
    const priceChange = this.relativeGrowth(firstPrice, latestPrice);

    // --- Componente baseline (sinais absolutos do snapshot mais recente) ---
    const baseline = this.baselineComponents(latest, signalScore);

    const weights = this.rules.getTrendWeights();
    const breakdown = {
      searchGrowthScore: this.rules.clamp(
        this.normalizeGrowth(marketplaceGrowth) * 0.85 +
          BASELINE_WEIGHT * baseline.marketplace * 0.9,
      ),
      marketplaceGrowthScore: this.rules.clamp(
        this.normalizeGrowth(marketplaceGrowth) +
          BASELINE_WEIGHT * baseline.marketplace,
      ),
      supplierGrowthScore: this.rules.clamp(
        BASELINE_WEIGHT * baseline.marketplace * 0.95,
      ),
      priceOpportunityScore: this.rules.clamp(
        this.normalizePriceOpportunity(priceChange) +
          BASELINE_WEIGHT * baseline.price,
      ),
      reviewVelocityScore: this.rules.clamp(
        this.normalizeGrowth(reviewGrowth) + BASELINE_WEIGHT * baseline.reviews,
      ),
      socialBuzzScore: latest.marketplace.match(/douyin|xiaohongshu/)
        ? signalScore
        : this.rules.clamp(BASELINE_WEIGHT * baseline.reviews * 0.8),
      trendScore: 0,
    };

    const activeWeights =
      weights.marketplaceGrowth +
      weights.priceOpportunity +
      weights.reviewVelocity +
      weights.searchGrowth +
      weights.supplierGrowth +
      weights.socialBuzz;

    const rawScore =
      breakdown.searchGrowthScore * weights.searchGrowth +
      breakdown.marketplaceGrowthScore * weights.marketplaceGrowth +
      breakdown.supplierGrowthScore * weights.supplierGrowth +
      breakdown.priceOpportunityScore * weights.priceOpportunity +
      breakdown.reviewVelocityScore * weights.reviewVelocity +
      breakdown.socialBuzzScore * weights.socialBuzz;

    breakdown.trendScore = this.rules.clamp(rawScore / Math.max(activeWeights, 0.1));

    return breakdown;
  }

  /**
   * Sinais absolutos disponíveis no snapshot mais recente, já normalizados em
   * 0–1. São a única fonte de score enquanto não há série histórica.
   */
  private baselineComponents(
    latest: TrendSnapshotInput,
    signalScore: number,
  ): { marketplace: number; price: number; reviews: number } {
    // Volume: o melhor entre o sinal de vendas normalizado pelas regras
    // (que já trata best_seller_rank com semântica invertida) e o volume de
    // reviews em escala logarítmica.
    const reviewVolume = this.rules.normalizeVolumeLog(latest.reviewCount);
    const volumeScore = Math.max(signalScore, reviewVolume);
    const ratingScore = this.normalizeRating(latest.rating);
    const priceScore =
      latest.priceMin !== null &&
      latest.priceMin !== undefined &&
      latest.priceMin > 0
        ? PRICE_PRESENCE_CREDIT
        : 0;

    return {
      marketplace: this.rules.clamp(
        volumeScore * (1 - RATING_SHARE) + ratingScore * RATING_SHARE,
      ),
      price: priceScore,
      reviews: reviewVolume,
    };
  }

  /**
   * Portão de relevância mínima. O volume bruto (reviews / sinal de vendas)
   * continua valendo, mas um sinal de rank forte também qualifica o cluster —
   * `best_seller_rank` é posição, não volume, e compará-lo com
   * `minimumVolumeByCategory` não faz sentido.
   */
  private hasMinimumRelevance(
    latest: TrendSnapshotInput,
    signalScore: number,
    category?: string,
  ): boolean {
    const minimumVolume = this.rules.getMinimumVolume(category);
    const rawVolume =
      latest.reviewCount ??
      (this.isRankSignal(latest.salesSignalType) ? null : latest.salesSignalRaw);

    if (rawVolume !== null && rawVolume !== undefined && rawVolume >= minimumVolume) {
      return true;
    }

    return signalScore > 0;
  }

  /**
   * Crescimento do sinal de vendas entre o primeiro e o último snapshot.
   * Para `best_seller_rank` o sinal é invertido: cair de rank 5000 para 500 é
   * melhora, não queda de volume.
   */
  private signalGrowth(
    first: TrendSnapshotInput,
    latest: TrendSnapshotInput,
  ): number {
    const growth = this.relativeGrowth(
      first.salesSignalRaw,
      latest.salesSignalRaw,
    );

    const isRank =
      this.isRankSignal(latest.salesSignalType) ||
      this.isRankSignal(first.salesSignalType);

    return isRank ? -growth : growth;
  }

  private isRankSignal(type: SalesSignalType | null | undefined): boolean {
    return type === 'best_seller_rank';
  }

  /**
   * Rating (0–5) em 0–1: só diferencia acima de {@link RATING_FLOOR}, porque
   * abaixo disso a nota é sinal negativo e não deve render pontos.
   */
  private normalizeRating(rating: number | null | undefined): number {
    if (rating === null || rating === undefined || Number.isNaN(rating)) {
      return 0;
    }

    return this.rules.clamp(
      (rating - RATING_FLOOR) / (RATING_CEILING - RATING_FLOOR),
    );
  }

  private emptyScore(): TrendScoreBreakdown {
    return {
      searchGrowthScore: 0,
      marketplaceGrowthScore: 0,
      supplierGrowthScore: 0,
      priceOpportunityScore: 0,
      reviewVelocityScore: 0,
      socialBuzzScore: 0,
      trendScore: 0,
    };
  }

  private relativeGrowth(
    start?: number | null,
    end?: number | null,
  ): number {
    if (start === null || start === undefined || end === null || end === undefined) {
      return 0;
    }

    return (end - start) / Math.max(Math.abs(start), 1);
  }

  private normalizeGrowth(value: number): number {
    return this.rules.clamp(Math.max(0, value) / 2);
  }

  private normalizePriceOpportunity(priceChange: number): number {
    return this.rules.clamp(-priceChange);
  }
}
