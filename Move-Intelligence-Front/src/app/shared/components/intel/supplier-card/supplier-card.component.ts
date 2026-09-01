import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Supplier } from '../../../../core/models/contract.models';
import { RiskBadgeComponent } from '../../../ui/risk-badge/risk-badge.component';
import { ConfidenceIndicatorComponent } from '../confidence-indicator/confidence-indicator.component';
import { IconComponent } from '../../../ui/icon/icon.component';

@Component({
  selector: 'app-supplier-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RiskBadgeComponent, IconComponent],
  templateUrl: './supplier-card.component.html',
  styleUrl: './supplier-card.component.css',
})
export class SupplierCardComponent {
  readonly supplier = input.required<Supplier>();

  readonly fob = computed(() => this.formatUsd(this.supplier().fob));
  readonly stars = computed(() => {
    const s = (this.supplier() as any).rating_stars ?? this.supplier().ratingStars;
    if (s !== undefined && s !== null) return s;
    const val = this.supplier().score?.value;
    return val ? Math.round((val / 20) * 10) / 10 : 4.5;
  });

  readonly tier = computed(() => {
    const t = (this.supplier() as any).tier ?? this.supplier().tier;
    if (t) return t;
    const st = this.stars();
    if (st >= 4.5) return 'Diamante';
    if (st >= 3.8) return 'Ouro';
    if (st >= 3.0) return 'Prata';
    return 'Bronze';
  });

  readonly totalProducts = computed(() => (this.supplier() as any).total_products ?? this.supplier().totalProducts ?? 6);
  readonly totalSales = computed(() => (this.supplier() as any).total_monthly_sales ?? this.supplier().totalMonthlySales ?? 1250);

  private formatUsd(value: number | null): string {
    if (value === null) {
      return '—';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }
}
