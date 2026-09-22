import { describe, expect, it } from 'vitest';
import { formatGrowth, trendPolyline } from './search-trend-format';

describe('search-trend-format', () => {
  it('polyline escala 0–100 na altura e distribui na largura', () => {
    const pts = [
      { weekStart: '2026-01-01', value: 0, partial: false },
      { weekStart: '2026-01-08', value: 100, partial: false },
      { weekStart: '2026-01-15', value: 50, partial: true },
    ];
    expect(trendPolyline(pts, 200, 100)).toBe('0,100 100,0 200,50');
  });

  it('um ponto ou nenhum', () => {
    expect(trendPolyline([], 200, 100)).toBe('');
    expect(trendPolyline([{ weekStart: 'x', value: 40, partial: false }], 200, 100)).toBe('0,60');
  });

  it('formatGrowth', () => {
    expect(formatGrowth(0.712)).toBe('+71%');
    expect(formatGrowth(-0.09)).toBe('−9%');
    expect(formatGrowth(0)).toBe('0%');
    expect(formatGrowth(null)).toBe('—');
  });
});
