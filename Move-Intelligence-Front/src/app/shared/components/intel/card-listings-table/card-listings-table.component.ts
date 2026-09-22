import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { toAsyncState } from '../../../../core/api/async-state';
import { CatalogService } from '../../../../core/services/catalog.service';
import { CardListing } from '../../../../core/models/contract.models';
import { StatePanelComponent } from '../../../ui/state-panel/state-panel.component';
import { sourceLabel } from '../../../util/format';
import { filterByMarketplace, marketplaceChips } from '../../../util/marketplace-filter';

@Component({
  selector: 'app-card-listings-table',
  standalone: true,
  imports: [StatePanelComponent],
  templateUrl: './card-listings-table.component.html',
  styleUrl: './card-listings-table.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardListingsTableComponent {
  private readonly catalog = inject(CatalogService);
  readonly productClusterId = input.required<string>();
  readonly listings = toAsyncState(
    toObservable(this.productClusterId).pipe(switchMap((id) => this.catalog.cardListings(id))),
  );
  readonly selectedMarketplace = signal<string | null>(null);
  readonly rows = computed(() => {
    const state = this.listings();
    return state.status === 'ready' ? state.data : [];
  });
  readonly chips = computed(() =>
    marketplaceChips(this.rows(), (listing) => listing.marketplace, (marketplace) => sourceLabel(marketplace) || marketplace),
  );
  readonly visibleRows = computed(() =>
    filterByMarketplace(this.rows(), (listing) => listing.marketplace, this.selectedMarketplace()),
  );

  store(l: CardListing): string { return sourceLabel(l.marketplace) || l.marketplace; }
  price(l: CardListing): string {
    if (l.price === null) return '—';
    const value = l.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${l.currency === 'BRL' ? 'R$' : (l.currency ?? '')} ${value}`.trim();
  }
}
