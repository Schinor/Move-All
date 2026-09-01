import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Supplier } from '../../../../core/models/contract.models';
import { RiskBadgeComponent } from '../../../ui/risk-badge/risk-badge.component';
import { IconComponent, IconName } from '../../../ui/icon/icon.component';

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
    return val === null || val === undefined ? null : Math.round((val / 20) * 10) / 10;
  });

  readonly tier = computed(() => {
    const t = (this.supplier() as any).tier ?? this.supplier().tier;
    if (t) return t;
    return 'Não informado';
  });

  readonly totalProducts = computed(() => (this.supplier() as any).total_products ?? this.supplier().totalProducts ?? null);
  readonly totalSales = computed(() => (this.supplier() as any).total_monthly_sales ?? this.supplier().totalMonthlySales ?? null);

  readonly salesLabel = computed(() => {
    const value = this.totalSales();
    return value === null ? '—' : `${value.toLocaleString('pt-BR')} un/mês`;
  });

  readonly tierIcon = computed<IconName>(() => {
    const tier = this.tier();
    if (tier === 'Diamante') return 'diamond';
    if (tier === 'Ouro') return 'medal-gold';
    if (tier === 'Prata') return 'medal-silver';
    return 'medal-bronze';
  });

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
