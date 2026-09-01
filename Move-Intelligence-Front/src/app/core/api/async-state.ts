import { signal, Signal } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Estado padronizado de toda leitura de dados no frontend.
 * Nenhum indicador é renderizado fora de um destes estados.
 */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T };

/** Considera vazio: null/undefined, array vazio, ou bloco com status pending/not_available. */
function defaultIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object') {
    const block = value as { status?: string; items?: unknown[] };
    if (block.status === 'pending' || block.status === 'not_available') {
      return true;
    }
    if (Array.isArray(block.items) && block.items.length === 0 && block.status !== 'computed') {
      return true;
    }
  }
  return false;
}

function normalizeError(err: unknown): string {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 501) {
      return 'Dados ainda não disponíveis para esta tela.';
    }
    if (status === 0) {
      return 'Sem conexão com o servidor.';
    }
  }
  return 'Não foi possível carregar os dados. Tente novamente.';
}

/**
 * Converte um Observable numa Signal<AsyncState<T>>, aplicando a regra de
 * vazio/pending. Erros 404/501 (motor ainda inexistente) viram estado `empty`,
 * não `error`, para as telas-lacuna não quebrarem.
 */
export function toAsyncState<T>(
  source$: Observable<T>,
  isEmpty: (v: T) => boolean = defaultIsEmpty,
): Signal<AsyncState<T>> {
  const state = signal<AsyncState<T>>({ status: 'loading' });
  source$.subscribe({
    next: (data) => state.set(isEmpty(data) ? { status: 'empty' } : { status: 'ready', data }),
    error: (err) => {
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 501) {
        state.set({ status: 'empty' });
      } else {
        state.set({ status: 'error', error: normalizeError(err) });
      }
    },
  });
  return state;
}
