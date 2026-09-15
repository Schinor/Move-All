import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';

export type ReviewBand = '1-2' | '3' | '4-5';

export const REVIEW_BANDS: ReviewBand[] = ['1-2', '3', '4-5'];
const PROMPT_VERSION = 'review-summary@1';

function bandOf(stars: number | null | undefined): ReviewBand | null {
  if (stars === null || stars === undefined || !Number.isFinite(stars)) return null;
  if (stars <= 2) return '1-2';
  if (stars === 3) return '3';
  return '4-5';
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
}

/**
 * Validação B5: cada motivo precisa aparecer (ao menos uma palavra relevante)
 * em algum texto da amostra. Sem isso, descarta o resumo e registra em
 * ai_call_logs. A IA nunca calcula números — a contagem vem da distribuição.
 */
export function reasonGrounded(reason: string, samples: string[]): boolean {
  const sampleTokens = new Set<string>();
  for (const s of samples) for (const t of tokens(s)) sampleTokens.add(t);
  return tokens(reason).some((t) => sampleTokens.has(t));
}

@Injectable()
export class ReviewSummariesService {
  private readonly logger = new Logger(ReviewSummariesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterService,
  ) {}

  groupByBand(samples: Array<{ stars: number | null; text: string }>): Record<ReviewBand, string[]> {
    const out: Record<ReviewBand, string[]> = { '1-2': [], '3': [], '4-5': [] };
    for (const s of samples) {
      const band = bandOf(s.stars);
      if (band && s.text?.trim()) out[band].push(s.text.trim().slice(0, 2000));
    }
    return out;
  }

  async summarizeCluster(params: {
    productClusterId: string;
    samplesByBand: Record<ReviewBand, string[]>;
    reviewsCountAt?: number | null;
  }): Promise<Array<{ band: ReviewBand; summary: string }>> {
    const results: Array<{ band: ReviewBand; summary: string }> = [];
    for (const band of REVIEW_BANDS) {
      const texts = (params.samplesByBand[band] ?? []).slice(0, 30);
      if (texts.length === 0) continue;
      const saved = await this.summarizeBand({
        productClusterId: params.productClusterId,
        band,
        texts,
        reviewsCountAt: params.reviewsCountAt ?? null,
      });
      if (saved) results.push({ band, summary: saved.summary });
    }
    return results;
  }

  private async summarizeBand(params: {
    productClusterId: string;
    band: ReviewBand;
    texts: string[];
    reviewsCountAt: number | null;
  }): Promise<{ summary: string } | null> {
    const started = Date.now();
    const system = `Você resume avaliações de produto por faixa de estrelas. Responda APENAS JSON: {"band":"${params.band}","summary":"2-3 frases","top_reasons":["motivo1","motivo2","motivo3"],"sample_size":N}. Use só motivos que aparecem nos textos. Não invente números — a contagem vem da distribuição de estrelas.`;
    const user = `Faixa ${params.band} (${params.texts.length} amostras):\n${params.texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    let content = '';
    let model = 'unknown';
    try {
      const res = await this.openRouter.chatCompletion(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          endpointName: 'review_summary',
          temperature: 0.2,
          maxTokens: 1024,
          metadata: { productClusterId: params.productClusterId, band: params.band },
        },
      );
      content = res.content ?? '';
      model = res.model ?? 'unknown';
    } catch (err) {
      await this.logCall('review_summary', model, started, 'error', String(err), {
        productClusterId: params.productClusterId,
        band: params.band,
      });
      return null;
    }

    let parsed: { summary?: string; top_reasons?: string[]; sample_size?: number } = {};
    try {
      const clean = content.trim().startsWith('```')
        ? content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
        : content.trim();
      parsed = JSON.parse(clean);
    } catch {
      await this.logCall('review_summary', model, started, 'rejected_parse', content.slice(0, 2000), {
        productClusterId: params.productClusterId,
        band: params.band,
      });
      return null;
    }

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const reasons = Array.isArray(parsed.top_reasons)
      ? parsed.top_reasons.filter((r): r is string => typeof r === 'string').slice(0, 3)
      : [];
    if (!summary || reasons.length === 0) {
      await this.logCall('review_summary', model, started, 'rejected_empty', content.slice(0, 2000), {
        productClusterId: params.productClusterId,
        band: params.band,
      });
      return null;
    }
    // Validação: motivo fora da amostra → descarta e registra.
    const bad = reasons.filter((r) => !reasonGrounded(r, params.texts));
    if (bad.length > 0) {
      await this.logCall('review_summary', model, started, 'rejected_validation', JSON.stringify({ reasons, bad }), {
        productClusterId: params.productClusterId,
        band: params.band,
      });
      this.logger.warn(`Resumo descartado (${params.band}): motivo fora da amostra: ${bad.join('; ')}`);
      return null;
    }

    await (this.prisma as unknown as {
      reviewSummary: { create: (args: unknown) => Promise<unknown> };
    }).reviewSummary.create({
      data: {
        productClusterId: params.productClusterId,
        band: params.band,
        summary,
        topReasons: reasons,
        sampleSize: params.texts.length,
        reviewsCountAt: params.reviewsCountAt,
        model,
        promptVersion: PROMPT_VERSION,
      },
    });
    await this.logCall('review_summary', model, started, 'ok', null, {
      productClusterId: params.productClusterId,
      band: params.band,
      sampleSize: params.texts.length,
    });
    return { summary };
  }

  private async logCall(
    endpoint: string,
    model: string,
    started: number,
    status: string,
    error: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          endpoint,
          model,
          latencyMs: Date.now() - started,
          status,
          error,
          metadata: metadata as never,
        },
      });
    } catch {
      // Log é best-effort; nunca quebra o job.
    }
  }
}
