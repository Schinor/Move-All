import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/** Só ADMIN acessa (fila de revisão). Sem sessão/usuário carregado, tenta loadMe antes de decidir. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const home = router.createUrlTree(['/']);
  const user = auth.currentUser();
  if (user) return user.role === 'ADMIN' ? true : home;
  if (!auth.hasStoredSession()) return router.createUrlTree(['/login']);
  return auth.loadMe().pipe(
    map((loaded) => (loaded?.role === 'ADMIN' ? true : home)),
    catchError(() => of(home)),
  );
};
