import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { toAsyncState } from '../../../../core/api/async-state';
import { CatalogService } from '../../../../core/services/catalog.service';
import { CardListing } from '../../../../core/models/contract.models';
import { StatePanelComponent } from '../../../ui/state-panel/state-panel.component';
import { sourceLabel } from '../../../util/format';

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

  store(l: CardListing): string { return sourceLabel(l.marketplace) || l.marketplace; }
  price(l: CardListing): string {
    return l.price === null ? '—' : `${l.currency === 'BRL' ? 'R$' : (l.currency ?? '')} ${l.price.toLocaleString('pt-BR')}`.trim();
  }
}
