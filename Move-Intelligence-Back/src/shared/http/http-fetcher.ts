import { Injectable, Logger } from '@nestjs/common';

export interface FetchOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface FetchResult<T> {
  status: number;
  body: T;
}

/**
 * Cliente HTTP compartilhado pelos conectores. Implementa os "Cuidados técnicos"
 * do plano: timeout, retries com backoff exponencial apenas para 429/5xx.
 * Usa o fetch global (Node 18+). O corpo bruto é preservado pela ingestion.
 */
@Injectable()
export class HttpFetcher {
  private readonly logger = new Logger(HttpFetcher.name);

  async getJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<FetchResult<T>> {
    const { headers = {}, query, timeoutMs = 15000, maxRetries = 3 } = options;
    const finalUrl = this.withQuery(url, query);

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(finalUrl, {
          headers: { accept: 'application/json', ...headers },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (this.isRetryable(response.status) && attempt < maxRetries) {
          await this.backoff(attempt);
          attempt += 1;
          continue;
        }

        const body = (await response.json().catch(() => ({}))) as T;
        return { status: response.status, body };
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < maxRetries) {
          await this.backoff(attempt);
          attempt += 1;
          continue;
        }
        break;
      }
    }

    this.logger.warn(`getJson failed after ${maxRetries + 1} attempts: ${finalUrl}`);
    throw lastError instanceof Error ? lastError : new Error(`Request failed: ${finalUrl}`);
  }

  private isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(1000 * 2 ** attempt, 8000);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  private withQuery(url: string, query?: Record<string, string | number | undefined>): string {
    if (!query) {
      return url;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
  }
}
