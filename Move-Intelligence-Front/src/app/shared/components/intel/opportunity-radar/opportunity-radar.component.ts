import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { Indicator } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme, withAlpha } from '../../../charts/echarts-theme';

/** As 6 dimensões documentadas do breakdown, na ordem do radar. */
const SIGNAL_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: 'marketplaceGrowth', label: 'Marketplace' },
  { key: 'supplierGrowth', label: 'Fornecedores' },
  { key: 'priceOpportunity', label: 'Preço' },
  { key: 'reviewVelocity', label: 'Reviews' },
  { key: 'searchGrowth', label: 'Busca' },
  { key: 'socialBuzz', label: 'Social' },
];

export interface RadarDimension {
  key: string;
  label: string;
  /** 0–100; null = sem coleta para esta dimensão. */
  percent: number | null;
  explanation: string | null;
}

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

  /** Só as 6 dimensões do radar; outras chaves de sinais (ex.: google_trends_BR) ficam fora. */
  readonly allDimensions = computed<RadarDimension[]>(() => {
    const signals = this.signals() ?? {};
    return SIGNAL_DIMENSIONS.map(({ key, label }) => {
      const indicator = signals[key];
      const value = indicator?.value;
      return {
        key,
        label,
        percent: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : clampPercent(Number(value)),
        explanation: indicator?.explanation ?? null,
      };
    });
  });

  /** P1-3: dimensões com valor real (nunca 0 por falta de coleta — B6). */
  readonly dimensions = computed(() => this.allDimensions().filter((d) => d.percent !== null));
  readonly missing = computed(() => this.allDimensions().filter((d) => d.percent === null));

  readonly options = computed<EChartsCoreOption>(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    const dimensions = this.dimensions();
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      radar: {
        indicator: dimensions.map((dimension) => ({ name: dimension.label, max: 100 })),
        radius: '66%',
        splitNumber: 4,
        splitLine: { lineStyle: { color: palette.border } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: palette.border } },
        axisName: { color: palette.text2, fontSize: 12 },
      },
      series: [
        {
          type: 'radar',
          data: [{ value: dimensions.map((dimension) => dimension.percent ?? 0), name: 'Sub-sinais' }],
          symbolSize: 5,
          areaStyle: { color: withAlpha(palette.chart1, 0.18) },
          lineStyle: { color: palette.chart1, width: 2 },
          itemStyle: { color: palette.chart1 },
        },
      ],
    };
  });
}

/** Sub-sinais já chegam em 0–100 da API. */
function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}
