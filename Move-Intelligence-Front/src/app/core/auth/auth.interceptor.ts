import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Rotas de auth que nunca recebem Authorization nem disparam refresh. */
const AUTH_SKIP_PATHS = ['/auth/login', '/auth/register', '/auth/refresh'];

/** Promessa compartilhada do refresh em andamento (single-flight). */
let refreshInFlight: Promise<boolean> | null = null;

function isApiRequest(url: string): boolean {
  // ApiClient sempre monta `${apiBaseUrl}${path}`; cobre base relativa (/api)
  // e absoluta (produção). Requisições externas nunca recebem o token.
  return url.startsWith(environment.apiBaseUrl);
}

function isAuthEndpoint(url: string): boolean {
  return AUTH_SKIP_PATHS.some((path) => url.includes(path));
}

/**
 * Interceptor funcional de autenticação: anexa `Authorization: Bearer`
 * só em chamadas à API, pula `/auth/*` públicas e, em 401, tenta um único
 * refresh (single-flight), refaz a requisição original uma vez e, se falhar,
 * limpa a sessão e redireciona para /login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!isApiRequest(req.url) || isAuthEndpoint(req.url)) {
    return next(req);
  }

  const token = auth.getAccessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authed).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      // O refresh/logout também passam por aqui sem header (skip acima);
      // um 401 neles não deve gerar outro refresh.
      if (isAuthEndpoint(req.url)) {
        return throwError(() => error);
      }
      if (!auth.hasStoredSession()) {
        auth.clearSession();
        void router.navigate(['/login'], { queryParams: { redirect: router.url } });
        return throwError(() => error);
      }

      if (!refreshInFlight) {
        refreshInFlight = firstValueFrom(auth.refresh())
          .then(() => true)
          .catch(() => {
            auth.clearSession();
            void router.navigate(['/login'], { queryParams: { redirect: router.url } });
            return false;
          })
          .finally(() => {
            refreshInFlight = null;
          });
      }

      return from(refreshInFlight).pipe(
        switchMap((refreshed) => {
          if (!refreshed) {
            return throwError(() => error);
          }
          const retryToken = auth.getAccessToken();
          const retry = retryToken
            ? req.clone({ setHeaders: { Authorization: `Bearer ${retryToken}` } })
            : req;
          return next(retry);
        }),
      );
    }),
  );
};
