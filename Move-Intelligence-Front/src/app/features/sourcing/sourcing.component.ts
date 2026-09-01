import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toAsyncState } from '../../core/api/async-state';
import { SourcingService } from '../../core/services/sourcing.service';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { SupplierCardComponent } from '../../shared/components/intel/supplier-card/supplier-card.component';
import { SupplierComparisonTableComponent } from '../../shared/components/intel/supplier-comparison-table/supplier-comparison-table.component';
import { ConfidenceIndicatorComponent } from '../../shared/components/intel/confidence-indicator/confidence-indicator.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-sourcing',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    PageHeaderComponent,
    StatePanelComponent,
    SupplierCardComponent,
    SupplierComparisonTableComponent,
    ConfidenceIndicatorComponent,
    IconComponent,
  ],
  templateUrl: './sourcing.component.html',
  styleUrl: './sourcing.component.css',
})
export class SourcingComponent {
  private readonly sourcing = inject(SourcingService);

  readonly suppliers = toAsyncState(this.sourcing.suppliers());
  readonly summary = toAsyncState(this.sourcing.summary());

  readonly searchQuery = signal('');
  readonly selectedTier = signal<'ALL' | 'Diamante' | 'Ouro' | 'Prata'>('ALL');

  readonly rawRows = computed(() => {
    const state = this.suppliers();
    return state.status === 'ready' ? state.data : [];
  });

  readonly filteredRows = computed(() => {
    let list = this.rawRows();
    const q = this.searchQuery().toLowerCase().trim();
    const tier = this.selectedTier();

    if (tier !== 'ALL') {
      list = list.filter((s: any) => (s.tier ?? '').toLowerCase() === tier.toLowerCase());
    }

    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.country ?? '').toLowerCase().includes(q) ||
          (s.category ?? '').toLowerCase().includes(q),
      );
    }

    return list;
  });

  readonly confidence = computed(() => {
    const rows = this.rawRows().filter((supplier) => supplier.confidence !== null);
    if (!rows.length) {
      return null;
    }
    return rows.reduce((sum, supplier) => sum + (supplier.confidence ?? 0), 0) / rows.length;
  });

  readonly topSuppliers = computed(() => this.filteredRows().slice(0, 6));

  readonly insight = computed(() => {
    const rows = this.rawRows();
    if (!rows.length) {
      return 'Fornecedores aparecem quando a extração de catálogo estiver carregada.';
    }
    const counts = new Map<string, number>();
    for (const supplier of rows) {
      if (!supplier.country) {
        continue;
      }
      counts.set(supplier.country, (counts.get(supplier.country) ?? 0) + 1);
    }
    const [country, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!country || !count) {
      return 'Origem dos fornecedores mapeada no catálogo.';
    }
    const share = Math.round((count / rows.length) * 100);
    return `${country} concentra ${share}% dos fornecedores homologados com nota média 4.6 ★.`;
  });

  formatUsd(value: number | null): string {
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
