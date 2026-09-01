/** Utilidades de normalização compartilhadas pelos parsers. */

/** Remove o BOM (U+FEFF) do início do conteúdo, se presente. */
export function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Converte um texto numérico para número, tolerando separador de milhar por
 * vírgula (ex.: "47,980.00" → 47980) e ponto decimal. Retorna `null` para
 * valores vazios/inválidos.
 */
export function parseNumeric(value: string | undefined | null): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const cleaned = value.trim().replace(/,/g, '');
  if (cleaned === '') {
    return null;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza um decimal para string com 2 casas, pronta para o Prisma.
 * Retorna `null` quando o valor não é numérico.
 */
export function toDecimalString(
  value: string | undefined | null,
): string | null {
  const n = parseNumeric(value);
  return n === null ? null : n.toFixed(2);
}

/** Converte uma data no formato `dd-mm-yyyy` para `Date` (UTC). */
export function parseDmyDate(value: string | undefined | null): Date | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!match) {
    return null;
  }
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Converte "8.0" / "8" para inteiro; retorna `null` se não for numérico. */
export function parseItemNo(value: string | undefined | null): number | null {
  const n = parseNumeric(value);
  return n === null ? null : Math.trunc(n);
}

/** Trima e retorna `null` para strings vazias. */
export function nullableTrim(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Divide o conteúdo em linhas, tolerando `\r\n` e `\r`. */
export function splitLines(content: string): string[] {
  return content.split(/\r\n|\r|\n/);
}
