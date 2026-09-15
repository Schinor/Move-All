import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { SeriesPoint } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme, withAlpha } from '../../../charts/echarts-theme';
import { aggregateMonthly } from '../../../util/series';

export type HistoryMetricType = 'volume' | 'price' | 'review';

const DAY_MS = 86_400_000;

function pctText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

@Component({
  selector: 'app-adoption-curve-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  templateUrl: './adoption-curve-chart.component.html',
  styleUrl: './adoption-curve-chart.component.css',
})
export class AdoptionCurveChartComponent {
  private readonly theme = inject(ThemeService);
  readonly points = input<SeriesPoint[]>([]);
  readonly previousPoints = input<SeriesPoint[]>([]);
  readonly metric = input<HistoryMetricType>('volume');
  readonly window = input<string>('30d');

  readonly config = computed(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    switch (this.metric()) {
      case 'price':
        return {
          title: 'Evolução do Preço Médio',
          subtitle: 'Histórico de preços praticados nos anúncios mapeados',
          seriesName: 'Preço Médio',
          color: palette.chart2,
          formatTooltip: (v: number) =>
            new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v),
          formatY: (v: number) =>
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              notation: 'compact',
            }).format(v),
        };
      case 'review':
        return {
          title: 'Evolução de Avaliações (Reviews)',
          subtitle: 'Volume acumulado de feedback e avaliações de compradores',
          seriesName: 'Total de Reviews',
          color: palette.chart3,
          formatTooltip: (v: number) => `${new Intl.NumberFormat('pt-BR').format(v)} avaliações`,
          formatY: (v: number) =>
            new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v),
        };
      case 'volume':
      default:
        return {
          title: 'Evolução do Volume de Vendas',
          subtitle: 'Histórico consolidado dos marketplaces mapeados',
          seriesName: 'Volume de Vendas',
          color: palette.chart1,
          formatTooltip: (v: number) => `${new Intl.NumberFormat('pt-BR').format(v)} un`,
          formatY: (v: number) =>
            new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v),
        };
    }
  });

  readonly growthPct = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return null;
    const first = pts[0].v;
    const last = pts[pts.length - 1].v;
    if (!first || first <= 0) return null;
    return Math.round(((last - first) / first) * 100);
  });

  /** P1-2: agregação mensal (soma/média/novas avaliações) + variação mês a mês. */
  readonly monthly = computed(() => aggregateMonthly(this.points(), this.metric()));
  readonly showMonthly = computed(() => this.window() !== '7d' && this.monthly().length > 0);
  readonly monthOverMonth = computed(() => {
    const months = this.monthly();
    if (months.length < 2) return null;
    return months[months.length - 1].changePct;
  });

  formatMonthValue(value: number): string {
    return this.config().formatTooltip(value);
  }

  deltaText(changePct: number | null): string {
    if (changePct === null || changePct === undefined) return '—';
    const arrow = changePct > 0 ? '▲' : changePct < 0 ? '▼' : '•';
    return `${arrow} ${pctText(changePct)}`;
  }

  deltaClass(changePct: number | null): string {
    if (changePct === null || changePct === undefined || changePct === 0) return '';
    return changePct > 0 ? 'positive' : 'negative';
  }

  readonly options = computed<EChartsCoreOption>(() => {
    const cfg = this.config();
    const pts = this.points();
    const palette = readEchartsTheme();

    // P1-2: referência por data (tolerância ±3 dias) para "vs semana/mês anterior".
    const timeOf = (p: SeriesPoint): number => new Date(p.t).getTime();
    const findRef = (index: number, daysBack: number): SeriesPoint | null => {
      const current = timeOf(pts[index]);
      if (!Number.isFinite(current)) return null;
      const target = current - daysBack * DAY_MS;
      let best: SeriesPoint | null = null;
      let bestDiff = Infinity;
      for (let i = 0; i < index; i++) {
        const t = timeOf(pts[i]);
        if (!Number.isFinite(t)) continue;
        const diff = Math.abs(t - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = pts[i];
        }
      }
      return bestDiff <= 3 * DAY_MS ? best : null;
    };
    const relPct = (value: number, base: number | null | undefined): string | null => {
      if (base === null || base === undefined || base === 0) return null;
      return pctText(((value - base) / Math.abs(base)) * 100);
    };

    return {
      backgroundColor: 'transparent',
      grid: { left: 18, right: 24, top: 36, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: palette.text, fontSize: 12 },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          if (!item) return '';
          const val = cfg.formatTooltip(item.value);
          const index = typeof item.dataIndex === 'number' ? item.dataIndex : -1;
          const extras: string[] = [];
          if (index > 0) {
            const week = findRef(index, 7);
            const weekPct = week ? relPct(item.value, week.v) : null;
            if (weekPct !== null) extras.push(`vs semana anterior: ${weekPct}`);
            const month = findRef(index, 28);
            const monthPct = month ? relPct(item.value, month.v) : null;
            if (monthPct !== null) extras.push(`vs mesmo período do mês anterior: ${monthPct}`);
          }
          const extraLines = extras
            .map(
              (line) =>
                `<div style="color:${palette.text2};font-size:12px;margin-top:4px;">${line}</div>`,
            )
            .join('');
          return `<div style="font-weight:600;margin-bottom:6px;color:${palette.text2};font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Semana de ${item.name}</div>
                  <div style="color:${cfg.color};font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cfg.color};"></span>
                    ${cfg.seriesName}: <span style="color:${palette.text};margin-left:4px;">${val}</span>
                  </div>${extraLines}`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: pts.map((point) =>
          new Date(point.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        ),
        axisLabel: { color: palette.text3, fontSize: 12 },
        axisLine: { lineStyle: { color: palette.border } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: palette.text3,
          fontSize: 12,
          formatter: cfg.formatY,
        },
        splitLine: { lineStyle: { color: palette.border, type: 'dashed' } },
      },
      series: [
        {
          name: cfg.seriesName,
          type: 'line',
          smooth: 0.35,
          showSymbol: pts.length <= 40,
          symbol: 'circle',
          symbolSize: 6,
          data: pts.map((point) => point.v),
          lineStyle: {
            color: cfg.color,
            width: 3.5,
          },
          itemStyle: {
            color: cfg.color,
            borderColor: palette.surface,
            borderWidth: 2,
          },
          markPoint: {
            symbol: 'pin',
            symbolSize: 42,
            data: [
              { type: 'max', name: 'Pico', itemStyle: { color: palette.chart4 } },
              { type: 'min', name: 'Início', itemStyle: { color: palette.chart2 } },
            ],
            label: {
              formatter: (p: any) => (p.name === 'Pico' ? 'Pico' : 'Base'),
              fontSize: 12,
              fontWeight: 'bold',
              color: '#000',
            },
          },
          areaStyle: { color: withAlpha(cfg.color, 0.12) },
        },
        // D4: período anterior tracejado (compare=previous).
        ...(this.previousPoints().length
          ? [
              {
                name: `${cfg.seriesName} (período anterior)`,
                type: 'line' as const,
                smooth: 0.35,
                showSymbol: false,
                data: this.previousPoints().map((point) => point.v),
                lineStyle: { color: palette.text3, width: 2, type: 'dashed' as const },
                itemStyle: { color: palette.text3 },
              },
            ]
          : []),
      ],
    };
  });
}
