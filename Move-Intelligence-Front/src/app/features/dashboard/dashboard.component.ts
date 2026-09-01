import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../core/api/async-state';
import { AlertsService } from '../../core/services/alerts.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { TrendsService } from '../../core/services/trends.service';
import { SourceStatus, TimeWindow, TrendProduct } from '../../core/models/contract.models';
import { RiskMatrixComponent } from '../../shared/components/intel/risk-matrix/risk-matrix.component';
import { SignalSourceCardComponent } from '../../shared/components/intel/signal-source-card/signal-source-card.component';
import { StatCardComponent } from '../../shared/components/intel/stat-card/stat-card.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { ExplainComponent } from '../../shared/ui/explain/explain.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { WindowSelectorComponent } from '../../shared/ui/window-selector/window-selector.component';
import { formatBRL } from '../../shared/util/format';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    WindowSelectorComponent,
    StatCardComponent,
    RiskMatrixComponent,
    SignalSourceCardComponent,
    StatePanelComponent,
    EmptyStateComponent,
    SkeletonComponent,
    ExplainComponent,
    IconComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private readonly trends = inject(TrendsService);
  private readonly dashboard = inject(DashboardService);
  private readonly alerts = inject(AlertsService);

  readonly window = signal<TimeWindow>('6m');
  readonly products = toAsyncState(this.trends.listProducts({ limit: 12 }));
  readonly summary = toAsyncState(this.dashboard.summary());
  readonly sources = toAsyncState(this.alerts.sourcesStatus());

  readonly kpis = computed(() => {
    const state = this.summary();
    return state.status === 'ready' ? state.data.kpis.slice(0, 4) : [];
  });

  readonly productRows = computed(() => {
    const state = this.products();
    return state.status === 'ready' ? state.data : [];
  });

  readonly decisionProducts = computed(() =>
    [...this.productRows()]
      .filter((product) => (product.opportunityScore.value ?? -1) >= 35)
      .sort((a, b) => (b.opportunityScore.value ?? -1) - (a.opportunityScore.value ?? -1))
      .slice(0, 5),
  );

  readonly topSignals = computed(() =>
    [...this.productRows()]
      .sort((a, b) => (b.trendScore.value ?? -1) - (a.trendScore.value ?? -1))
      .slice(0, 5),
  );

  readonly sourceRows = computed<SourceStatus[]>(() => {
    const state = this.sources();
    return state.status === 'ready' ? state.data : [];
  });

  setWindow(value: TimeWindow): void {
    this.window.set(value);
  }

  decisionReason(product: TrendProduct): string {
    const opportunity = product.opportunityScore.value;
    const growth = product.growthPct;
    if (opportunity !== null && opportunity !== undefined && growth !== null && growth !== undefined) {
      return `Oportunidade ${opportunity} · crescimento ${growth >= 0 ? '+' : ''}${growth}%`;
    }
    if (opportunity !== null && opportunity !== undefined) return `Opportunity Score ${opportunity}`;
    return 'Score de oportunidade ainda não informado';
  }

  formatScore(product: TrendProduct): string {
    const value = product.opportunityScore.value;
    return value === null || value === undefined ? '—' : String(value);
  }

  formatGrowth(product: TrendProduct): string {
    const value = product.growthPct;
    return value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value}%`;
  }

  formatRevenue(product: TrendProduct): string {
    return formatBRL(product.projectedRevenue);
  }

  formatCollectionDate(value: string | null): string {
    if (!value) return 'Última coleta não informada';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Última coleta não informada'
      : `Última coleta em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)}`;
  }
}
