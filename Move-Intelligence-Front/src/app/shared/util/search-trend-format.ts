import { SearchTrendPoint } from '../../core/models/contract.models';

export function trendPolyline(points: SearchTrendPoint[], width: number, height: number): string {
  if (points.length === 0) return '';
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((point, index) => {
      const x = Math.round(index * step * 100) / 100;
      const y = Math.round((height - (point.value / 100) * height) * 100) / 100;
      return `${x},${y}`;
    })
    .join(' ');
}

export function formatGrowth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = Math.round(value * 100);
  if (pct === 0) return '0%';
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
