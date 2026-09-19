import { createHash } from 'crypto';

export const MAX_INPUT_CHARS = 4000;
const SOURCE_SUFFIX = /\s*\([A-Z0-9_]+\)\s*$/;

export function normalizeListingTitle(title: string): string {
  return String(title ?? '').replace(SOURCE_SUFFIX, '').replace(/\s+/g, ' ').trim();
}

export function buildFichaInput(title: string, excerpt?: string | null): string {
  const base = normalizeListingTitle(title);
  const raw = String(excerpt ?? '').trim();
  if (!raw) return base.slice(0, MAX_INPUT_CHARS);
  const rest = raw.startsWith(base) ? raw.slice(base.length).trim() : raw;
  return (rest ? `${base}\n${rest}` : base).slice(0, MAX_INPUT_CHARS);
}

export function inputHash(text: string): string {
  return createHash('sha256').update(text.toLowerCase()).digest('hex');
}
