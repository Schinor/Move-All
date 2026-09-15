import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { toAsyncState } from '../../core/api/async-state';
import { TrendProduct } from '../../core/models/contract.models';
import { TrendsService } from '../../core/services/trends.service';
import { RankingViewMode, ViewModeService } from '../../core/services/view-mode.service';
import { TrendCardComponent } from '../../shared/components/intel/trend-card/trend-card.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { SkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';
import { SegmentedComponent, SegmentOption } from '../../shared/ui/segmented/segmented.component';
import { ScoreGaugeComponent } from '../../shared/components/intel/score-gauge/score-gauge.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { DataTableComponent } from '../../shared/ui/data-table/data-table.component';
import { ACTION_LABEL, STAGE_LABEL, actionLabel, dataConfidenceLabel, formatBRL, momentumArrow, scoreBandLabel, sourceLabel } from '../../shared/util/format';
import { HumanizePipe } from '../../shared/util/humanize.pipe';

export type RankSortKey = 'score' | 'action' | 'momentum' | 'growth' | 'price' | 'reviews' | 'rating' | 'name';
export type ActionFilter = 'all' | 'DECIDIR_AGORA' | 'NEGOCIAR_CUSTO' | 'TESTAR_DEMANDA' | 'IGNORAR' | 'DADOS_INSUFICIENTES';

const ACTION_ORDER: Record<string, number> = {
  DECIDIR_AGORA: 0,
  NEGOCIAR_CUSTO: 1,
  TESTAR_DEMANDA: 2,
  IGNORAR: 3,
  DADOS_INSUFICIENTES: 4,
};

@Component({
  selector: 'app-ranking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HumanizePipe,
    RouterLink,
    PageHeaderComponent,
    StatePanelComponent,
    EmptyStateComponent,
    SkeletonComponent,
    ScoreGaugeComponent,
    IconComponent,
    DataTableComponent,
    SegmentedComponent,
    TrendCardComponent,
  ],
  templateUrl: './ranking.component.html',
  styleUrl: './ranking.component.css',
})
export class RankingComponent {
  private readonly trends = inject(TrendsService);
  private readonly viewModeService = inject(ViewModeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly viewMode = this.viewModeService.viewMode;
  // D2: estado na URL (action, sort, dir, page, pageSize, q).
  readonly query = signal(this.route.snapshot.queryParamMap.get('q') ?? '');
  readonly action = signal<ActionFilter>(this.parseAction(this.route.snapshot.queryParamMap.get('action')));
  readonly sortKey = signal<RankSortKey>(this.parseSort(this.route.snapshot.queryParamMap.get('sort')));
  readonly sortDir = signal<'asc' | 'desc'>(this.route.snapshot.queryParamMap.get('dir') === 'asc' ? 'asc' : 'desc');
  readonly page = signal(Math.max(1, Number(this.route.snapshot.queryParamMap.get('page') ?? 1) || 1));
  readonly pageSize = signal(Math.min(200, Math.max(10, Number(this.route.snapshot.queryParamMap.get('pageSize') ?? 50) || 50)));

  private readonly params$ = combineLatest([
    toObservable(this.action),
    toObservable(this.sortKey),
    toObservable(this.sortDir),
    toObservable(this.page),
    toObservable(this.pageSize),
  ]).pipe(map(([action, sort, dir, page, pageSize]) => ({ action, sort, dir, page, pageSize })));

  readonly result = toAsyncState(
    this.params$.pipe(
      switchMap((p) =>
        this.trends.listProducts({
          sort: this.apiSort(p.sort),
          dir: p.dir,
          action: p.action === 'all' ? undefined : p.action,
          page: p.page,
          pageSize: p.pageSize,
        }),
      ),
    ),
    // Filtro sem resultado não é "banco vazio": a barra de filtros continua na tela.
    () => false,
  );

  readonly rows = computed(() => {
    const state = this.result();
    if (state.status !== 'ready') return [];
    const data = state.data as unknown;
    // P0-4: com paginação da API, a ordem já vem certa — só filtra o texto,
    // sem reordenar a página (a ordenação local contradizia a da API).
    if (!Array.isArray(data)) {
      const items = (data as { items?: TrendProduct[] }).items ?? [];
      const term = this.query().trim().toLowerCase();
      if (!term) return items;
      return items.filter((product) =>
        [product.canonicalName, product.category, (product.detectedOn ?? []).join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(term),
      );
    }
    const items = data as TrendProduct[];
    const term = this.query().trim().toLowerCase();
    if (!term) return this.sortClient(items);
    return this.sortClient(
      items.filter((product) =>
        [product.canonicalName, product.category, (product.detectedOn ?? []).join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(term),
      ),
    );
  });

  readonly total = computed(() => {
    const state = this.result();
    if (state.status !== 'ready') return 0;
    const data = state.data as unknown;
    if (Array.isArray(data)) return (data as TrendProduct[]).length;
    return (data as { total?: number }).total ?? 0;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly filters: { id: ActionFilter; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'DECIDIR_AGORA', label: ACTION_LABEL['DECIDIR_AGORA'] },
    { id: 'NEGOCIAR_CUSTO', label: ACTION_LABEL['NEGOCIAR_CUSTO'] },
    { id: 'TESTAR_DEMANDA', label: ACTION_LABEL['TESTAR_DEMANDA'] },
    { id: 'IGNORAR', label: ACTION_LABEL['IGNORAR'] },
    { id: 'DADOS_INSUFICIENTES', label: ACTION_LABEL['DADOS_INSUFICIENTES'] },
  ];
  readonly viewOptions: SegmentOption[] = [
    { value: 'table', label: 'Tabela' },
    { value: 'cards', label: 'Cartões' },
  ];

  constructor() {
    // D2/D3: voltar retorna à mesma posição — estado fica na URL.
    effect(() => {
      const qp = {
        ...(this.action() !== 'all' ? { action: this.action() } : {}),
        sort: this.sortKey(),
        dir: this.sortDir(),
        page: this.page(),
        pageSize: this.pageSize(),
        ...(this.query().trim() ? { q: this.query().trim() } : {}),
      };
      void this.router.navigate([], { relativeTo: this.route, queryParams: qp, replaceUrl: true });
    });
  }

  /** Há ação selecionada ou busca digitada. */
  hasActiveFilters(): boolean {
    return this.action() !== 'all' || this.query().trim().length > 0;
  }

  clearFilters(): void {
    this.action.set('all');
    this.query.set('');
    this.page.set(1);
  }

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  setAction(action: ActionFilter): void {
    this.action.set(action);
    this.page.set(1);
  }

  setViewMode(viewMode: string): void {
    if (viewMode === 'table' || viewMode === 'cards') {
      this.viewModeService.setViewMode(viewMode satisfies RankingViewMode);
    }
  }

  sort(key: RankSortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set(key === 'name' ? 'asc' : 'desc');
  }

  goPage(delta: number): void {
    this.page.set(Math.min(this.totalPages(), Math.max(1, this.page() + delta)));
  }

  actionText(product: TrendProduct): string {
    return actionLabel(product.action) || '—';
  }

  momentumText(product: TrendProduct): string {
    const m = product.momentum;
    if (!m?.direction) return '—';
    const arrow = momentumArrow(m.direction);
    const pct = m.growthPct === null || m.growthPct === undefined ? '' : ` ${m.growthPct >= 0 ? '+' : ''}${m.growthPct}%`;
    return `${arrow}${pct}`;
  }

  detectedText(product: TrendProduct): string {
    const sources = product.detectedOn ?? product.mainSources ?? [];
    if (sources.length === 0) return '—';
    return sources.map((s) => sourceLabel(s)).join(' · ');
  }

  supplierText(product: TrendProduct): string {
    return product.topSupplier?.name ?? '—';
  }

  bandText(product: TrendProduct): string {
    return scoreBandLabel(product.scoreBand) || '—';
  }

  priceText(product: TrendProduct): string {
    return product.price === null || product.price === undefined ? '—' : formatBRL(product.price);
  }

  stageLabel(stage: TrendProduct['stage']): string {
    return stage ? (STAGE_LABEL[stage] ?? stage) : '—';
  }

  confidenceLabel(product: TrendProduct): string {
    return dataConfidenceLabel(product.dataConfidence);
  }

  scoreValue(product: TrendProduct): number {
    return product.moveScore ?? -Infinity;
  }

  sortDirection(key: RankSortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() === key ? (this.sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  sortIcon(key: RankSortKey): 'chevron-up' | 'chevron-down' {
    return this.sortKey() === key && this.sortDir() === 'asc' ? 'chevron-up' : 'chevron-down';
  }

  private apiSort(sort: RankSortKey): string {
    // P0-4: chave e direção vão para a API (a ordenação local saiu quando há paginação).
    if (sort === 'score') return 'move_score';
    if (sort === 'growth') return 'growth';
    if (sort === 'momentum') return 'momentum';
    if (sort === 'price') return 'price';
    if (sort === 'reviews') return 'reviews';
    if (sort === 'rating') return 'rating';
    if (sort === 'action') return 'action';
    return 'name';
  }

  private sortClient(items: TrendProduct[]): TrendProduct[] {
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    return [...items].sort((a, b) => {
      const av = this.sortValue(a, key);
      const bv = this.sortValue(b, key);
      return av > bv ? dir : av < bv ? -dir : 0;
    });
  }

  private sortValue(product: TrendProduct, key: RankSortKey): string | number {
    if (key === 'name') return product.canonicalName;
    if (key === 'growth') return product.growthPct ?? -Infinity;
    if (key === 'momentum') return product.momentum?.growthPct ?? product.growthPct ?? -Infinity;
    if (key === 'price') return product.price ?? -Infinity;
    if (key === 'reviews') return product.reviews ?? -Infinity;
    if (key === 'rating') return product.rating ?? -Infinity;
    if (key === 'action') return ACTION_ORDER[product.action ?? ''] ?? 99;
    return this.scoreValue(product);
  }

  private parseAction(value: string | null): ActionFilter {
    const v = (value ?? '').trim().toUpperCase();
    return (['DECIDIR_AGORA', 'NEGOCIAR_CUSTO', 'TESTAR_DEMANDA', 'IGNORAR', 'DADOS_INSUFICIENTES'] as ActionFilter[]).includes(v as ActionFilter)
      ? (v as ActionFilter)
      : 'all';
  }

  private parseSort(value: string | null): RankSortKey {
    const v = (value ?? '').trim().toLowerCase();
    if (['score', 'move_score'].includes(v)) return 'score';
    if (['action'].includes(v)) return 'action';
    if (['momentum'].includes(v)) return 'momentum';
    if (['growth', 'growth_pct'].includes(v)) return 'growth';
    if (['price', 'preco'].includes(v)) return 'price';
    if (['reviews', 'review'].includes(v)) return 'reviews';
    if (['rating', 'nota'].includes(v)) return 'rating';
    if (['name'].includes(v)) return 'name';
    return 'score';
  }
}
