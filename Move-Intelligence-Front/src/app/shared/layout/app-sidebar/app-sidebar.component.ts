import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../../../core/services/layout.service';
import { IconComponent, IconName } from '../../ui/icon/icon.component';
import { BrandMarkComponent } from '../../ui/brand-mark/brand-mark.component';
import { BrandLockupComponent } from '../../ui/brand-lockup/brand-lockup.component';
import { MaiMarkComponent } from '../../ui/mai-mark/mai-mark.component';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  soon?: boolean;
  synonyms?: string;
  /** Ícone ilustrado (public/icons/nav) no lugar do ícone de linha. */
  image?: string;
  /** Mostra a marca M.AI no lugar do ícone. */
  brandMark?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent, BrandMarkComponent, BrandLockupComponent, MaiMarkComponent],
  templateUrl: './app-sidebar.component.html',
  styleUrl: './app-sidebar.component.css',
})
export class AppSidebarComponent {
  readonly layout = inject(LayoutService);

  readonly groups: NavGroup[] = [
    {
      label: 'Decidir',
      items: [
        { path: '/', label: 'Executivo', icon: 'compass', image: 'icons/nav/executivo.webp', exact: true, synonyms: 'dashboard' },
        { path: '/ranking', label: 'Ranking', icon: 'bar-chart', image: 'icons/nav/ranking.webp', synonyms: 'tendências produtos' },
        { path: '/comparador', label: 'Comparador', icon: 'columns', image: 'icons/nav/comparador.webp', synonyms: 'produtos lado a lado' },
      ],
    },
    {
      label: 'Investigar',
      items: [
        { path: '/sinais', label: 'Sinais & Alertas', icon: 'bell', image: 'icons/nav/sinais.webp', synonyms: 'notificações' },
        { path: '/mercados', label: 'Mercados', icon: 'globe', image: 'icons/nav/mercados.webp', soon: true, synonyms: 'países' },
        { path: '/ai-copilot', label: 'AI Copilot', icon: 'copilot', brandMark: true, synonyms: 'assistente ia m.ai' },
      ],
    },
    {
      label: 'Executar',
      items: [
        { path: '/sourcing', label: 'Sourcing', icon: 'boxes', image: 'icons/nav/sourcing.webp?v=2', synonyms: 'fornecedores' },
        { path: '/pipeline', label: 'Pipeline', icon: 'kanban', image: 'icons/nav/pipeline.webp', soon: true, synonyms: 'decisão workflow' },
        { path: '/recomendacoes', label: 'Recomendações', icon: 'lightbulb', image: 'icons/nav/recomendacoes.webp', soon: true, synonyms: 'ações' },
      ],
    },
  ];

  closeOnCompact(): void {
    if (window.innerWidth <= 1024) this.layout.closeSidebar();
  }

  /**
   * P1-7: no rail recolhido (desktop), o clique no logo expande em vez de
   * navegar; nos demais estados, segue o routerLink + fecha a gaveta.
   */
  brandClick(event: Event): void {
    if (window.innerWidth > 1024 && !this.layout.sidebarOpen()) {
      event.preventDefault();
      this.layout.toggleSidebar();
      return;
    }
    this.closeOnCompact();
  }
}
