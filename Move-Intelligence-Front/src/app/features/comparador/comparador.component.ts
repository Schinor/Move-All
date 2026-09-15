import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrendsService } from '../../core/services/trends.service';
import { categoryLabel, dataConfidenceLabel, decisionLabel } from '../../shared/util/format';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { HumanizePipe } from '../../shared/util/humanize.pipe';

type SortKey = 'score' | 'growth' | 'name';

/** Máximo de linhas visíveis no seletor; a busca/filtro refinam o resto. */
const PICKER_LIMIT = 60;
const MAX_SELECTED = 4;

@Component({
  selector: 'app-comparador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HumanizePipe, RouterLink, PageHeaderComponent, RiskBadgeComponent, IconComponent],
  templateUrl: './comparador.component.html',
  styleUrl: './comparador.component.css',
})
export class ComparadorComponent implements OnInit {
  private readonly trends = inject(TrendsService);

  readonly allProducts = signal<any[]>([]);
  readonly selectedIds = signal<string[]>([]);
  readonly comparisonData = signal<any[]>([]);
  readonly loading = signal(false);

  readonly pickerOpen = signal(false);
  readonly search = signal('');
  readonly category = signal('');
  readonly sortBy = signal<SortKey>('score');

  readonly maxSelected = MAX_SELECTED;
  readonly colors = ['#75f852', '#03eb88', '#83e1fa', '#8c7bff'];

  readonly selectedProducts = computed(() => {
    const byId = new Map(this.allProducts().map((p) => [p.productClusterId, p]));
    return this.selectedIds().map((id, index) => ({
      id,
      name: byId.get(id)?.canonicalName ?? 'Produto',
      color: this.colors[index % this.colors.length],
    }));
  });

  readonly categories = computed(() => {
    const set = new Set<string>();
    for (const p of this.allProducts()) if (p.category) set.add(p.category);
    return [...set]
      .map((value) => ({ value, label: categoryLabel(value) || value }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  });

  readonly filtered = computed(() => {
    const term = normalize(this.search());
    const category = this.category();
    const sort = this.sortBy();
    const list = this.allProducts().filter(
      (p) =>
        (!category || p.category === category) &&
        (!term || normalize(`${p.canonicalName} ${categoryLabel(p.category)}`).includes(term)),
    );
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);
    return [...list].sort((a, b) => {
      if (sort === 'name') return String(a.canonicalName).localeCompare(String(b.canonicalName), 'pt-BR');
      if (sort === 'growth') return num(b.growthPct) - num(a.growthPct);
      return num(b.moveScore) - num(a.moveScore);
    });
  });

  readonly visible = computed(() => this.filtered().slice(0, PICKER_LIMIT));

  ngOnInit(): void {
    this.loadCatalog();
  }

  loadCatalog(): void {
    this.trends.listProducts({ limit: 200 }).subscribe({
      next: (list) => {
        const items = Array.isArray(list) ? list : (list?.items ?? []);
        this.allProducts.set(items);
        // Usa os dois primeiros itens retornados como seleção inicial do comparador.
        if (items.length >= 2) {
          this.selectedIds.set([items[0].productClusterId, items[1].productClusterId]);
          this.compare();
        }
      },
    });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  toggleProduct(id: string): void {
    const current = this.selectedIds();
    if (current.includes(id)) {
      if (current.length <= 1) return; // Mínimo 1 selecionado
      this.selectedIds.set(current.filter((item) => item !== id));
    } else {
      if (current.length >= MAX_SELECTED) return;
      this.selectedIds.set([...current, id]);
    }
    this.compare();
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  setCategory(event: Event): void {
    this.category.set((event.target as HTMLSelectElement).value);
  }

  setSort(event: Event): void {
    this.sortBy.set((event.target as HTMLSelectElement).value as SortKey);
  }

  togglePicker(): void {
    this.pickerOpen.update((open) => !open);
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

  categoryText(value: string | null | undefined): string {
    return categoryLabel(value) || 'Sem categoria';
  }

  formatCurrency(value: number | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
  }

  formatNumber(value: number | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR').format(value);
  }

  /** Sem Move Score, exibe o rótulo da confiança (sem número). */
  confidenceOf(item: any): string {
    return dataConfidenceLabel(item?.dataConfidence);
  }

  decisionOf(item: any): string {
    return decisionLabel(item?.action ?? item?.decision) || '—';
  }
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
