import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../../../core/services/layout.service';

type IconKey = 'compass' | 'bar-chart' | 'columns' | 'bell' | 'sparkles' | 'boxes';

interface NavItem {
  path: string;
  label: string;
  icon: IconKey;
  exact?: boolean;
}

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.css',
})
export class AppSidebarComponent {
  readonly layout = inject(LayoutService);

  readonly nav: NavItem[] = [
    { path: '/', label: 'Executivo', icon: 'compass', exact: true },
    { path: '/ranking', label: 'Ranking', icon: 'bar-chart' },
    { path: '/comparador', label: 'Comparador', icon: 'columns' },
    { path: '/sinais', label: 'Sinais & Alertas', icon: 'bell' },
    { path: '/ai-copilot', label: 'AI Copilot', icon: 'sparkles' },
    { path: '/sourcing', label: 'Sourcing', icon: 'boxes' },
  ];

  closeOnCompact(): void {
    if (window.innerWidth <= 1024) this.layout.closeSidebar();
  }
}
