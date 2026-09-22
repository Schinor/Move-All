import { latestSeriesByGeo } from './search-trends';

const row = (geo: string, status: string, at: string) => ({
  geo,
  status,
  term: 't',
  capturedAt: new Date(at),
  points: [],
  growth4w: null,
  growth12w: null,
});

describe('latestSeriesByGeo', () => {
  it('pega a coleta mais recente válida de cada país e ignora erro', () => {
    const out = latestSeriesByGeo([
      row('BR', 'erro', '2026-09-20'),
      row('BR', 'ok', '2026-09-13'),
      row('US', 'sem_volume', '2026-09-20'),
      row('BR', 'ok', '2026-09-06'),
    ]);
    expect(out.map((r) => [r.geo, r.status, r.capturedAt.toISOString().slice(0, 10)])).toEqual([
      ['BR', 'ok', '2026-09-13'],
      ['US', 'sem_volume', '2026-09-20'],
    ]);
  });
});
