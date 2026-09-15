import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Guarda de rota: exige sessão válida. Com usuário já carregado, libera de
 * imediato; com refresh token guardado mas sem usuário (reload), tenta
 * `loadMe` (o interceptor faz o refresh transparente se o access expirou).
 * Sem sessão, redireciona para /login?redirect=<url>.
 */
export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  if (!auth.hasStoredSession()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  return auth.loadMe().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { redirect: state.url } }))),
  );
};
