import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/** As 9 rotas do produto + auth + fallback. Componentes lazy-loaded (standalone). */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'ranking',
    loadComponent: () =>
      import('./features/ranking/ranking.component').then((m) => m.RankingComponent),
    canActivate: [authGuard],
  },
  {
    path: 'mercados',
    loadComponent: () =>
      import('./features/mercados/mercados.component').then((m) => m.MercadosComponent),
    canActivate: [authGuard],
  },
  {
    path: 'sinais',
    loadComponent: () => import('./features/sinais/sinais.component').then((m) => m.SinaisComponent),
    canActivate: [authGuard],
  },
  {
    path: 'comparador',
    loadComponent: () =>
      import('./features/comparador/comparador.component').then((m) => m.ComparadorComponent),
    canActivate: [authGuard],
  },
  {
    path: 'pipeline',
    loadComponent: () =>
      import('./features/pipeline/pipeline.component').then((m) => m.PipelineComponent),
    canActivate: [authGuard],
  },
  {
    path: 'recomendacoes',
    loadComponent: () =>
      import('./features/recomendacoes/recomendacoes.component').then(
        (m) => m.RecomendacoesComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'ai-copilot',
    loadComponent: () =>
      import('./features/ai-copilot/ai-copilot.component').then((m) => m.AiCopilotComponent),
    canActivate: [authGuard],
  },
  {
    path: 'sourcing',
    loadComponent: () =>
      import('./features/sourcing/sourcing.component').then((m) => m.SourcingComponent),
    canActivate: [authGuard],
  },
  {
    path: 'tendencia/:id',
    loadComponent: () =>
      import('./features/tendencia/tendencia.component').then((m) => m.TendenciaComponent),
    canActivate: [authGuard],
  },
  /* ── Autenticação ─────────────────────────────────────── */
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'cadastro',
    loadComponent: () =>
      import('./features/auth/cadastro/cadastro.component').then((m) => m.CadastroComponent),
  },
  /* ── Fallback ─────────────────────────────────────────── */
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];

