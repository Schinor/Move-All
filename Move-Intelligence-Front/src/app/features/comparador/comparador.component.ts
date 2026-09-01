import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TrendsService } from '../../core/services/trends.service';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { HumanizePipe } from '../../shared/util/humanize.pipe';

@Component({
  selector: 'app-comparador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HumanizePipe,FormsModule, RouterLink, PageHeaderComponent, RiskBadgeComponent, IconComponent],
  templateUrl: './comparador.component.html',
  styleUrl: './comparador.component.css',
})
export class ComparadorComponent implements OnInit {
  private readonly trends = inject(TrendsService);

  readonly allProducts = signal<any[]>([]);
  readonly selectedIds = signal<string[]>([]);
  readonly comparisonData = signal<any[]>([]);
  readonly loading = signal(false);

  readonly colors = ['#75f852', '#03eb88', '#83e1fa', '#8c7bff'];

  ngOnInit(): void {
    this.loadCatalog();
  }

  loadCatalog(): void {
    this.trends.listProducts({ limit: 50 }).subscribe({
      next: (list) => {
        this.allProducts.set(list || []);
        // Usa os dois primeiros itens retornados como seleção inicial do comparador.
        if (list && list.length >= 2) {
          this.selectedIds.set([list[0].productClusterId, list[1].productClusterId]);
          this.compare();
        }
      },
    });
  }

  toggleProduct(id: string): void {
    const current = this.selectedIds();
    if (current.includes(id)) {
      if (current.length <= 1) return; // Mínimo 1 selecionado
      this.selectedIds.set(current.filter((item) => item !== id));
    } else {
      if (current.length >= 4) return; // Máximo 4
      this.selectedIds.set([...current, id]);
    }
    this.compare();
  }

  compare(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      this.comparisonData.set([]);
      return;
    }

    this.loading.set(true);
    this.trends.compareProducts(ids).subscribe({
      next: (data) => {
        this.comparisonData.set(data || []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  formatCurrency(value: number | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
  }

  formatNumber(value: number | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR').format(value);
  }
}
