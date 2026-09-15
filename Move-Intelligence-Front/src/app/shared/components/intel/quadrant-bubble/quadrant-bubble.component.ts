import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import type { EChartsCoreOption } from 'echarts/core';
import { TrendProduct } from '../../../../core/models/contract.models';
import { ChartComponent } from '../../../ui/chart/chart.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { readEchartsTheme, type EchartsTheme } from '../../../charts/echarts-theme';
import { ACTION_LABEL } from '../../../util/format';

/** P2-3: cores semânticas do tema (claro/escuro), sem hex fixo. */
function actionColors(palette: EchartsTheme): Record<string, string> {
  return {
    DECIDIR_AGORA: palette.success,
    NEGOCIAR_CUSTO: palette.warning,
    TESTAR_DEMANDA: palette.info,
    IGNORAR: palette.text3,
    DADOS_INSUFICIENTES: palette.text3,
  };
}

/**
 * D1: matriz de dispersão com bolhas (substitui a risk-matrix de 3 níveis).
 * X = momentum growth_pct, Y = Move Score, cortes 70/50 e ±10%, cor = ação,
 * tamanho = receita projetada ou volume. Hover com nome/score/ação; clique abre o dossiê.
 */
@Component({
  selector: 'app-quadrant-bubble',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent],
  template: `
    <section class="bubble-panel surface-panel" aria-label="Matriz de decisão">
      <header class="panel-heading">
        <div>
          <span class="eyebrow">Matriz de decisão</span>
          <h2>Tendência × Move Score</h2>
          <p>Verde &gt; 70 · Amarelo 50–70 · Sobe &gt; +10% em 8 semanas.</p>
        </div>
        <ul class="legend" aria-label="Legenda de ações">
          @for (item of legend(); track item.id) {
            <li><span class="dot" [style.background]="item.color"></span>{{ item.label }}</li>
          }
        </ul>
      </header>
      @if (plotted().length) {
        <app-chart [options]="options()" label="Matriz tendência versus Move Score" (pointClick)="openDossier($event)" />
      } @else {
        <p class="chart-empty">
          Nenhum produto com Move Score e momentum calculados ainda. A matriz é preenchida após o
          próximo cálculo de score.
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .bubble-panel {
        display: grid;
        gap: var(--sp-4);
        padding: var(--sp-5);
        border-radius: var(--r-md);
      }
      .panel-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: var(--sp-3) var(--sp-4);
      }
      .eyebrow {
        color: var(--brand-text);
        font-size: var(--fs-label);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .panel-heading h2 {
        margin: var(--sp-1) 0;
        font-family: var(--font-display);
        font-size: var(--fs-h2);
        line-height: var(--lh-h2);
      }
      .panel-heading p {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-sm);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2) var(--sp-4);
        margin: 0;
        padding: 0;
        color: var(--text-2);
        font-size: var(--fs-caption);
        list-style: none;
      }
      .legend li {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      app-chart {
        display: block;
        height: 380px;
      }
      .chart-empty {
        display: grid;
        place-items: center;
        min-height: 200px;
        margin: 0;
        padding: var(--sp-5);
        color: var(--text-3);
        font-size: var(--fs-sm);
        text-align: center;
        border: 1px dashed var(--border-strong);
        border-radius: var(--r-sm);
      }
      @media (max-width: 767px) {
        .bubble-panel {
          padding: var(--sp-4);
        }
        app-chart {
          height: 300px;
        }
      }
    `,
  ],
})
export class QuadrantBubbleComponent {
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  readonly products = input<TrendProduct[]>([]);

  readonly legend = computed(() => {
    this.theme.theme();
    const colors = actionColors(readEchartsTheme());
    return ['DECIDIR_AGORA', 'NEGOCIAR_CUSTO', 'TESTAR_DEMANDA', 'IGNORAR'].map((id) => ({
      id,
      label: ACTION_LABEL[id],
      color: colors[id],
    }));
  });

  /** Só entram na matriz produtos com Move Score e momentum calculados. */
  readonly plotted = computed(() =>
    this.products().filter(
      (p) =>
        p.moveScore !== null &&
        p.moveScore !== undefined &&
        p.momentum?.growthPct !== null &&
        p.momentum?.growthPct !== undefined,
    ),
  );

  openDossier(params: unknown): void {
    const id = (params as { data?: { value?: [number, number, number, string, string] } }).data?.value?.[4];
    if (id) void this.router.navigate(['/tendencia', id]);
  }

  readonly options = computed<EChartsCoreOption>(() => {
    this.theme.theme();
    const palette = readEchartsTheme();
    const colors = actionColors(palette);
    const points = this.plotted();
    const maxRevenue = Math.max(1, ...points.map((p) => p.projectedRevenue ?? 0));
    const byAction = new Map<string, typeof points>();
    for (const p of points) {
      const key = p.action ?? 'DADOS_INSUFICIENTES';
      byAction.set(key, [...(byAction.get(key) ?? []), p]);
    }
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = (params as { data?: { name?: string; value?: [number, number, number, string, string] } }).data;
          if (!d?.value) return '';
          const [x, y, , action, id] = d.value;
          void id;
          return `<strong>${d.name ?? ''}</strong><br/>Move Score ${y} · ${x >= 0 ? '+' : ''}${x}%<br/>${ACTION_LABEL[action] ?? action}`;
        },
      },
      grid: { left: 48, right: 24, top: 32, bottom: 48 },
      xAxis: {
        type: 'value',
        name: 'Momentum (8s %)',
        nameLocation: 'middle',
        nameGap: 32,
        axisLine: { lineStyle: { color: palette.border } },
        splitLine: { lineStyle: { color: palette.border } },
      },
      yAxis: {
        type: 'value',
        name: 'Move Score',
        min: 0,
        max: 100,
        axisLine: { lineStyle: { color: palette.border } },
        splitLine: { lineStyle: { color: palette.border } },
      },
      series: [
        // Linhas de corte: Y=70/50, X=±10.
        {
          type: 'line',
          markLine: {
            silent: true,
            symbol: 'none',
            label: { fontSize: 10 },
            data: [
              { yAxis: 70, name: 'verde 70' },
              { yAxis: 50, name: 'amarelo 50' },
              { xAxis: 10, name: '+10%' },
              { xAxis: -10, name: '-10%' },
            ],
          },
          data: [],
        },
        ...[...byAction.entries()].map(([action, list]) => ({
          type: 'scatter' as const,
          name: action,
          data: list.map((p) => ({
            name: p.canonicalName,
            value: [
              p.momentum?.growthPct ?? 0,
              p.moveScore ?? 0,
              Math.max(8, Math.round((((p.projectedRevenue ?? 0) / maxRevenue) || 0.05) * 32)),
              p.action ?? '',
              p.productClusterId,
            ],
          })),
          symbolSize: (val: [number, number, number]) => val[2],
          itemStyle: { color: colors[action] ?? palette.chart1, opacity: 0.8 },
          emphasis: { focus: 'series' as const },
        })),
      ],
    };
  });
}
