import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SparklineComponent } from '../sparkline/sparkline.component';
import { RiskBadgeComponent } from '../../../ui/risk-badge/risk-badge.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { TrendProduct } from '../../../../core/models/contract.models';
import { STAGE_LABEL, actionLabel, dataConfidenceLabel, formatBRL, momentumArrow, scoreBandLabel } from '../../../util/format';
import { HumanizePipe } from '../../../util/humanize.pipe';

/** Cartão de tendência (portado do TrendCard do mockup). Dado via @Input. */
@Component({
  selector: 'app-trend-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SparklineComponent, RiskBadgeComponent, IconComponent, HumanizePipe],
  templateUrl: './trend-card.component.html',
  styleUrl: './trend-card.component.css',
})
export class TrendCardComponent {
  readonly trend = input.required<TrendProduct>();

  readonly up = computed(() => (this.trend().growthPct ?? 0) >= 0);
  readonly stageLabel = computed(() =>
    this.trend().stage ? (STAGE_LABEL[this.trend().stage as string] ?? '') : '',
  );
  readonly scoreValue = computed(() => this.trend().moveScore ?? null);
  readonly scoreConfidence = computed(() => dataConfidenceLabel(this.trend().dataConfidence));
  readonly actionText = computed(() => actionLabel(this.trend().action) || '—');
  readonly bandText = computed(() => scoreBandLabel(this.trend().scoreBand) || '—');
  readonly momentumArrow = computed(() => momentumArrow(this.trend().momentum?.direction));
  readonly hasStats = computed(() =>
    [this.trend().growthPct, this.trend().marginPct, this.trend().leadTimeDays].some(
      (value) => value !== null,
    ),
  );
  readonly pipeline = computed(() => formatBRL(this.trend().projectedRevenue));
}
