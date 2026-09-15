import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { authGuard } from './auth.guard';

function snapshot(url: string): { route: ActivatedRouteSnapshot; state: RouterStateSnapshot } {
  return {
    route: {} as ActivatedRouteSnapshot,
    state: { url } as RouterStateSnapshot,
  };
}

async function runGuard(url: string): Promise<unknown> {
  const { route, state } = snapshot(url);
  const result = TestBed.runInInjectionContext(() => authGuard(route, state));
  return isObservable(result) ? firstValueFrom(result) : result;
}

describe('authGuard', () => {
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Sem storage: os testes usam o estado em memória do serviço.
    }
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    auth.currentUser.set(null);
  });

  afterEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Ignora falhas de storage.
    }
    vi.restoreAllMocks();
  });

  it('sem sessão, redireciona para /login?redirect=<url>', async () => {
    const result = await runGuard('/ranking');
    expect(String(result)).toContain('/login');
    expect(String(result)).toContain('redirect');
  });

  it('com usuário autenticado, libera a rota', async () => {
    auth.currentUser.set({ id: '1', email: 'a@b.com', name: 'A', company: null, role: 'USER' });
    expect(await runGuard('/ranking')).toBe(true);
  });

  it('com refresh guardado, tenta loadMe e libera em caso de sucesso', async () => {
    try {
      window.localStorage.setItem('move:refresh-token', 'refresh-123');
    } catch {
      throw new Error('localStorage indisponível para o teste');
    }
    vi.spyOn(auth, 'loadMe').mockImplementation(() => {
      auth.currentUser.set({ id: '1', email: 'a@b.com', name: 'A', company: null, role: 'USER' });
      return of(auth.currentUser()!);
    });

    expect(await runGuard('/sourcing')).toBe(true);
  });

  it('com loadMe falhando, redireciona para /login', async () => {
    try {
      window.localStorage.setItem('move:refresh-token', 'refresh-123');
    } catch {
      throw new Error('localStorage indisponível para o teste');
    }
    vi.spyOn(auth, 'loadMe').mockReturnValue(throwError(() => new Error('401')));

    const result = await runGuard('/sourcing');
    expect(String(result)).toContain('/login');
    expect(router.url).toBeDefined();
  });
});
