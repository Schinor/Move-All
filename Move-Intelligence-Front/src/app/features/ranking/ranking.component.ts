import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../core/api/async-state';
import { TrendProduct, TrendStage } from '../../core/models/contract.models';
import { TrendsService } from '../../core/services/trends.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { SkeletonComponent } from '../../shared/ui/skeleton/skeleton.component';
import { ScoreGaugeComponent } from '../../shared/components/intel/score-gauge/score-gauge.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { DataTableComponent } from '../../shared/ui/data-table/data-table.component';
import { STAGE_LABEL } from '../../shared/util/format';

type SortKey = 'rank' | 'name' | 'score' | 'opportunity' | 'growth' | 'risk';
type StageFilter = 'all' | TrendStage | 'launch';

@Component({
  selector: 'app-ranking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    StatePanelComponent,
    EmptyStateComponent,
    SkeletonComponent,
    RiskBadgeComponent,
    ScoreGaugeComponent,
    IconComponent,
    DataTableComponent,
  ],
  templateUrl: './ranking.component.html',
  styleUrl: './ranking.component.css',
})
export class RankingComponent {
  private readonly trends = inject(TrendsService);
  readonly products = toAsyncState(this.trends.listProducts({ sort: 'trend_score', limit: 50 }));
  readonly query = signal('');
  readonly stage = signal<StageFilter>('all');
  readonly sortKey = signal<SortKey>('score');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  readonly filters: { id: StageFilter; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'emerging', label: 'Emergentes' },
    { id: 'rising', label: 'Ascensão' },
    { id: 'peaking', label: 'Pico' },
    { id: 'launch', label: 'Lançar agora' },
  ];

  readonly rankedProducts = computed(() => {
    const state = this.products();
    if (state.status !== 'ready') return [];
    return [...state.data].sort((a, b) => this.scoreValue(b) - this.scoreValue(a));
  });

  readonly rows = computed(() => {
    const term = this.query().trim().toLowerCase();
    const stage = this.stage();
    const filtered = this.rankedProducts().filter((product) => {
      const haystack = [product.canonicalName, product.category, this.origin(product)]
        .join(' ')
        .toLowerCase();
      const matchesTerm = !term || haystack.includes(term);
      const matchesStage =
        stage === 'all' ||
        product.stage === stage ||
        (stage === 'launch' && this.opportunityValue(product) >= 35 && product.risk !== 'alto');
      return matchesTerm && matchesStage;
    });
    return filtered.sort((a, b) => this.compare(a, b));
  });

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  setStage(stage: StageFilter): void {
    this.stage.set(stage);
  }

  sort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set(key === 'name' ? 'asc' : 'desc');
  }

  rank(product: TrendProduct): number {
    const index = this.rankedProducts().findIndex(
      (candidate) => candidate.productClusterId === product.productClusterId,
    );
    return index < 0 ? 0 : index + 1;
  }

  origin(product: TrendProduct): string {
    return product.canonicalName.split('—').at(-1)?.trim() ?? '—';
  }

  stageLabel(stage: TrendStage | null): string {
    return stage ? (STAGE_LABEL[stage] ?? stage) : 'Estágio não informado';
  }

  scoreValue(product: TrendProduct): number {
    return product.trendScore.value ?? -Infinity;
  }

  opportunityValue(product: TrendProduct): number {
    return product.opportunityScore.value ?? -Infinity;
  }

  sortDirection(key: SortKey): 'ascending' | 'descending' | 'none' {
    return this.sortKey() === key ? (this.sortDir() === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  sortIcon(key: SortKey): 'chevron-up' | 'chevron-down' {
    return this.sortKey() === key && this.sortDir() === 'asc' ? 'chevron-up' : 'chevron-down';
  }

  private compare(a: TrendProduct, b: TrendProduct): number {
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const av = this.sortValue(a, this.sortKey());
    const bv = this.sortValue(b, this.sortKey());
    return av > bv ? dir : av < bv ? -dir : 0;
  }

  private sortValue(product: TrendProduct, key: SortKey): string | number {
    if (key === 'rank') return this.rank(product);
    if (key === 'name') return product.canonicalName;
    if (key === 'opportunity') return this.opportunityValue(product);
    if (key === 'growth') return product.growthPct ?? -Infinity;
    if (key === 'risk') return product.risk ?? '';
    return this.scoreValue(product);
  }
}
