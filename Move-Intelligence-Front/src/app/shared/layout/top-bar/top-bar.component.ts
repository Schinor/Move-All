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

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Executivo',
  '/ranking': 'Ranking',
  '/comparador': 'Comparador',
  '/sinais': 'Sinais & Alertas',
  '/ai-copilot': 'AI Copilot',
  '/sourcing': 'Sourcing',
  '/mercados': 'Mercados',
  '/pipeline': 'Pipeline',
  '/recomendacoes': 'Recomendações',
  '/login': 'Login',
  '/cadastro': 'Cadastro',
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

  readonly breadcrumb = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => this.routeLabel(event.urlAfterRedirects)),
    ),
    { initialValue: this.routeLabel(this.router.url) },
  );

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

  private routeLabel(url: string): string {
    const cleanUrl = url.split('?')[0].split('#')[0];
    if (ROUTE_LABELS[cleanUrl]) return ROUTE_LABELS[cleanUrl];
    if (cleanUrl.startsWith('/tendencia/')) return 'Dossiê de tendência';
    return 'Move Intelligence';
  }
}
