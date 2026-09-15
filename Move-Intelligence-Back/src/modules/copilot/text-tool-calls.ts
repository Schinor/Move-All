/**
 * P0-3: detector de pseudo-tool-calls em texto.
 *
 * O modelo gratuito (`inclusionai/ling-3.0-flash-fin:free`) não usa o campo
 * `tool_calls` nativo e escreve chamadas em XML dentro de `content`
 * (ex.: `<tool_call>exec <argkey>query</argkey> <argvalue>…`). Módulo PURO.
 */

export interface TextToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface TextToolCallExtraction {
  calls: TextToolCall[];
  cleanText: string;
}

const BLOCK_RE = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call\s*>/gi;
const KEY_RE = /<arg[_-]?key\s*>([\s\S]*?)<\/arg[_-]?key\s*>/gi;
const VALUE_RE = /<arg[_-]?value\s*>([\s\S]*?)<\/arg[_-]?value\s*>/gi;

function coerceValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseInner(inner: string): TextToolCall {
  const trimmed = inner.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const name =
        typeof parsed.name === 'string'
          ? parsed.name
          : typeof (parsed.function as Record<string, unknown> | undefined)?.name === 'string'
            ? String((parsed.function as Record<string, unknown>).name)
            : '';
      const rawArgs =
        (parsed.arguments as unknown) ??
        (parsed.args as unknown) ??
        (parsed.parameters as unknown) ??
        {};
      const args =
        rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};
      return { name: name.trim(), args };
    } catch {
      // Cai no parsing XML abaixo.
    }
  }
  const keys: string[] = [];
  const values: unknown[] = [];
  for (const match of trimmed.matchAll(KEY_RE)) keys.push(match[1].trim());
  for (const match of trimmed.matchAll(VALUE_RE)) values.push(coerceValue(match[1]));
  const withoutArgs = trimmed
    .replace(KEY_RE, ' ')
    .replace(VALUE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = (withoutArgs.split(/\s+/)[0] ?? '').replace(/^["'<(]+|["'>)\]}.,;:]+$/g, '');
  const args: Record<string, unknown> = {};
  keys.forEach((key, index) => {
    if (key) args[key] = index < values.length ? values[index] : '';
  });
  return { name, args };
}

/** Extrai `{ name, args }[]` e o texto limpo (blocos removidos). */
export function extractTextToolCalls(content: string | null | undefined): TextToolCallExtraction {
  if (!content) return { calls: [], cleanText: '' };
  const calls: TextToolCall[] = [];
  const cleanText = content
    .replace(BLOCK_RE, (_block, inner: string) => {
      calls.push(parseInner(inner ?? ''));
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { calls, cleanText };
}

/** Remove blocos `<tool_call>…</tool_call>` remanescentes (sanitização final). */
export function stripTextToolCalls(content: string | null | undefined): string {
  if (!content) return '';
  return content
    .replace(/<tool_call\b[^>]*>[\s\S]*?(<\/tool_call\s*>|$)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
