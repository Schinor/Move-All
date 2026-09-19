import { evaluateCardKey, normalizeDifferential } from './card-key';
import { MISSING_VALUE, UNKNOWN_TYPE } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface RawFichaLine {
  ref: string;
  [key: string]: unknown;
}

export interface ValidatedFicha {
  typeKey: string;
  suggestedType: string | null;
  inScope: boolean;
  isAccessoryOrPart: boolean;
  isKitOrBundle: boolean;
  hasVariations: boolean;
  cardKeyValues: Record<string, string>;
  newDifferential: string | null;
  missingKeyAttrs: string[];
  comparisonValues: Record<string, number | boolean | string>;
  variationValues: Record<string, unknown>;
  specs: Record<string, unknown>;
  brand: string | null;
  model: string | null;
  confidence: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function withRef(value: unknown): value is RawFichaLine {
  return !!value && typeof value === 'object' && typeof (value as { ref?: unknown }).ref === 'string';
}

export function parseFichaJsonLines(content: string | null | undefined): RawFichaLine[] {
  const text = String(content ?? '').replace(/```(?:json|jsonl)?/gi, '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(withRef);
    } catch {
      // cai para leitura linha a linha
    }
  }
  // A resposta pode trazer um objeto JSON formatado em várias linhas. Não
  // podemos separar por newline porque `specs`, `comparison_values` etc. são
  // objetos aninhados. Varre objetos de topo e respeita strings JSON.
  const lines: RawFichaLine[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const pushCandidate = (candidate: string) => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (withRef(parsed)) lines.push(parsed);
    } catch {
      // objeto cortado ou inválido: ignorado (o anúncio volta para a fila)
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (start < 0) {
      if (char === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        pushCandidate(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return lines;
}

function snake(value: string): string {
  return normalizeDifferential(value) ?? value;
}

export function validateFicha(line: RawFichaLine, types: Map<string, CatalogTypeDef>): ValidatedFicha {
  const rawType = asText(line.type_key);
  const type = rawType ? types.get(rawType) : undefined;
  const suggestedRaw = asText(line.suggested_type) ?? (rawType && rawType !== UNKNOWN_TYPE ? rawType : null);
  const confidence = typeof line.confidence === 'number' && Number.isFinite(line.confidence)
    ? Math.min(1, Math.max(0, line.confidence))
    : null;
  const base = {
    inScope: line.in_scope !== false,
    isAccessoryOrPart: line.is_accessory_or_part === true,
    isKitOrBundle: line.is_kit_or_bundle === true,
    hasVariations: line.has_variations === true,
    specs: asRecord(line.specs),
    brand: asText(line.brand),
    model: asText(line.model),
    confidence,
  };

  if (!type) {
    return {
      ...base,
      typeKey: UNKNOWN_TYPE,
      suggestedType: suggestedRaw ? snake(suggestedRaw) : null,
      cardKeyValues: {},
      newDifferential: null,
      missingKeyAttrs: [],
      comparisonValues: {},
      variationValues: {},
    };
  }

  const evaluation = evaluateCardKey(type, asRecord(line.card_key_values), line.new_differential);
  const cardKeyValues: Record<string, string> = {};
  for (const [attr, value] of Object.entries(evaluation.values)) {
    if (value !== MISSING_VALUE && value !== evaluation.newDifferential) cardKeyValues[attr] = value;
  }

  const rawComparison = asRecord(line.comparison_values);
  const comparisonValues: Record<string, number | boolean | string> = {};
  for (const def of type.comparisonAttrs) {
    const value = rawComparison[def.attr];
    if (def.kind === 'number') {
      const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
      if (value !== undefined && value !== null && value !== '' && Number.isFinite(n)) comparisonValues[def.attr] = n;
    } else if (def.kind === 'boolean') {
      if (typeof value === 'boolean') comparisonValues[def.attr] = value;
    } else if (typeof value === 'string' && value.trim()) {
      comparisonValues[def.attr] = value.trim();
    }
  }

  const rawVariation = asRecord(line.variation_values);
  const variationValues: Record<string, unknown> = {};
  for (const attr of type.variationAttrs) {
    if (rawVariation[attr] !== undefined && rawVariation[attr] !== null) variationValues[attr] = rawVariation[attr];
  }

  return {
    ...base,
    typeKey: type.key,
    suggestedType: null,
    cardKeyValues,
    newDifferential: evaluation.newDifferential,
    missingKeyAttrs: evaluation.missing,
    comparisonValues,
    variationValues,
  };
}
