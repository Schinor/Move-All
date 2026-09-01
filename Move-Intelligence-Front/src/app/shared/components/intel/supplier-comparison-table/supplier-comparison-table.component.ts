import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Supplier } from '../../../../core/models/contract.models';
import { IconComponent } from '../../../ui/icon/icon.component';

type SortColumn = 'name' | 'country' | 'moq' | 'fob' | 'score' | 'rating';

@Component({
  selector: 'app-supplier-comparison-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './supplier-comparison-table.component.html',
  styleUrl: './supplier-comparison-table.component.css',
})
export class SupplierComparisonTableComponent {
  readonly suppliers = input.required<Supplier[]>();
  readonly sortColumn = signal<SortColumn>('score');
  readonly sortAsc = signal(false);

  readonly rows = computed(() => {
    const list = [...this.suppliers()];
    const col = this.sortColumn();
    const asc = this.sortAsc();

    return list.sort((a, b) => {
      let va: any = 0;
      let vb: any = 0;

      switch (col) {
        case 'name':
          return asc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        case 'country':
          return asc
            ? (a.country ?? '').localeCompare(b.country ?? '')
            : (b.country ?? '').localeCompare(a.country ?? '');
        case 'moq':
          va = a.moq ?? 0;
          vb = b.moq ?? 0;
          break;
        case 'fob':
          va = a.fob ?? 0;
          vb = b.fob ?? 0;
          break;
        case 'rating':
        case 'score':
        default:
          va = (a as any).rating_stars ?? a.score?.value ?? 0;
          vb = (b as any).rating_stars ?? b.score?.value ?? 0;
          break;
      }

      return asc ? va - vb : vb - va;
    });
  });

  sort(col: SortColumn): void {
    if (this.sortColumn() === col) {
      this.sortAsc.update((v) => !v);
    } else {
      this.sortColumn.set(col);
      this.sortAsc.set(false);
    }
  }

  getStars(supplier: Supplier): number | null {
    const s = (supplier as any).rating_stars ?? supplier.ratingStars;
    if (s !== undefined && s !== null) return s;
    const val = supplier.score?.value;
    return val === null || val === undefined ? null : Math.round((val / 20) * 10) / 10;
  }

  getTier(supplier: Supplier): string {
    const t = (supplier as any).tier ?? supplier.tier;
    if (t) return t;
    const st = this.getStars(supplier);
    if (st === null) return 'Não informado';
    if (st >= 4.5) return 'Diamante';
    if (st >= 3.8) return 'Ouro';
    if (st >= 3.0) return 'Prata';
    return 'Bronze';
  }

  getTotalProducts(supplier: Supplier): number | null {
    return (supplier as any).total_products ?? supplier.totalProducts ?? null;
  }

  getTotalSales(supplier: Supplier): number | null {
    return (supplier as any).total_monthly_sales ?? supplier.totalMonthlySales ?? null;
  }

  formatUsd(value: number | null): string {
    if (value === null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(value);
  }

  formatSales(supplier: Supplier): string {
    const value = this.getTotalSales(supplier);
    return value === null ? '—' : `${value.toLocaleString('pt-BR')} un/mês`;
  }
}
