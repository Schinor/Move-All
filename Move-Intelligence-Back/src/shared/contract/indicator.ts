/**
 * Envelope de explicabilidade do contrato (docs/contract/openapi.yaml).
 * Todo indicador sensível é entregue como { value, explanation, inputs, window }.
 * Campos ainda não computados vêm null — nunca omitidos.
 */
export interface Indicator {
  value: number | null;
  explanation: string | null;
  inputs: Record<string, number> | null;
  window: string | null;
}

export function indicator(
  value: number | null,
  explanation: string | null = null,
  inputs: Record<string, number> | null = null,
  window: string | null = null,
): Indicator {
  return { value, explanation, inputs, window };
}

/** Indicador ainda não calculado pelo backend (estrutura pronta, valor pendente). */
export function pendingIndicator(): Indicator {
  return { value: null, explanation: null, inputs: null, window: null };
}

/** Estado de cálculo de um bloco cujo motor pode ainda não existir. */
export type BlockStatus = 'computed' | 'pending' | 'not_available';

export interface Block<T> {
  status: BlockStatus;
  items: T[];
}

export function block<T>(items: T[], status: BlockStatus = 'computed'): Block<T> {
  return { status, items };
}

/** Bloco pendente (motor ainda não implementado) — o frontend mostra estado vazio. */
export function pendingBlock<T>(): Block<T> {
  return { status: 'pending', items: [] as T[] };
}
