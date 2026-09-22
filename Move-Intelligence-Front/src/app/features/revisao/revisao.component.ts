import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogService } from '../../core/services/catalog.service';
import { CatalogFamily, ReviewCounts, ReviewListingItem, ReviewTypeItem } from '../../core/models/contract.models';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { sourceLabel } from '../../shared/util/format';
import { DiscoveryTermsComponent } from './discovery-terms/discovery-terms.component';

type Tab = 'provisional_listing' | 'suggested_type' | 'discovery_terms';

@Component({
  selector: 'app-revisao',
  standalone: true,
  imports: [FormsModule, PageHeaderComponent, DiscoveryTermsComponent],
  templateUrl: './revisao.component.html',
  styleUrl: './revisao.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RevisaoComponent {
  private readonly catalog = inject(CatalogService);

  readonly tab = signal<Tab>('provisional_listing');
  readonly counts = signal<ReviewCounts>({ provisionalListing: 0, suggestedType: 0 });
  readonly listingItems = signal<ReviewListingItem[]>([]);
  readonly typeItems = signal<ReviewTypeItem[]>([]);
  readonly families = signal<CatalogFamily[]>([]);
  readonly message = signal<string | null>(null);
  readonly queueError = signal<string | null>(null);
  readonly approveError = signal<string | null>(null);
  readonly lastDecisionId = signal<string | null>(null);
  readonly moveFor = signal<string | null>(null);
  readonly moveResults = signal<Array<{ id: string; name: string }>>([]);
  readonly approveFor = signal<string | null>(null);
  approveForm = { familyKey: '', key: '', namePt: '', ncm: '' };
  moveQuery = '';
  readonly sourceLabel = sourceLabel;

  constructor() {
    this.reload();
    this.catalog.families().subscribe((f) => this.families.set(f));
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.reload();
  }

  reload(): void {
    this.queueError.set(null);
    this.catalog.reviewCounts().subscribe({
      next: (c) => this.counts.set(c),
      error: (e: unknown) => this.queueError.set(this.queueErrorMessage(e)),
    });
    if (this.tab() === 'discovery_terms') return;
    if (this.tab() === 'provisional_listing') {
      this.catalog.reviewList('provisional_listing').subscribe({
        next: (r) => this.listingItems.set(r.items),
        error: (e: unknown) => this.queueError.set(this.queueErrorMessage(e)),
      });
    } else {
      this.catalog.reviewList('suggested_type').subscribe({
        next: (r) => this.typeItems.set(r.items),
        error: (e: unknown) => this.queueError.set(this.queueErrorMessage(e)),
      });
    }
  }

  private queueErrorMessage(error: unknown): string {
    const status =
      typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 0;
    return `Não foi possível carregar a fila (erro ${status}).`;
  }

  private suggestedTypeName(key: string): string {
    const words = key.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : '';
  }

  private done(text: string) {
    return {
      next: (r: { decisionId: string }) => {
        this.message.set(text);
        this.lastDecisionId.set(r.decisionId);
        this.moveFor.set(null);
        this.approveFor.set(null);
        this.reload();
      },
      error: (e: { error?: { message?: string } }) => this.message.set(e?.error?.message ?? 'Não foi possível concluir a ação.'),
    };
  }

  confirm(item: ReviewListingItem): void { this.catalog.confirm(item.id).subscribe(this.done('Anúncio confirmado no card.')); }
  outOfScope(item: ReviewListingItem): void { this.catalog.outOfScope(item.id).subscribe(this.done('Anúncio marcado como fora do escopo.')); }
  createCard(item: ReviewListingItem): void {
    if (!item.ficha?.typeKey) return;
    const name = window.prompt('Nome do card novo (deixe vazio para montar automaticamente)')?.trim() || undefined;
    this.catalog.createCard(item.id, { typeKey: item.ficha.typeKey, cardKeyValues: item.ficha.cardKeyValues, name })
      .subscribe(this.done('Card novo criado.'));
  }
  openMove(item: ReviewListingItem): void { this.moveFor.set(item.id); this.moveQuery = ''; this.moveResults.set([]); }
  searchMove(): void {
    if (this.moveQuery.trim().length < 2) return;
    this.catalog.searchCards(this.moveQuery).subscribe((r) => this.moveResults.set(r.map((c) => ({ id: c.id, name: c.name }))));
  }
  move(item: ReviewListingItem, targetId: string): void { this.catalog.move(item.id, targetId).subscribe(this.done('Anúncio movido.')); }

  openApprove(item: ReviewTypeItem): void {
    this.approveFor.set(item.id);
    this.approveError.set(null);
    this.approveForm = {
      familyKey: this.families()[0]?.key ?? '',
      key: item.suggestedTypeKey,
      namePt: this.suggestedTypeName(item.suggestedTypeKey),
      ncm: '',
    };
  }
  approve(item: ReviewTypeItem): void {
    const { familyKey, key, namePt, ncm } = this.approveForm;
    if (!familyKey || !key || namePt.trim().length < 2) {
      this.approveError.set('Preencha família, chave e nome.');
      return;
    }
    this.approveError.set(null);
    this.catalog.approveType(item.id, { familyKey, key, namePt: namePt.trim(), ...(ncm.trim() ? { ncm: ncm.trim() } : {}) })
      .subscribe(this.done('Tipo aprovado.'));
  }
  merge(item: ReviewTypeItem): void {
    const typeKey = window.prompt('Juntar com qual tipo existente? (chave, ex.: power_rack)', item.similarTypes[0]?.key ?? '')?.trim();
    if (!typeKey) return;
    this.catalog.mergeType(item.id, typeKey).subscribe(this.done('Anúncios devolvidos para a fila da ficha.'));
  }
  discard(item: ReviewTypeItem): void { this.catalog.discardType(item.id).subscribe(this.done('Tipo descartado.')); }
  undo(): void {
    const id = this.lastDecisionId();
    if (id) this.catalog.undo(id).subscribe(this.done('Decisão desfeita.'));
  }
}
