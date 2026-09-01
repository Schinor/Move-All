import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { MonteCarloPricePoint } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme } from '../../../charts/echarts-theme';

@Component({
  selector: 'app-price-curve-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  templateUrl: './price-curve-chart.component.html',
  styleUrl: './price-curve-chart.component.css',
})
export class PriceCurveChartComponent {
  private readonly theme = inject(ThemeService);
  readonly points = input<MonteCarloPricePoint[]>([]);

  readonly options = computed<EChartsCoreOption>(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    return {
    backgroundColor: 'transparent',
    grid: { left: 16, right: 16, top: 18, bottom: 24, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: this.points().map((point) => this.formatBRL(point.price)),
      axisLabel: { color: palette.text3, rotate: 30 },
      axisLine: { lineStyle: { color: palette.border } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: palette.text3,
        formatter: (value: number) => this.formatBRL(value),
      },
      splitLine: { lineStyle: { color: palette.border } },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: this.points().map((point) => point.medianVpl),
        lineStyle: { color: palette.chart1, width: 2 },
      },
    ],
    };
  });

  private formatBRL(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
}
