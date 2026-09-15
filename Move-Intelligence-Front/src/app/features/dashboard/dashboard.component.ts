import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../core/api/async-state';
import { AlertsService } from '../../core/services/alerts.service';
import { TrendsService } from '../../core/services/trends.service';
import { SourceStatus, TrendProduct } from '../../core/models/contract.models';
import { ExecutiveRecommendationComponent } from '../../shared/components/intel/executive-recommendation/executive-recommendation.component';
import { QuadrantBubbleComponent } from '../../shared/components/intel/quadrant-bubble/quadrant-bubble.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { HintComponent } from '../../shared/ui/hint/hint.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { ACTION_LABEL, ACTION_TOOLTIP, actionLabel, momentumArrow, scoreBandLabel } from '../../shared/util/format';

export type ActionTab = 'DECIDIR_AGORA' | 'NEGOCIAR_CUSTO' | 'TESTAR_DEMANDA' | 'IGNORAR';

const ACTION_TABS: { id: ActionTab; hint: string }[] = [
  { id: 'DECIDIR_AGORA', hint: ACTION_TOOLTIP['DECIDIR_AGORA'] },
  { id: 'NEGOCIAR_CUSTO', hint: ACTION_TOOLTIP['NEGOCIAR_CUSTO'] },
  { id: 'TESTAR_DEMANDA', hint: ACTION_TOOLTIP['TESTAR_DEMANDA'] },
  { id: 'IGNORAR', hint: ACTION_TOOLTIP['IGNORAR'] },
];

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    ExecutiveRecommendationComponent,
    QuadrantBubbleComponent,
    StatePanelComponent,
    EmptyStateComponent,
    SkeletonComponent,
    HintComponent,
    IconComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private readonly trends = inject(TrendsService);
  private readonly alerts = inject(AlertsService);

  readonly products = toAsyncState(this.trends.listProducts({ limit: 200 }));
  readonly sources = toAsyncState(this.alerts.sourcesStatus());
  readonly tab = signal<ActionTab>('DECIDIR_AGORA');

  readonly productRows = computed(() => {
    const state = this.products();
    if (state.status !== 'ready') return [];
    const data = state.data as unknown;
    return (Array.isArray(data) ? data : ((data as { items?: TrendProduct[] }).items ?? [])) as TrendProduct[];
  });

  /** D1: cabeçalho não clicável — total, contagem por ação, última coleta. */
  readonly total = computed(() => this.productRows().length);
  readonly countOrder: string[] = [...ACTION_TABS.map((t) => t.id), 'DADOS_INSUFICIENTES'];
  readonly countByAction = computed(() => {
    const counts: Record<string, number> = {
      DECIDIR_AGORA: 0,
      NEGOCIAR_CUSTO: 0,
      TESTAR_DEMANDA: 0,
      IGNORAR: 0,
      DADOS_INSUFICIENTES: 0,
    };
    for (const p of this.productRows()) {
      const key = p.action ?? 'DADOS_INSUFICIENTES';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });

  readonly lastCollection = computed(() => {
    const state = this.sources();
    if (state.status !== 'ready') return null;
    const dates = (state.data as SourceStatus[])
      .map((s) => (s.lastCollectedAt ? new Date(s.lastCollectedAt).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    if (dates.length === 0) return null;
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(Math.max(...dates)),
    );
  });

  readonly tabs = ACTION_TABS;

  readonly topFive = computed(() => {
    const tab = this.tab();
    return [...this.productRows()]
      .filter((p) => p.action === tab)
      .sort((a, b) => (b.moveScore ?? -1) - (a.moveScore ?? -1))
      .slice(0, 5);
  });

  setTab(tab: ActionTab): void {
    this.tab.set(tab);
  }

  actionText(action: string): string {
    return ACTION_LABEL[action] ?? action;
  }

  actionHint(action: string): string {
    return ACTION_TOOLTIP[action] ?? '';
  }

  productAction(product: TrendProduct): string {
    return actionLabel(product.action) || '—';
  }

  momentumArrow(product: TrendProduct): string {
    return momentumArrow(product.momentum?.direction);
  }

  riskCause(product: TrendProduct): string {
    return product.riskExplanation?.text ?? '—';
  }

  bandText(product: TrendProduct): string {
    return scoreBandLabel(product.scoreBand) || '—';
  }

  formatScore(product: TrendProduct): string {
    const value = product.moveScore;
    return value === null || value === undefined ? '—' : String(value);
  }
}
