import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { adminGuard } from './admin.guard';

describe('adminGuard', () => {
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient()] });
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    auth.currentUser.set(null);
  });

  it('libera ADMIN', () => {
    auth.currentUser.set({ id: '1', email: 'a@b.com', name: 'A', company: null, role: 'ADMIN' });
    const result = TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never));
    expect(result).toBe(true);
  });

  it('redireciona USER para a raiz', () => {
    auth.currentUser.set({ id: '1', email: 'a@b.com', name: 'A', company: null, role: 'USER' });
    const result = TestBed.runInInjectionContext(() => adminGuard({} as never, {} as never));
    expect(String(result)).toContain(router.serializeUrl(router.createUrlTree(['/'])));
  });
});
