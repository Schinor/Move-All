import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../../../core/services/layout.service';
import { IconComponent, IconName } from '../../ui/icon/icon.component';
import { BrandMarkComponent } from '../../ui/brand-mark/brand-mark.component';
import { BrandLockupComponent } from '../../ui/brand-lockup/brand-lockup.component';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  soon?: boolean;
  synonyms?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent, BrandMarkComponent, BrandLockupComponent],
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.css',
})
export class AppSidebarComponent {
  readonly layout = inject(LayoutService);

  readonly groups: NavGroup[] = [
    {
      label: 'Decidir',
      items: [
        { path: '/', label: 'Executivo', icon: 'compass', exact: true, synonyms: 'dashboard' },
        { path: '/ranking', label: 'Ranking', icon: 'bar-chart', synonyms: 'tendências produtos' },
        { path: '/comparador', label: 'Comparador', icon: 'columns', synonyms: 'produtos lado a lado' },
      ],
    },
    {
      label: 'Investigar',
      items: [
        { path: '/sinais', label: 'Sinais & Alertas', icon: 'bell', synonyms: 'notificações' },
        { path: '/mercados', label: 'Mercados', icon: 'globe', soon: true, synonyms: 'países' },
        { path: '/ai-copilot', label: 'AI Copilot', icon: 'sparkles', synonyms: 'assistente ia' },
      ],
    },
    {
      label: 'Executar',
      items: [
        { path: '/sourcing', label: 'Sourcing', icon: 'boxes', synonyms: 'fornecedores' },
        { path: '/pipeline', label: 'Pipeline', icon: 'kanban', soon: true, synonyms: 'decisão workflow' },
        { path: '/recomendacoes', label: 'Recomendações', icon: 'lightbulb', soon: true, synonyms: 'ações' },
      ],
    },
  ];

  closeOnCompact(): void {
    if (window.innerWidth <= 1024) this.layout.closeSidebar();
  }
}
