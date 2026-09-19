import { DIFFERENTIAL_ATTR, MISSING_VALUE, NONE_VALUE } from './catalog.constants';
import { CatalogTypeDef } from './taxonomy.types';

export interface KeyEvaluation {
  cardKey: string;
  values: Record<string, string>;
  missing: string[];
  newDifferential: string | null;
  complete: boolean;
}

export function normalizeDifferential(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value.length > 0 ? value : null;
}

export function evaluateCardKey(
  type: CatalogTypeDef,
  rawValues: Record<string, unknown>,
  newDifferential: unknown,
): KeyEvaluation {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  const order: string[] = [];
  const nd = normalizeDifferential(newDifferential);

  for (const attr of type.cardKeyAttrs) {
    order.push(attr.attr);
    // Se a LLM mandou um diferencial JÁ permitido em new_differential, ele vale como valor conhecido.
    const raw = rawValues?.[attr.attr] ?? (attr.attr === DIFFERENTIAL_ATTR ? nd : undefined);
    const normalizedRaw = typeof raw === 'string' ? normalizeDifferential(raw) : null;
    const allowedValue = attr.values.find((candidate) =>
      candidate.value === raw || candidate.value === normalizedRaw ||
      (normalizedRaw !== null && (candidate.aliases ?? []).some((alias) => normalizeDifferential(alias) === normalizedRaw)),
    );
    if (allowedValue) {
      values[attr.attr] = allowedValue.value;
    } else if (attr.attr === DIFFERENTIAL_ATTR && nd) {
      values[attr.attr] = nd;
    } else {
      values[attr.attr] = MISSING_VALUE;
      missing.push(attr.attr);
    }
  }
  const hasDifferentialAttr = type.cardKeyAttrs.some((a) => a.attr === DIFFERENTIAL_ATTR);
  const differentialAttr = type.cardKeyAttrs.find((a) => a.attr === DIFFERENTIAL_ATTR);
  const differentialIsNew =
    nd !== null &&
    !(hasDifferentialAttr && differentialAttr?.values.some((value) =>
      value.value === nd || (value.aliases ?? []).some((alias) => normalizeDifferential(alias) === nd),
    ));
  if (nd && !hasDifferentialAttr) {
    order.push(DIFFERENTIAL_ATTR);
    values[DIFFERENTIAL_ATTR] = nd;
  }
  const cardKey = [type.key, ...order.map((attr) => `${attr}=${values[attr]}`)].join('|');
  const newDiff = differentialIsNew ? nd : null;
  return {
    cardKey,
    values,
    missing,
    newDifferential: newDiff,
    complete: missing.length === 0 && newDiff === null,
  };
}

function labelFor(type: CatalogTypeDef, attr: string, value: string): string | null {
  if (!value || value === MISSING_VALUE || value === NONE_VALUE) return null;
  const def = type.cardKeyAttrs.find((a) => a.attr === attr);
  const known = def?.values.find((v) => v.value === value)?.label_pt;
  if (known) return known;
  const human = value.replace(/_/g, ' ');
  return attr === DIFFERENTIAL_ATTR ? `com ${human}` : human;
}

export function cardChipLabels(type: CatalogTypeDef, values: Record<string, string>): string[] {
  const attrs = [
    ...type.cardKeyAttrs.map((a) => a.attr),
    ...Object.keys(values).filter((k) => !type.cardKeyAttrs.some((a) => a.attr === k)),
  ];
  return attrs
    .map((attr) => labelFor(type, attr, values[attr]))
    .filter((label): label is string => label !== null);
}

export function buildCardName(type: CatalogTypeDef, values: Record<string, string>): string {
  return [type.namePt, ...cardChipLabels(type, values)].join(' ');
}
