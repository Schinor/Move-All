import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { SeriesPoint } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { IconComponent } from '../../../ui/icon/icon.component';

export type HistoryMetricType = 'volume' | 'price' | 'review';

@Component({
  selector: 'app-adoption-curve-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent, IconComponent],
  templateUrl: './adoption-curve-chart.component.html',
  styleUrl: './adoption-curve-chart.component.css',
})
export class AdoptionCurveChartComponent {
  readonly points = input<SeriesPoint[]>([]);
  readonly metric = input<HistoryMetricType>('volume');

  readonly config = computed(() => {
    switch (this.metric()) {
      case 'price':
        return {
          title: 'Evolução do Preço Médio',
          subtitle: 'Histórico de preços praticados nos anúncios mapeados',
          seriesName: 'Preço Médio',
          color: '#38bdf8',
          rgb: '56, 189, 248',
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
          color: '#a78bfa',
          rgb: '167, 139, 250',
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
          color: '#66d9a5',
          rgb: '102, 217, 165',
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

  readonly options = computed<EChartsCoreOption>(() => {
    const cfg = this.config();
    const pts = this.points();

    return {
      backgroundColor: 'transparent',
      grid: { left: 18, right: 24, top: 36, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(255, 255, 255, 0.15)',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: '#f8fafc', fontSize: 12 },
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params;
          if (!item) return '';
          const val = cfg.formatTooltip(item.value);
          return `<div style="font-weight:600;margin-bottom:6px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Semana de ${item.name}</div>
                  <div style="color:${cfg.color};font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cfg.color};"></span>
                    ${cfg.seriesName}: <span style="color:#ffffff;margin-left:4px;">${val}</span>
                  </div>`;
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: pts.map((point) =>
          new Date(point.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        ),
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: cfg.formatY,
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)', type: 'dashed' } },
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
            shadowColor: `rgba(${cfg.rgb}, 0.5)`,
            shadowBlur: 10,
          },
          itemStyle: {
            color: cfg.color,
            borderColor: '#0f172a',
            borderWidth: 2,
          },
          markPoint: {
            symbol: 'pin',
            symbolSize: 42,
            data: [
              { type: 'max', name: 'Pico', itemStyle: { color: '#f59e0b' } },
              { type: 'min', name: 'Início', itemStyle: { color: '#0ea5e9' } },
            ],
            label: {
              formatter: (p: any) => (p.name === 'Pico' ? 'Pico' : 'Base'),
              fontSize: 9,
              fontWeight: 'bold',
              color: '#000',
            },
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `rgba(${cfg.rgb}, 0.38)` },
                { offset: 0.8, color: `rgba(${cfg.rgb}, 0.05)` },
                { offset: 1, color: `rgba(${cfg.rgb}, 0.0)` },
              ],
            },
          },
        },
      ],
    };
  });
}

