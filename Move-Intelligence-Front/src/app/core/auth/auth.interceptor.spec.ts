import { HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Sem storage no ambiente de teste: os testes de header usam memória.
    }
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    httpMock.verify();
    try {
      window.localStorage.clear();
    } catch {
      // Ignora falhas de storage.
    }
    vi.restoreAllMocks();
  });

  it('adiciona Authorization nas chamadas à API', () => {
    try {
      window.localStorage.setItem('move:access-token', 'access-123');
    } catch {
      // Se o storage falhar, o teste perde o sentido — falha explícita.
      throw new Error('localStorage indisponível para o teste');
    }

    http.get('/api/trends/products').subscribe();
    const req = httpMock.expectOne('/api/trends/products');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-123');
    req.flush([]);
  });

  it('pula /auth/login, /auth/register e /auth/refresh', () => {
    try {
      window.localStorage.setItem('move:access-token', 'access-123');
    } catch {
      throw new Error('localStorage indisponível para o teste');
    }

    for (const path of ['/api/auth/login', '/api/auth/register', '/api/auth/refresh']) {
      http.post(path, {}).subscribe({ error: () => undefined });
      const req = httpMock.expectOne(path);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });

  it('em 401, faz um único refresh (single-flight) e refaz as requisições', async () => {
    try {
      window.localStorage.setItem('move:access-token', 'expired');
      window.localStorage.setItem('move:refresh-token', 'refresh-123');
    } catch {
      throw new Error('localStorage indisponível para o teste');
    }
    const refreshSpy = vi.spyOn(auth, 'refresh').mockImplementation(() => {
      try {
        window.localStorage.setItem('move:access-token', 'fresh');
        window.localStorage.setItem('move:refresh-token', 'refresh-456');
      } catch {
        // Ignora falhas de storage no mock.
      }
      auth.currentUser.set({ id: '1', email: 'a@b.com', name: 'A', company: null, role: 'USER' });
      return new Observable((subscriber) => {
        subscriber.next({
          user: { id: '1', email: 'a@b.com', name: 'A', company: null, role: 'USER' },
          accessToken: 'fresh',
          refreshToken: 'refresh-456',
        });
        subscriber.complete();
      }) as never;
    });

    const results: unknown[] = [];
    http.get('/api/ranking-a').subscribe((res) => results.push(res));
    http.get('/api/ranking-b').subscribe((res) => results.push(res));

    const first = httpMock.expectOne('/api/ranking-a');
    const second = httpMock.expectOne('/api/ranking-b');
    expect(first.request.headers.get('Authorization')).toBe('Bearer expired');
    first.flush(null, { status: 401, statusText: 'Unauthorized' });
    second.flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // O refresh (firstValueFrom) resolve em microtask; aguarda o retry ser emitido.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const retryA = httpMock.expectOne('/api/ranking-a');
    const retryB = httpMock.expectOne('/api/ranking-b');
    expect(retryA.request.headers.get('Authorization')).toBe('Bearer fresh');
    expect(retryB.request.headers.get('Authorization')).toBe('Bearer fresh');
    retryA.flush({ ok: true });
    retryB.flush({ ok: true });

    expect(results).toEqual([{ ok: true }, { ok: true }]);
  });
});
