import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toAsyncState } from '../../core/api/async-state';
import { MarketsService } from '../../core/services/markets.service';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card/kpi-card.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';

@Component({
  selector: 'app-mercados',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, StatePanelComponent, KpiCardComponent, RiskBadgeComponent],
  templateUrl: './mercados.component.html',
  styleUrl: './mercados.component.css',
})
export class MercadosComponent {
  private readonly markets = inject(MarketsService);
  readonly data = toAsyncState(this.markets.list());
}
