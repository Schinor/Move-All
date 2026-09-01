import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { toAsyncState } from '../../../core/api/async-state';
import { Alert } from '../../../core/models/contract.models';
import { AlertsService } from '../../../core/services/alerts.service';
import { LayoutService } from '../../../core/services/layout.service';
import { ThemeService } from '../../../core/services/theme.service';
import { CommandPaletteComponent } from '../../ui/command-palette/command-palette.component';
import { IconComponent } from '../../ui/icon/icon.component';

/** Rota -> [grupo da navegação, nome da tela]. O breadcrumb espelha a sidebar. */
const ROUTE_TRAIL: Record<string, [string, string]> = {
  '/': ['Decidir', 'Executivo'],
  '/ranking': ['Decidir', 'Ranking'],
  '/comparador': ['Decidir', 'Comparador'],
  '/sinais': ['Investigar', 'Sinais & Alertas'],
  '/mercados': ['Investigar', 'Mercados'],
  '/ai-copilot': ['Investigar', 'AI Copilot'],
  '/sourcing': ['Executar', 'Sourcing'],
  '/pipeline': ['Executar', 'Pipeline'],
  '/recomendacoes': ['Executar', 'Recomendações'],
};

/** Barra de contexto global: navegação, busca, tema e alertas reais. */
@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, CommandPaletteComponent, DatePipe],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.css',
})
export class TopBarComponent {
  readonly layout = inject(LayoutService);
  readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertsService);

  readonly theme = this.themeService.theme;
  readonly alertsState = toAsyncState(this.alerts.list());
  readonly notificationsOpen = signal(false);
  readonly accountOpen = signal(false);

  readonly trail = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => this.routeTrail(event.urlAfterRedirects)),
    ),
    { initialValue: this.routeTrail(this.router.url) },
  );

  /** ⌘ no macOS, Ctrl no resto — o atalho anunciado precisa ser o atalho real. */
  readonly shortcutKey = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl';

  readonly unreadAlerts = computed(() => {
    const state = this.alertsState();
    if (state.status !== 'ready') return [];
    return state.data.filter((alert) => !this.isClosed(alert));
  });

  toggleTheme(): void {
    this.themeService.toggle();
  }

  toggleSidebar(): void {
    this.layout.toggleSidebar();
  }

  openPalette(event: Event, palette: CommandPaletteComponent): void {
    this.notificationsOpen.set(false);
    this.accountOpen.set(false);
    palette.open(event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  }

  toggleNotifications(): void {
    this.accountOpen.set(false);
    this.notificationsOpen.update((open) => !open);
  }

  toggleAccount(): void {
    this.notificationsOpen.set(false);
    this.accountOpen.update((open) => !open);
  }

  closeMenus(): void {
    this.notificationsOpen.set(false);
    this.accountOpen.set(false);
  }

  alertSeverity(alert: Alert): string {
    return alert.severity.toLowerCase();
  }

  private isClosed(alert: Alert): boolean {
    const status = alert.status.toLowerCase();
    return ['read', 'resolved', 'closed', 'dismissed'].includes(status);
  }

  private routeTrail(url: string): [string, string] {
    const cleanUrl = url.split('?')[0].split('#')[0];
    if (ROUTE_TRAIL[cleanUrl]) return ROUTE_TRAIL[cleanUrl];
    if (cleanUrl.startsWith('/tendencia/')) return ['Decidir', 'Dossiê de tendência'];
    return ['Move Intelligence', 'Página não encontrada'];
  }
}
