import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TrendsService } from '../../../core/services/trends.service';
import { LayoutService } from '../../../core/services/layout.service';
import { ThemeService } from '../../../core/services/theme.service';
import { TrendProduct } from '../../../core/models/contract.models';
import { IconComponent, IconName } from '../icon/icon.component';

type PaletteItemKind = 'route' | 'action' | 'product';

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  kind: PaletteItemKind;
  path?: string;
  action?: () => void;
}

const ROUTES: PaletteItem[] = [
  { id: 'dashboard', label: 'Executivo', description: 'Visão geral do negócio', icon: 'compass', kind: 'route', path: '/' },
  { id: 'ranking', label: 'Ranking', description: 'Tendências priorizadas', icon: 'bar-chart', kind: 'route', path: '/ranking' },
  { id: 'comparador', label: 'Comparador', description: 'Produtos lado a lado', icon: 'columns', kind: 'route', path: '/comparador' },
  { id: 'sinais', label: 'Sinais & Alertas', description: 'Monitoramento e notificações', icon: 'bell', kind: 'route', path: '/sinais' },
  { id: 'mercados', label: 'Mercados', description: 'Módulo em desenvolvimento', icon: 'globe', kind: 'route', path: '/mercados' },
  { id: 'copilot', label: 'AI Copilot', description: 'Perguntas sobre o catálogo', icon: 'sparkles', kind: 'route', path: '/ai-copilot' },
  { id: 'sourcing', label: 'Sourcing', description: 'Fornecedores e origens', icon: 'boxes', kind: 'route', path: '/sourcing' },
  { id: 'pipeline', label: 'Pipeline', description: 'Módulo em desenvolvimento', icon: 'kanban', kind: 'route', path: '/pipeline' },
  { id: 'recomendacoes', label: 'Recomendações', description: 'Módulo em desenvolvimento', icon: 'lightbulb', kind: 'route', path: '/recomendacoes' },
  { id: 'login', label: 'Login', description: 'Acesso à plataforma', icon: 'lock', kind: 'route', path: '/login' },
];

@Component({
  selector: 'app-command-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.css',
})
export class CommandPaletteComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly trends = inject(TrendsService);
  private readonly layout = inject(LayoutService);
  private readonly theme = inject(ThemeService);

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;
  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly selectedIndex = signal(0);
  readonly products = signal<TrendProduct[]>([]);
  readonly isSearching = signal(false);

  private origin: HTMLElement | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly items = computed(() => {
    const term = this.query().trim().toLowerCase();
    const routeItems = ROUTES.filter((item) =>
      !term
        ? true
        : `${item.label} ${item.description} ${this.synonyms(item.id)}`.toLowerCase().includes(term),
    );
    const actionItems = this.actions().filter((item) =>
      !term ? true : `${item.label} ${item.description}`.toLowerCase().includes(term),
    );
    const productItems = this.products().map((product) => this.productItem(product));
    return [...routeItems, ...actionItems, ...productItems];
  });

  readonly suggested = computed(() => this.actions().slice(0, 2));

  open(origin?: HTMLElement | null): void {
    this.origin = origin ?? null;
    this.query.set('');
    this.products.set([]);
    this.selectedIndex.set(0);
    this.isOpen.set(true);
    window.setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    const target = this.origin;
    this.origin = null;
    window.setTimeout(() => target?.focus(), 0);
  }

  setQuery(value: string): void {
    this.query.set(value);
    this.selectedIndex.set(0);
    this.queueProductSearch(value);
  }

  execute(item: PaletteItem): void {
    if (item.action) item.action();
    if (item.path) void this.router.navigateByUrl(item.path);
    this.close();
  }

  onBackdropClick(): void {
    this.close();
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.isOpen()) this.close();
      else this.open(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      return;
    }
    if (!this.isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex.update((index) => Math.min(index + 1, Math.max(0, this.items().length - 1)));
      this.focusSelected();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex.update((index) => Math.max(index - 1, 0));
      this.focusSelected();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.items()[this.selectedIndex()];
      if (item) this.execute(item);
      return;
    }
    if (event.key === 'Tab') this.keepFocusInside(event);
  }

  ngOnDestroy(): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
  }

  private actions(): PaletteItem[] {
    return [
      {
        id: 'theme',
        label: 'Alternar tema',
        description: this.theme.label(),
        icon: this.theme.icon(),
        kind: 'action',
        action: () => this.theme.toggle(),
      },
      {
        id: 'sidebar',
        label: 'Alternar sidebar',
        description: 'Mostrar ou recolher a navegação',
        icon: 'panel-left',
        kind: 'action',
        action: () => this.layout.toggleSidebar(),
      },
      {
        id: 'ai-action',
        label: 'Ir para AI Copilot',
        description: 'Abrir o assistente de inteligência',
        icon: 'sparkles',
        kind: 'action',
        path: '/ai-copilot',
      },
    ];
  }

  private productItem(product: TrendProduct): PaletteItem {
    return {
      id: `product-${product.productClusterId}`,
      label: product.canonicalName,
      description: `Produto${product.category ? ` · ${product.category}` : ''}`,
      icon: 'package',
      kind: 'product',
      path: `/tendencia/${product.productClusterId}`,
    };
  }

  private synonyms(id: string): string {
    const synonyms: Record<string, string> = {
      dashboard: 'visão geral kpis',
      ranking: 'tendências produtos score',
      comparador: 'comparar lado a lado',
      sinais: 'alertas notificações monitorar',
      mercados: 'países saturação',
      copilot: 'ia assistente perguntas',
      sourcing: 'fornecedores fábricas',
      pipeline: 'workflow decisão',
      recomendacoes: 'ações comprar monitorar',
      login: 'entrar acesso',
    };
    return synonyms[id] ?? '';
  }

  private queueProductSearch(value: string): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    const term = value.trim();
    if (term.length < 2) {
      this.products.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = window.setTimeout(() => {
      this.trends.listProducts({ limit: 12 }).subscribe({
        next: (products) => {
          const normalized = term.toLowerCase();
          this.products.set(
            products.filter((product) =>
              `${product.canonicalName} ${product.category ?? ''}`.toLowerCase().includes(normalized),
            ),
          );
          this.isSearching.set(false);
        },
        error: () => {
          this.products.set([]);
          this.isSearching.set(false);
        },
      });
    }, 250);
  }

  private focusSelected(): void {
    window.setTimeout(() => {
      const element = this.dialog?.nativeElement.querySelector<HTMLElement>(
        `[data-palette-index="${this.selectedIndex()}"]`,
      );
      element?.focus();
    }, 0);
  }

  private keepFocusInside(event: KeyboardEvent): void {
    const focusable = Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLElement>('input, button, [href]') ?? [],
    ).filter((element) => !element.hasAttribute('disabled'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
