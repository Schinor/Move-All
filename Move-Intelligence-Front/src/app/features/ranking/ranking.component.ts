import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../core/api/async-state';
import { TrendsService } from '../../core/services/trends.service';
import { TrendProduct, TrendStage } from '../../core/models/contract.models';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { SparklineComponent } from '../../shared/components/intel/sparkline/sparkline.component';
import { ScoreGaugeComponent } from '../../shared/components/intel/score-gauge/score-gauge.component';
import { STAGE_LABEL } from '../../shared/util/format';

type SortKey = 'rank' | 'name' | 'score' | 'growth' | 'risk';
type StageFilter = 'all' | TrendStage | 'launch';

@Component({
  selector: 'app-ranking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageHeaderComponent,
    StatePanelComponent,
    RiskBadgeComponent,
    SparklineComponent,
    ScoreGaugeComponent,
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

  readonly rows = computed(() => {
    const state = this.products();
    if (state.status !== 'ready') {
      return [];
    }
    const term = this.query().trim().toLowerCase();
    const stage = this.stage();
    const filtered = state.data.filter((product) => {
      const haystack = [product.canonicalName, product.category, this.origin(product)]
        .join(' ')
        .toLowerCase();
      const matchesTerm = !term || haystack.includes(term);
      const matchesStage =
        stage === 'all' ||
        product.stage === stage ||
        (stage === 'launch' && (product.trendScore.value ?? 0) >= 60 && product.risk !== 'alto');
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
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.sortKey.set(key);
    this.sortDir.set(key === 'name' ? 'asc' : 'desc');
  }

  origin(product: TrendProduct): string {
    return product.canonicalName.split('—').at(-1)?.trim() ?? '—';
  }

  stageLabel(stage: TrendStage | null): string {
    return stage ? (STAGE_LABEL[stage] ?? stage) : '—';
  }

  private compare(a: TrendProduct, b: TrendProduct): number {
    const dir = this.sortDir() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    const av = this.sortValue(a, key);
    const bv = this.sortValue(b, key);
    return av > bv ? dir : av < bv ? -dir : 0;
  }

  private sortValue(product: TrendProduct, key: SortKey): string | number {
    if (key === 'name') {
      return product.canonicalName;
    }
    if (key === 'growth') {
      return product.growthPct ?? -Infinity;
    }
    if (key === 'risk') {
      return product.risk ?? '';
    }
    return product.trendScore.value ?? -Infinity;
  }
}
