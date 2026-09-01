import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** Converte recursivamente chaves snake_case (API) para camelCase (models do front). */
export function toCamel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toCamel);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      out[camel] = toCamel(val);
    }
    return out;
  }
  return value;
}

/**
 * Cliente HTTP tipado da API interna. Centraliza baseUrl e a conversão
 * snake_case → camelCase na borda. Componentes nunca chamam HttpClient direto.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, query?: Record<string, string | number | undefined>): Observable<T> {
    let params = new HttpParams();
    if (query) {
      for (const [key, val] of Object.entries(query)) {
        if (val !== undefined && val !== null) {
          params = params.set(key, String(val));
        }
      }
    }
    return this.http
      .get<unknown>(`${this.baseUrl}${path}`, { params })
      .pipe(map((res) => toCamel(res) as T));
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<unknown>(`${this.baseUrl}${path}`, body)
      .pipe(map((res) => toCamel(res) as T));
  }
}
