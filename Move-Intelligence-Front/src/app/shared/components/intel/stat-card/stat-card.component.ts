import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SparklineComponent } from '../sparkline/sparkline.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { DashboardKpi } from '../../../../core/models/contract.models';

/** Cartão de KPI de resumo do dashboard (portado do KpiCard do mockup). */
@Component({
  selector: 'app-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SparklineComponent, IconComponent],
  templateUrl: './stat-card.component.html',
  styleUrl: './stat-card.component.css',
})
export class StatCardComponent {
  readonly kpi = input.required<DashboardKpi>();
  readonly up = computed(() => this.kpi().delta >= 0);
}
