import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { MonteCarloHistogramBin } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';

@Component({
  selector: 'app-monte-carlo-histogram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  templateUrl: './monte-carlo-histogram.component.html',
  styleUrl: './monte-carlo-histogram.component.css',
})
export class MonteCarloHistogramComponent {
  readonly bins = input<MonteCarloHistogramBin[]>([]);

  readonly options = computed<EChartsCoreOption>(() => ({
    backgroundColor: 'transparent',
    grid: { left: 16, right: 16, top: 18, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) =>
        new Intl.NumberFormat('pt-BR').format(Number(value)),
    },
    xAxis: {
      type: 'category',
      data: this.bins().map((bin) => this.formatBRL(bin.min)),
      axisLabel: { color: '#9aa7a9', rotate: 30 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.14)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#9aa7a9' },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.08)' } },
    },
    series: [
      {
        type: 'bar',
        data: this.bins().map((bin) => ({
          value: bin.count,
          itemStyle: { color: bin.max < 0 ? '#d86b6b' : '#66d9a5' },
        })),
        barWidth: '82%',
      },
    ],
  }));

  private formatBRL(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
}
