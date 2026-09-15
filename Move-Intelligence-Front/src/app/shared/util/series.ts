/**
 * P1-2: agregação mensal no front a partir dos pontos (diários) da série.
 *
 * Módulo PURO (sem Angular): mês incompleto (primeiro/último da janela com
 * menos dias) é marcado como "parcial" e nunca extrapolado. Nada inventado
 * em mês sem dado.
 */

export interface SeriesPointLike {
  t: string;
  v: number;
}

export type MonthlyMetric = 'volume' | 'price' | 'review';

export interface MonthlyBucket {
  /** Rótulo curto: `jul/26`. */
  label: string;
  year: number;
  month: number;
  value: number;
  /** Variação contra o mês anterior (null no primeiro ou sem base). */
  changePct: number | null;
  partial: boolean;
}

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_SHORT[month]}/${String(year).slice(-2)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Agrega pontos em meses do calendário.
 * - Volume: soma das semanas/dias do mês.
 * - Preço: média do mês.
 * - Avaliações (série acumulada): último valor do mês; a diferença do mês é
 *   `último - último do mês anterior` (no primeiro mês, `último - primeiro`).
 */
export function aggregateMonthly(
  points: SeriesPointLike[],
  metric: MonthlyMetric,
): MonthlyBucket[] {
  const valid = points
    .map((p) => ({ date: new Date(p.t), v: Number(p.v) }))
    .filter((p) => !Number.isNaN(p.date.getTime()) && Number.isFinite(p.v))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (valid.length === 0) return [];

  const groups = new Map<string, { year: number; month: number; items: { date: Date; v: number }[] }>();
  for (const p of valid) {
    const year = p.date.getUTCFullYear();
    const month = p.date.getUTCMonth();
    const key = `${year}-${month}`;
    const group = groups.get(key) ?? { year, month, items: [] };
    group.items.push(p);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort((a, b) => a.year - b.year || a.month - b.month);
  // Avaliações novas por mês (série acumulada): último − base anterior.
  const reviewCreated = ordered.map((group, index) =>
    reviewCreatedInMonth(group, index > 0 ? ordered[index - 1] : null),
  );
  return ordered.map((group, index) => {
    const values = group.items.map((i) => i.v);
    let value: number;
    if (metric === 'price') {
      value = values.reduce((a, b) => a + b, 0) / values.length;
    } else if (metric === 'review') {
      // Exibe avaliações novas no mês (a série é acumulada).
      value = reviewCreated[index];
    } else {
      value = values.reduce((a, b) => a + b, 0);
    }
    const firstDay = group.items[0].date.getUTCDate();
    const lastDay = group.items[group.items.length - 1].date.getUTCDate();
    // Mês incompleto: primeiro/último da janela sem cobrir o mês cheio.
    const partial =
      (index === 0 && firstDay > 1) ||
      (index === ordered.length - 1 && lastDay < daysInMonth(group.year, group.month));

    let changePct: number | null = null;
    if (metric === 'review') {
      const prev = index > 0 ? reviewCreated[index - 1] : null;
      changePct = prev !== null && prev !== 0 ? ((reviewCreated[index] - prev) / Math.abs(prev)) * 100 : null;
    } else {
      const prev = index > 0 ? bucketValue(ordered[index - 1], metric) : null;
      changePct = prev !== null && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
    }
    return {
      label: monthLabel(group.year, group.month),
      year: group.year,
      month: group.month,
      value: Math.round(value * 100) / 100,
      changePct: changePct === null ? null : Math.round(changePct * 10) / 10,
      partial,
    };
  });
}

function bucketValue(
  group: { items: { v: number }[] },
  metric: MonthlyMetric,
): number | null {
  const values = group.items.map((i) => i.v);
  if (values.length === 0) return null;
  if (metric === 'price') return values.reduce((a, b) => a + b, 0) / values.length;
  if (metric === 'review') return values[values.length - 1];
  return values.reduce((a, b) => a + b, 0);
}

/** Avaliações novas no mês (série acumulada): último − base anterior. */
export function reviewCreatedInMonth(
  current: { items: { v: number }[] },
  previous: { items: { v: number }[] } | null,
): number {
  const last = current.items[current.items.length - 1].v;
  const base = previous
    ? previous.items[previous.items.length - 1].v
    : current.items[0].v;
  return last - base;
}
