/**
 * P0-2: parsing robusto da resposta JSON do parecer da IA.
 *
 * Módulo PURO: sem Prisma, sem rede. A resposta vem truncada com frequência
 * (maxTokens), então a extração remove cercas em qualquer posição e recorta
 * do primeiro `{` ao último `}` antes do `JSON.parse`.
 */

export const QUADRANT_ACTIONS = [
  'DECIDIR_AGORA',
  'NEGOCIAR_CUSTO',
  'TESTAR_DEMANDA',
  'IGNORAR',
  'DADOS_INSUFICIENTES',
] as const;

export type QuadrantAction = (typeof QUADRANT_ACTIONS)[number];

export function isQuadrantAction(value: unknown): value is QuadrantAction {
  return (
    typeof value === 'string' &&
    (QUADRANT_ACTIONS as readonly string[]).includes(value)
  );
}

export class JsonExtractionError extends Error {
  readonly reason: 'empty' | 'no_json_found' | 'invalid_json';

  constructor(reason: 'empty' | 'no_json_found' | 'invalid_json') {
    super(reason);
    this.name = 'JsonExtractionError';
    this.reason = reason;
  }
}

/** Remove cercas ```json em qualquer posição e devolve o objeto do primeiro `{` ao último `}`. */
export function extractJsonObject(text: string): unknown {
  if (!text || !text.trim()) {
    throw new JsonExtractionError('empty');
  }
  const withoutFences = text.replace(/```(?:json)?/gi, '');
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new JsonExtractionError('no_json_found');
  }
  const slice = withoutFences.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    throw new JsonExtractionError('invalid_json');
  }
}

export interface ParsedRecommendation {
  action: string | null;
  rationale: string | null;
  key_drivers: string[];
  recommended_next_step: string | null;
}

/** Rationale cru (JSON ou cerca) nunca pode ir para a tela. */
export function isRawRationale(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.startsWith('```') || trimmed.startsWith('{');
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Valida o objeto extraído: ação precisa ser uma das 5; rationale não pode ser cru. */
export function parseRecommendationPayload(payload: unknown): ParsedRecommendation | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const rawAction = record.action ?? record.decision;
  const action =
    typeof rawAction === 'string' && isQuadrantAction(normalizeAction(rawAction))
      ? normalizeAction(rawAction)
      : null;
  const rationale = asNonEmptyString(record.rationale);
  if (!rationale || isRawRationale(rationale)) {
    return null;
  }
  const key_drivers = Array.isArray(record.key_drivers)
    ? record.key_drivers.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const recommended_next_step = asNonEmptyString(record.recommended_next_step);
  return { action, rationale, key_drivers, recommended_next_step };
}

/** Normaliza legado (AVANCAR_…/monitorar) para as 5 ações quando possível. */
export function normalizeAction(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/_/g, ' ');
  if (normalized === 'AVANCAR') return 'DECIDIR_AGORA';
  if (normalized === 'AVANCAR COM RESSALVAS') return 'NEGOCIAR_CUSTO';
  if (normalized === 'REPROVAR') return 'IGNORAR';
  if (normalized === 'SEM SCORE' || normalized === 'MONITORAR') return 'DADOS_INSUFICIENTES';
  return value.trim().toUpperCase();
}

const ACTION_SENTENCE: Record<string, string> = {
  DECIDIR_AGORA: 'Tendência em alta e simulação financeira favorável. Validar fornecedor e lote.',
  NEGOCIAR_CUSTO:
    'Tendência em alta, mas o custo atual derruba a viabilidade. Negociar FOB/frete ou buscar outro fornecedor.',
  TESTAR_DEMANDA:
    'Financeiro viável, mas a demanda não está crescendo. Testar com lote pequeno ou monitorar.',
  IGNORAR: 'Sem tendência e sem viabilidade financeira no cenário atual.',
  DADOS_INSUFICIENTES: 'Ainda não há histórico mínimo (4 observações em 21 dias) para decidir.',
};

const BAND_PT: Record<string, string> = { green: 'verde', yellow: 'amarela', red: 'vermelha' };

/**
 * Texto determinístico de fallback (mesmo padrão do /recommendations/executive):
 * só Move Score, ação das regras e causas do risco — nada inventado.
 */
export function fallbackRationale(params: {
  score: number | null;
  scoreBand?: string | null;
  action: string;
  riskText?: string | null;
}): string {
  const sentence = ACTION_SENTENCE[params.action] ?? 'Acompanhar evolução antes de investir.';
  if (params.score === null || params.score === undefined) {
    return `Sem histórico suficiente para pontuar. ${sentence}`;
  }
  const band = params.scoreBand && BAND_PT[params.scoreBand] ? ` (faixa ${BAND_PT[params.scoreBand]})` : '';
  const risk = params.riskText ? ` ${params.riskText}` : '';
  return `Move Score ${params.score}${band}. ${sentence}${risk}`;
}
