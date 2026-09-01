import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { Indicator } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';

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
  readonly signals = input<Record<string, Indicator>>({});

  readonly options = computed<EChartsCoreOption>(() => {
    const keys = Object.keys(SIGNAL_LABELS);
    const values = keys.map((key) => this.toPercent(this.signals()[key]?.value ?? null));
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      radar: {
        indicator: keys.map((key) => ({ name: SIGNAL_LABELS[key], max: 100 })),
        radius: '68%',
        splitLine: { lineStyle: { color: 'rgba(255,255,255,.09)' } },
        splitArea: { areaStyle: { color: ['rgba(255,255,255,.02)', 'rgba(255,255,255,.04)'] } },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
        axisName: { color: '#9aa7a9', fontSize: 11 },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: values, name: 'Sub-sinais' }],
          areaStyle: { color: 'rgba(77, 220, 155, .22)' },
          lineStyle: { color: '#66d9a5', width: 2 },
          itemStyle: { color: '#66d9a5' },
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
