import { Routes } from '@angular/router';

/** As 9 rotas do produto + auth + fallback. Componentes lazy-loaded (standalone). */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'ranking',
    loadComponent: () =>
      import('./features/ranking/ranking.component').then((m) => m.RankingComponent),
  },
  {
    path: 'mercados',
    loadComponent: () =>
      import('./features/mercados/mercados.component').then((m) => m.MercadosComponent),
  },
  {
    path: 'sinais',
    loadComponent: () => import('./features/sinais/sinais.component').then((m) => m.SinaisComponent),
  },
  {
    path: 'comparador',
    loadComponent: () =>
      import('./features/comparador/comparador.component').then((m) => m.ComparadorComponent),
  },
  {
    path: 'pipeline',
    loadComponent: () =>
      import('./features/pipeline/pipeline.component').then((m) => m.PipelineComponent),
  },
  {
    path: 'recomendacoes',
    loadComponent: () =>
      import('./features/recomendacoes/recomendacoes.component').then(
        (m) => m.RecomendacoesComponent,
      ),
  },
  {
    path: 'ai-copilot',
    loadComponent: () =>
      import('./features/ai-copilot/ai-copilot.component').then((m) => m.AiCopilotComponent),
  },
  {
    path: 'sourcing',
    loadComponent: () =>
      import('./features/sourcing/sourcing.component').then((m) => m.SourcingComponent),
  },
  {
    path: 'tendencia/:id',
    loadComponent: () =>
      import('./features/tendencia/tendencia.component').then((m) => m.TendenciaComponent),
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

