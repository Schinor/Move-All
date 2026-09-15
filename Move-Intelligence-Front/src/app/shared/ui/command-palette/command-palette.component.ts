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
import { categoryLabel } from '../../util/format';
import { IconComponent, IconName } from '../icon/icon.component';
import { MaiMarkComponent } from '../mai-mark/mai-mark.component';

type PaletteItemKind = 'route' | 'action' | 'product' | 'category' | 'supplier';

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  icon: IconName;
  kind: PaletteItemKind;
  path?: string;
  action?: () => void;
}

interface PaletteGroup {
  title: string;
  items: PaletteItem[];
  /** Índice do primeiro item na lista plana (navegação por teclado). */
  start: number;
}

interface Screen {
  id: string;
  label: string;
  path: string;
  image?: string;
  brandMark?: boolean;
  synonyms: string;
}

/** Telas na barra de ícones (sem login). */
const SCREENS: Screen[] = [
  { id: 'dashboard', label: 'Executivo', path: '/', image: 'icons/nav/executivo.webp', synonyms: 'visão geral kpis dashboard' },
  { id: 'ranking', label: 'Ranking', path: '/ranking', image: 'icons/nav/ranking.webp', synonyms: 'tendências produtos score' },
  { id: 'comparador', label: 'Comparador', path: '/comparador', image: 'icons/nav/comparador.webp', synonyms: 'comparar lado a lado' },
  { id: 'sinais', label: 'Sinais & Alertas', path: '/sinais', image: 'icons/nav/sinais.webp', synonyms: 'alertas notificações monitorar' },
  { id: 'mercados', label: 'Mercados', path: '/mercados', image: 'icons/nav/mercados.webp', synonyms: 'países saturação' },
  { id: 'copilot', label: 'AI Copilot', path: '/ai-copilot', brandMark: true, synonyms: 'ia assistente perguntas m.ai' },
  { id: 'sourcing', label: 'Sourcing', path: '/sourcing', image: 'icons/nav/sourcing.webp?v=2', synonyms: 'fornecedores fábricas' },
  { id: 'pipeline', label: 'Pipeline', path: '/pipeline', image: 'icons/nav/pipeline.webp', synonyms: 'workflow decisão' },
  { id: 'recomendacoes', label: 'Recomendações', path: '/recomendacoes', image: 'icons/nav/recomendacoes.webp', synonyms: 'ações comprar monitorar' },
];

/** Objetivos de treino que a busca entende (mesmos tópicos do backend). */
const GOALS = ['Pernas', 'Glúteos', 'Braços', 'Peito', 'Costas', 'Abdômen', 'Cardio', 'Alongamento', 'Recuperação', 'Força'];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MaiMarkComponent],
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

  readonly screens = SCREENS;
  readonly goals = GOALS;

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly selectedIndex = signal(0);
  readonly isSearching = signal(false);
  private readonly results = signal<{
    products: Array<{ id: string; name: string; category: string | null; match?: 'nome' | 'objetivo' }>;
    categories: string[];
    suppliers: Array<{ id: string; name: string; source: string }>;
    topics: string[];
  }>({ products: [], categories: [], suppliers: [], topics: [] });

  private origin: HTMLElement | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly groups = computed<PaletteGroup[]>(() => {
    const term = normalize(this.query());
    const res = this.results();
    const raw: Array<{ title: string; items: PaletteItem[] }> = [];

    if (!term) {
      raw.push({ title: 'Ações', items: this.actions() });
    } else {
      const byGoal = res.products.filter((p) => p.match === 'objetivo').slice(0, 8);
      const byName = res.products.filter((p) => p.match !== 'objetivo').slice(0, 8);
      if (byName.length) raw.push({ title: 'Produtos', items: byName.map((p) => this.productItem(p)) });
      if (byGoal.length) {
        raw.push({
          title: res.topics.length ? `Para ${res.topics.join(', ')}` : 'Relacionados',
          items: byGoal.map((p) => this.productItem(p)),
        });
      }
      if (res.categories.length) {
        raw.push({
          title: 'Categorias',
          items: res.categories.slice(0, 4).map((c) => ({
            id: `cat-${c}`,
            label: categoryLabel(c) || c,
            description: 'Ver no ranking',
            icon: 'bar-chart' as const,
            kind: 'category' as const,
            path: `/ranking?q=${encodeURIComponent(c)}`,
          })),
        });
      }
      if (res.suppliers.length) {
        raw.push({
          title: 'Fornecedores',
          items: res.suppliers.slice(0, 4).map((s) => ({
            id: `sup-${s.id}`,
            label: s.name,
            description: s.source,
            icon: 'boxes' as const,
            kind: 'supplier' as const,
            path: '/sourcing',
          })),
        });
      }
      const screens = SCREENS.filter((s) => normalize(`${s.label} ${s.synonyms}`).includes(term)).map(
        (s): PaletteItem => ({ id: `screen-${s.id}`, label: s.label, description: 'Tela', icon: 'arrow-right', kind: 'route', path: s.path }),
      );
      const actions = this.actions().filter((a) => normalize(`${a.label} ${a.description}`).includes(term));
      if (screens.length || actions.length) raw.push({ title: 'Telas e ações', items: [...screens, ...actions] });
    }

    let start = 0;
    return raw.map((group) => {
      const withStart = { ...group, start };
      start += group.items.length;
      return withStart;
    });
  });

  readonly items = computed(() => this.groups().flatMap((group) => group.items));

  /** Objetivo selecionado pelo chip (a busca é exatamente o nome dele). */
  readonly activeGoal = computed(() => {
    const term = normalize(this.query());
    return GOALS.find((goal) => normalize(goal) === term) ?? null;
  });

  open(origin?: HTMLElement | null): void {
    this.origin = origin ?? null;
    this.query.set('');
    this.results.set({ products: [], categories: [], suppliers: [], topics: [] });
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
    this.queueSearch(value);
  }

  /** Chip de objetivo: preenche a busca e mantém o foco no campo. */
  searchGoal(goal: string): void {
    // Clicar no objetivo ativo desfaz a seleção.
    this.setQuery(this.activeGoal() === goal ? '' : goal);
    this.searchInput?.nativeElement.focus();
  }

  /** Volta ao estado inicial da paleta sem fechá-la. */
  clearQuery(): void {
    this.setQuery('');
    this.searchInput?.nativeElement.focus();
  }

  goTo(screen: Screen): void {
    void this.router.navigateByUrl(screen.path);
    this.close();
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
      // Com busca digitada, o primeiro Esc limpa; o segundo fecha.
      if (this.query()) this.clearQuery();
      else this.close();
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
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
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
        label: 'Alternar barra lateral',
        description: 'Mostrar ou recolher a navegação',
        icon: 'panel-left',
        kind: 'action',
        action: () => this.layout.toggleSidebar(),
      },
    ];
  }

  private productItem(product: { id: string; name: string; category: string | null }): PaletteItem {
    return {
      id: `product-${product.id}`,
      label: product.name,
      description: categoryLabel(product.category) || 'Produto',
      icon: 'package',
      kind: 'product',
      path: `/tendencia/${product.id}`,
    };
  }

  private queueSearch(value: string): void {
    if (this.searchTimer) window.clearTimeout(this.searchTimer);
    const term = value.trim();
    if (term.length < 2) {
      this.results.set({ products: [], categories: [], suppliers: [], topics: [] });
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = window.setTimeout(() => {
      // D3: busca aproximada no Postgres (C4) + objetivos (pernas → categorias).
      this.trends.searchAll(term, 20).subscribe({
        next: (res) => {
          if (this.query().trim() !== term) return;
          const seen = new Set<string>();
          const products = (res.products ?? []).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
          this.results.set({
            products,
            categories: res.categories ?? [],
            suppliers: res.suppliers ?? [],
            topics: (res.topics ?? []).map((t) => t.label),
          });
          this.selectedIndex.set(0);
          this.isSearching.set(false);
        },
        error: () => {
          this.results.set({ products: [], categories: [], suppliers: [], topics: [] });
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
      element?.scrollIntoView({ block: 'nearest' });
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
