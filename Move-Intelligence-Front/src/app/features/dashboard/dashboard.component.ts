import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../core/api/async-state';
import { TrendsService } from '../../core/services/trends.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { AlertsService } from '../../core/services/alerts.service';
import { SourceStatus } from '../../core/models/contract.models';
import { StatCardComponent } from '../../shared/components/intel/stat-card/stat-card.component';
import { TrendCardComponent } from '../../shared/components/intel/trend-card/trend-card.component';
import { RiskMatrixComponent } from '../../shared/components/intel/risk-matrix/risk-matrix.component';
import { SignalSourceCardComponent } from '../../shared/components/intel/signal-source-card/signal-source-card.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    StatCardComponent,
    TrendCardComponent,
    RiskMatrixComponent,
    SignalSourceCardComponent,
    StatePanelComponent,
    IconComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private readonly trends = inject(TrendsService);
  private readonly dashboard = inject(DashboardService);
  private readonly alerts = inject(AlertsService);

  readonly products = toAsyncState(this.trends.listProducts({ limit: 6 }));
  readonly summary = toAsyncState(this.dashboard.summary());
  readonly sources = toAsyncState(this.alerts.sourcesStatus());

  readonly kpis = computed(() => {
    const s = this.summary();
    return s.status === 'ready' ? s.data.kpis : [];
  });
  readonly tickers = computed(() => {
    const s = this.summary();
    return s.status === 'ready' ? s.data.tickers : [];
  });
  readonly productRows = computed(() => {
    const state = this.products();
    return state.status === 'ready' ? state.data : [];
  });
  readonly sourceRows = computed<SourceStatus[]>(() => {
    const state = this.sources();
    const rows = state.status === 'ready' ? state.data : [];
    return [{ source: 'tradeatlas', online: this.productRows().length > 0, lastCollectedAt: null }, ...rows];
  });
}
