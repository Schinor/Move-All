import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Usuário autenticado (formato de GET /auth/me). */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  company: string | null;
  role: string;
}

/** Sessão retornada por login/register/refresh (nomes exatos do backend). */
interface AuthSessionResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

const ACCESS_TOKEN_KEY = 'move:access-token';
const REFRESH_TOKEN_KEY = 'move:refresh-token';

/**
 * Sessão de autenticação. Usa HttpBackend (sem interceptors) de propósito:
 * o interceptor de auth depende deste serviço, então passar pelo ApiClient
 * criaria uma dependência circular HttpClient -> interceptor -> AuthService.
 * Tokens ficam no localStorage com leitura/escrita em try/catch
 * (mesmo padrão de ThemeService).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http: HttpClient;

  /** Usuário carregado via /auth/me (null = sem sessão válida conhecida). */
  readonly currentUser = signal<AuthUser | null>(null);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  constructor() {
    const backend = inject(HttpBackend);
    this.http = new HttpClient(backend);
  }

  /** Token de acesso atual (para o interceptor e o streaming do copilot). */
  getAccessToken(): string | null {
    try {
      return window.localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  /** Há refresh token guardado (usado pelo guard para tentar restaurar a sessão). */
  hasStoredSession(): boolean {
    try {
      return Boolean(window.localStorage.getItem(REFRESH_TOKEN_KEY));
    } catch {
      return false;
    }
  }

  login(email: string, password: string): Observable<AuthSessionResponse> {
    return this.http
      .post<AuthSessionResponse>(`${environment.apiBaseUrl}/auth/login`, { email, password })
      .pipe(tap((session) => this.persistSession(session)));
  }

  register(name: string, email: string, password: string, company?: string): Observable<AuthSessionResponse> {
    return this.http
      .post<AuthSessionResponse>(`${environment.apiBaseUrl}/auth/register`, {
        name,
        email,
        password,
        ...(company?.trim() ? { company: company.trim() } : {}),
      })
      .pipe(tap((session) => this.persistSession(session)));
  }

  refresh(): Observable<AuthSessionResponse> {
    const refreshToken = this.readRefreshToken();
    return this.http
      .post<AuthSessionResponse>(`${environment.apiBaseUrl}/auth/refresh`, { refreshToken })
      .pipe(tap((session) => this.persistSession(session)));
  }

  loadMe(): Observable<AuthUser> {
    return this.http
      .get<AuthUser>(`${environment.apiBaseUrl}/auth/me`, { headers: this.authHeaders() })
      .pipe(tap((user) => this.currentUser.set(user)));
  }

  logout(): Observable<unknown> {
    const refreshToken = this.readRefreshToken();
    const request =
      refreshToken && this.getAccessToken()
        ? this.http.post(`${environment.apiBaseUrl}/auth/logout`, { refreshToken }, { headers: this.authHeaders() })
        : new Observable((subscriber) => {
            subscriber.next({ success: true });
            subscriber.complete();
          });
    return request.pipe(tap(() => this.clearSession()));
  }

  /** Limpa a sessão local sem chamar a API (usado após refresh inválido). */
  clearSession(): void {
    try {
      window.localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // A sessão em memória continua sendo limpa mesmo sem storage.
    }
    this.currentUser.set(null);
  }

  private persistSession(session: AuthSessionResponse): void {
    try {
      window.localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
      window.localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
    } catch {
      // Tokens continuam válidos em memória nesta sessão via currentUser.
    }
    this.currentUser.set(session.user);
  }

  private readRefreshToken(): string | null {
    try {
      return window.localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private authHeaders(): Record<string, string> {
    const token = this.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
