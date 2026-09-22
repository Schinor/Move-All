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
  private static readonly REASONS: Record<string, string> = {
    watchlist: 'Card na watchlist',
    top50: 'Entre os 50 cards de maior score',
    descoberta: 'Veio da descoberta por termo em alta',
    radar: 'Tipo com buscas em alta no radar',
    demais: 'Demais anúncios',
  };

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
  tracking(l: CardListing): string {
    const t = l.tracking;
    if (!t) return '—';
    if (t.status === 'IGNORED') return 'Fora do acompanhamento';
    if (t.status === 'DEAD') return 'Anúncio encerrado';
    const freq = t.tier === 1 ? 'a cada 3,5 dias' : t.tier === 2 ? 'semanal' : 'mensal';
    return `Nível ${t.tier} · ${freq}`;
  }
  trackingReason(l: CardListing): string {
    const reason = l.tracking?.reason;
    return reason ? (CardListingsTableComponent.REASONS[reason] ?? reason) : '';
  }
  lastCollected(l: CardListing): string {
    const iso = l.tracking?.lastSuccessAt;
    if (!iso) return '';
    return `última: ${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  }
  price(l: CardListing): string {
    if (l.price === null) return '—';
    const value = l.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${l.currency === 'BRL' ? 'R$' : (l.currency ?? '')} ${value}`.trim();
  }
}
