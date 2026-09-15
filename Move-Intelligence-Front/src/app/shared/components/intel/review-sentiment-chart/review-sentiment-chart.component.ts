import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { ReviewSentiment } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme, withAlpha } from '../../../charts/echarts-theme';

const intFmt = new Intl.NumberFormat('pt-BR');

function ratingText(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

function shareText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

/**
 * Avaliações por semana: novas positivas (4–5★) e negativas (1–2★) em linhas,
 * nota média no eixo da direita. Neutras (3★) aparecem só no tooltip.
 */
@Component({
  selector: 'app-review-sentiment-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  template: `
    <section class="chart-card surface-panel">
      <header>
        <div>
          <span class="chart-title">Avaliações por semana</span>
          <small class="chart-subtitle">Novas avaliações por semana e nota média</small>
        </div>
        @if (data().totals; as totals) {
          <dl class="chart-stats">
            <div>
              <dt>Nota média</dt>
              <dd class="num">{{ rating(totals.avgRating) }}</dd>
            </div>
            <div>
              <dt>Positivas</dt>
              <dd class="num positive">{{ share(totals.positiveShare) }}</dd>
            </div>
            <div>
              <dt>Negativas</dt>
              <dd class="num negative">{{ share(totals.negativeShare) }}</dd>
            </div>
          </dl>
        }
      </header>
      @if (data().points.length) {
        <app-chart [options]="options()" label="Avaliações positivas, negativas e nota média por semana" />
        @if (data().totals; as totals) {
          <p class="totals-note num">
            Na janela: {{ int(totals.positive) }} positivas · {{ int(totals.neutral) }} neutras · {{ int(totals.negative) }} negativas
          </p>
        }
      } @else {
        <p class="empty-note">Sem avaliações novas coletadas nesta janela.</p>
      }
    </section>
  `,
  styles: [
    `
      .chart-card {
        border-radius: var(--r-md);
        padding: var(--sp-4);
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--sp-4);
        margin-bottom: var(--sp-2);
      }
      .chart-title {
        display: block;
        color: var(--text);
        font-size: var(--fs-body);
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .chart-subtitle {
        display: block;
        margin-top: var(--sp-1);
        color: var(--text-2);
        font-size: var(--fs-caption);
      }
      header > div:first-child {
        flex: 1 1 auto;
        min-width: 0;
      }
      .chart-stats {
        display: flex;
        flex: 0 0 auto;
        flex-wrap: nowrap;
        justify-content: flex-end;
        margin: 0;
      }
      .chart-stats div {
        display: grid;
        gap: 2px;
        padding: 0 var(--sp-3);
        text-align: right;
        border-left: 1px solid var(--border);
      }
      .chart-stats div:first-child {
        border-left: 0;
      }
      .chart-stats dt {
        color: var(--text-3);
        font-size: var(--fs-label);
        white-space: nowrap;
      }
      .chart-stats dd {
        margin: 0;
        color: var(--text);
        font-size: var(--fs-sm);
        font-weight: 700;
      }
      .chart-stats dd.positive {
        color: var(--success);
      }
      .chart-stats dd.negative {
        color: var(--danger);
      }
      app-chart {
        display: block;
        height: 320px;
      }
      .totals-note,
      .empty-note {
        margin: var(--sp-2) 0 0;
        color: var(--text-3);
        font-size: var(--fs-caption);
      }
      @media (max-width: 767px) {
        header {
          flex-direction: column;
          gap: var(--sp-3);
        }
        .chart-stats {
          justify-content: flex-start;
        }
        .chart-stats div {
          text-align: left;
        }
        .chart-stats div:first-child {
          padding-left: 0;
        }
      }
    `,
  ],
})
export class ReviewSentimentChartComponent {
  private readonly theme = inject(ThemeService);
  readonly data = input.required<ReviewSentiment>();

  rating = ratingText;
  share = shareText;
  int(value: number): string {
    return intFmt.format(value);
  }

  readonly options = computed<EChartsCoreOption>(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#ef4444';
    const points = this.data().points;
    const labels = points.map((p) => new Date(p.t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    const ratings = points.map((p) => p.avgRating).filter((v): v is number => v !== null && v !== undefined);
    const minRating = ratings.length ? Math.max(1, Math.floor(Math.min(...ratings) * 2) / 2 - 0.5) : 1;

    return {
      backgroundColor: 'transparent',
      grid: { left: 12, right: 12, top: 40, bottom: 8, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 3,
        textStyle: { color: palette.text2, fontSize: 12 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: palette.text, fontSize: 12 },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const index = (list[0] as { dataIndex?: number })?.dataIndex ?? -1;
          const p = points[index];
          if (!p) return '';
          const row = (color: string, label: string, value: string) =>
            `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px;"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${label}</span><strong>${value}</strong></div>`;
          return `<div style="color:${palette.text2};margin-bottom:4px;">Semana de ${labels[index]}</div>` +
            row(palette.chart1, 'Nota média', ratingText(p.avgRating)) +
            row(palette.success, 'Positivas (4–5★)', intFmt.format(p.positive)) +
            row(palette.text3, 'Neutras (3★)', intFmt.format(p.neutral)) +
            row(danger, 'Negativas (1–2★)', intFmt.format(p.negative));
        },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: { color: palette.text3, fontSize: 12 },
        axisLine: { lineStyle: { color: palette.border } },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Avaliações',
          nameTextStyle: { color: palette.text3, fontSize: 11, align: 'left' },
          axisLabel: { color: palette.text3, fontSize: 12, formatter: (v: number) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v) },
          splitLine: { lineStyle: { color: palette.border, type: 'dashed' } },
        },
        {
          type: 'value',
          name: 'Nota',
          min: minRating,
          max: 5,
          nameTextStyle: { color: palette.text3, fontSize: 11, align: 'right' },
          axisLabel: { color: palette.text3, fontSize: 12, formatter: (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Positivas (4–5★)',
          type: 'line',
          showSymbol: false,
          data: points.map((p) => p.positive),
          lineStyle: { color: palette.success, width: 2.5 },
          itemStyle: { color: palette.success },
          areaStyle: { color: withAlpha(palette.success, 0.08) },
        },
        {
          name: 'Negativas (1–2★)',
          type: 'line',
          showSymbol: false,
          data: points.map((p) => p.negative),
          lineStyle: { color: danger, width: 2.5 },
          itemStyle: { color: danger },
        },
        {
          name: 'Nota média',
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.3,
          showSymbol: points.length <= 30,
          symbolSize: 5,
          connectNulls: true,
          data: points.map((p) => p.avgRating),
          lineStyle: { color: palette.chart1, width: 2, type: 'dashed' },
          itemStyle: { color: palette.chart1 },
        },
      ],
    };
  });
}
