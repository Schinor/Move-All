import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { MonteCarloPricePoint } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';

@Component({
  selector: 'app-price-curve-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  templateUrl: './price-curve-chart.component.html',
  styleUrl: './price-curve-chart.component.css',
})
export class PriceCurveChartComponent {
  readonly points = input<MonteCarloPricePoint[]>([]);

  readonly options = computed<EChartsCoreOption>(() => ({
    backgroundColor: 'transparent',
    grid: { left: 16, right: 16, top: 18, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: this.points().map((point) => this.formatBRL(point.price)),
      axisLabel: { color: '#9aa7a9', rotate: 30 },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.14)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#9aa7a9',
        formatter: (value: number) => this.formatBRL(value),
      },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.08)' } },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: this.points().map((point) => point.medianVpl),
        lineStyle: { color: '#66d9a5', width: 2 },
        areaStyle: { color: 'rgba(77, 220, 155, .14)' },
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
