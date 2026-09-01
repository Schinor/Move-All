import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toAsyncState } from '../../core/api/async-state';
import { RecommendationsService } from '../../core/services/recommendations.service';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card/kpi-card.component';

@Component({
  selector: 'app-recomendacoes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, StatePanelComponent, KpiCardComponent],
  templateUrl: './recomendacoes.component.html',
  styleUrl: './recomendacoes.component.css',
})
export class RecomendacoesComponent {
  private readonly recommendations = inject(RecommendationsService);
  readonly data = toAsyncState(this.recommendations.list());
}
