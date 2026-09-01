import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { Indicator } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme, withAlpha } from '../../../charts/echarts-theme';

const SIGNAL_LABELS: Record<string, string> = {
  marketplaceGrowth: 'Marketplace',
  supplierGrowth: 'Fornecedores',
  priceOpportunity: 'Preço',
  reviewVelocity: 'Reviews',
  searchGrowth: 'Busca',
  socialBuzz: 'Social',
};

@Component({
  selector: 'app-opportunity-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  templateUrl: './opportunity-radar.component.html',
  styleUrl: './opportunity-radar.component.css',
})
export class OpportunityRadarComponent {
  private readonly theme = inject(ThemeService);
  readonly signals = input<Record<string, Indicator>>({});

  readonly options = computed<EChartsCoreOption>(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    const keys = Object.keys(SIGNAL_LABELS);
    const values = keys.map((key) => this.toPercent(this.signals()[key]?.value ?? null));
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      radar: {
        indicator: keys.map((key) => ({ name: SIGNAL_LABELS[key], max: 100 })),
        radius: '68%',
        splitLine: { lineStyle: { color: palette.border } },
        splitArea: { areaStyle: { color: [palette.surface, palette.border] } },
        axisLine: { lineStyle: { color: palette.border } },
        axisName: { color: palette.text2, fontSize: 12 },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: values, name: 'Sub-sinais' }],
          areaStyle: { color: withAlpha(palette.chart1, 0.18) },
          lineStyle: { color: palette.chart1, width: 2 },
          itemStyle: { color: palette.chart1 },
        },
      ],
    };
  });

  private toPercent(value: number | null): number {
    if (value === null) {
      return 0;
    }
    return Math.round(Math.max(0, Math.min(100, value <= 1 ? value * 100 : value)));
  }
}
