import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CatalogService } from '../../../core/services/catalog.service';
import { DiscoveryTermsService } from '../../../core/services/discovery-terms.service';
import { CatalogFamily, DiscoveryTerm, DiscoveryTermCounts } from '../../../core/models/contract.models';

type Chip = 'new' | 'approved' | 'ignored';

@Component({
  selector: 'app-discovery-terms',
  standalone: true,
  templateUrl: './discovery-terms.component.html',
  styleUrl: './discovery-terms.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscoveryTermsComponent {
  private readonly api = inject(DiscoveryTermsService);
  private readonly catalog = inject(CatalogService);

  readonly chip = signal<Chip>('new');
  readonly geo = signal<'' | 'BR' | 'US'>('');
  readonly family = signal('');
  readonly counts = signal<DiscoveryTermCounts>({ new: 0, approved: 0, searched: 0, ignored: 0 });
  readonly items = signal<DiscoveryTerm[]>([]);
  readonly families = signal<CatalogFamily[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.catalog.families().subscribe((families) => this.families.set(families));
    this.reload();
  }

  setChip(chip: Chip): void { this.chip.set(chip); this.reload(); }
  setGeo(value: string): void { this.geo.set(value === 'BR' || value === 'US' ? value : ''); this.reload(); }
  setFamily(value: string): void { this.family.set(value); this.reload(); }

  reload(): void {
    this.error.set(null);
    this.api.counts().subscribe({ next: (counts) => this.counts.set(counts), error: () => this.error.set('Não foi possível carregar os termos.') });
    const status = this.chip() === 'approved' ? 'approved,searched' : this.chip();
    this.api.list({ status, geo: this.geo() || undefined, family: this.family() || undefined }).subscribe({
      next: (items) => this.items.set(items),
      error: () => this.error.set('Não foi possível carregar os termos.'),
    });
  }

  approve(term: DiscoveryTerm): void { this.act(this.api.approve(term.id), 'Não foi possível aprovar o termo.'); }
  ignore(term: DiscoveryTerm): void { this.act(this.api.ignore(term.id), 'Não foi possível ignorar o termo.'); }
  restore(term: DiscoveryTerm): void { this.act(this.api.restore(term.id), 'Não foi possível restaurar o termo.'); }

  situation(term: DiscoveryTerm): string {
    if (term.status === 'searched') return `Buscado em ${this.day(term.searchedAt)}: ${term.newListings ?? 0} anúncios novos`;
    if (term.searchError) return `Erro na última busca: ${term.searchError}`;
    return 'Na fila: entra na próxima coleta';
  }

  seen(term: DiscoveryTerm): string {
    const days = Math.floor((Date.now() - Date.parse(term.firstSeenAt)) / 86_400_000);
    if (days < 7) return 'esta semana';
    const weeks = Math.floor(days / 7);
    return `há ${weeks} semana${weeks > 1 ? 's' : ''}`;
  }

  private day(iso: string | null): string {
    return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
  }

  private act(request: ReturnType<DiscoveryTermsService['approve']>, message: string): void {
    request.subscribe({ next: () => this.reload(), error: () => this.error.set(message) });
  }
}
