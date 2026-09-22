export interface SearchTrendRow {
  geo: string;
  status: string;
  term: string;
  capturedAt: Date;
  points: unknown;
  growth4w: number | null;
  growth12w: number | null;
}

/** Mais recente por país (BR antes de US), ignorando coletas com erro. */
export function latestSeriesByGeo<T extends SearchTrendRow>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    if (row.status === 'erro') continue;
    const current = best.get(row.geo);
    if (!current || row.capturedAt > current.capturedAt) best.set(row.geo, row);
  }
  return [...best.values()].sort((a, b) => a.geo.localeCompare(b.geo));
}
