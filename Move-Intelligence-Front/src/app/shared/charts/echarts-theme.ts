export interface EchartsTheme {
  surface: string;
  text: string;
  text2: string;
  text3: string;
  border: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
}

const FALLBACK: EchartsTheme = {
  surface: '#ffffff',
  text: '#0a0a0b',
  text2: '#55565c',
  text3: '#7a7b82',
  border: '#e3e3e6',
  chart1: '#35b81a',
  chart2: '#1b7f9e',
  chart3: '#6b57d9',
  chart4: '#b08900',
  chart5: '#c42945',
  chart6: '#54585b',
};

function cssValue(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function readEchartsTheme(): EchartsTheme {
  return {
    surface: cssValue('--surface', FALLBACK.surface),
    text: cssValue('--text', FALLBACK.text),
    text2: cssValue('--text-2', FALLBACK.text2),
    text3: cssValue('--text-3', FALLBACK.text3),
    border: cssValue('--border', FALLBACK.border),
    chart1: cssValue('--chart-1', FALLBACK.chart1),
    chart2: cssValue('--chart-2', FALLBACK.chart2),
    chart3: cssValue('--chart-3', FALLBACK.chart3),
    chart4: cssValue('--chart-4', FALLBACK.chart4),
    chart5: cssValue('--chart-5', FALLBACK.chart5),
    chart6: cssValue('--chart-6', FALLBACK.chart6),
  };
}

export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '').trim();
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const red = Number.parseInt(hex.slice(0, 2), 16);
    const green = Number.parseInt(hex.slice(2, 4), 16);
    const blue = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  return color.startsWith('rgb(') ? color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`) : color;
}
