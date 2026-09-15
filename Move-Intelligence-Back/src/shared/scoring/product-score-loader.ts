/**
 * Leitura do Move Score vigente (F2.5, Fase 2). O score oficial mora em
 * `ProductScore`; o vigente por cluster é o de maior `computedAt`.
 * Usado por `/trends/products`, `/trends/products/:id`, `/recommendations`
 * e `/products/compare` — uma única query por chamada.
 */

export interface LatestMoveScore {
  moveScore: number | null;
  decision: string | null;
  dataConfidence: string | null;
  pVplPositivo: number | null;
  cvar5: number | null;
  action: string | null;
  scoreBand: 'green' | 'yellow' | 'red' | null;
  momentumDirection: string | null;
  momentumGrowthPct: number | null;
  momentumConfidence: string | null;
  riskExplanation: string | null;
  riskDrivers: Array<{ factor: string; share: number }> | null;
  /** Premissas do Monte Carlo (preço de venda, custo, frete, impostos, câmbio). */
  premises?: Record<string, number> | null;
}

export const EMPTY_MOVE_SCORE: LatestMoveScore = {
  moveScore: null,
  decision: null,
  dataConfidence: null,
  pVplPositivo: null,
  cvar5: null,
  action: null,
  scoreBand: null,
  momentumDirection: null,
  momentumGrowthPct: null,
  momentumConfidence: null,
  riskExplanation: null,
  riskDrivers: null,
  premises: null,
};

type ScoreRow = {
  productClusterId: string;
  score: number | null;
  decision: string;
  dataConfidence: string;
  pVplPositivo: number | null;
  cvar5: number | null;
  computedAt: Date;
  action?: string | null;
  scoreBand?: string | null;
  momentumDirection?: string | null;
  momentumGrowthPct?: number | null;
  momentumConfidence?: string | null;
  riskExplanation?: string | null;
  riskDrivers?: unknown;
  premises?: unknown;
};

type ScoreDelegate = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (args: any) => Promise<ScoreRow[]>;
};

/**
 * Último `ProductScore` por cluster (ordem `computedAt` desc, primeiro vence).
 * Sem linhas → mapa vazio (chamador usa `EMPTY_MOVE_SCORE`).
 */
export async function loadLatestMoveScores(
  prisma: { productScore: ScoreDelegate },
  productClusterIds: string[],
): Promise<Map<string, LatestMoveScore>> {
  const ids = [...new Set(productClusterIds.filter(Boolean))];
  const scores = new Map<string, LatestMoveScore>();
  if (ids.length === 0) {
    return scores;
  }
  const rows = await prisma.productScore.findMany({
    where: { productClusterId: { in: ids } },
    orderBy: { computedAt: 'desc' },
  });
  for (const row of rows) {
    if (scores.has(row.productClusterId)) {
      continue;
    }
    const band =
      row.scoreBand === 'green' || row.scoreBand === 'yellow' || row.scoreBand === 'red'
        ? row.scoreBand
        : null;
    let drivers: Array<{ factor: string; share: number }> | null = null;
    if (Array.isArray(row.riskDrivers)) {
      drivers = (row.riskDrivers as Array<Record<string, unknown>>)
        .filter((d) => typeof d?.factor === 'string' && Number.isFinite(Number(d?.share)))
        .map((d) => ({ factor: String(d.factor), share: Number(d.share) }));
    }
    scores.set(row.productClusterId, {
      moveScore: row.score,
      decision: row.decision,
      dataConfidence: row.dataConfidence,
      pVplPositivo: row.pVplPositivo === null ? null : Number(row.pVplPositivo),
      cvar5: row.cvar5 === null ? null : Number(row.cvar5),
      action: (row.action as string) ?? null,
      scoreBand: band,
      momentumDirection: (row.momentumDirection as string) ?? null,
      momentumGrowthPct:
        row.momentumGrowthPct === null || row.momentumGrowthPct === undefined
          ? null
          : Number(row.momentumGrowthPct),
      momentumConfidence: (row.momentumConfidence as string) ?? null,
      riskExplanation: (row.riskExplanation as string) ?? null,
      riskDrivers: drivers,
      premises:
        row.premises && typeof row.premises === 'object' && !Array.isArray(row.premises)
          ? (row.premises as Record<string, number>)
          : null,
    });
  }
  return scores;
}
