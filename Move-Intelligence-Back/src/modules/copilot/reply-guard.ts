/**
 * Guarda da resposta final do Copilot: o modelo às vezes termina anunciando
 * uma ação ("Vou ampliar a busca…") sem ter chamado ferramenta nenhuma, e a
 * conversa para ali. Módulo PURO.
 */
import { stripTextToolCalls } from './text-tool-calls';

/** Radicais de verbos de consulta (buscar, busco, buscando, consultar, ampliar…). */
const ACTION_STEMS =
  'ampli|busc|consult|verific|procur|pesquis|chec|levant|refaz|expand|investig|analis|filtr|tent';
const PROMISE_RE = new RegExp(
  `\\b(?:vou|irei|iremos|vamos|deixe-me|deixa eu|permita-me)\\s+(?:\\S+\\s+){0,4}?(?:${ACTION_STEMS})\\w*`,
  'i',
);
const WAIT_RE = /\b(?:um momento|um instante|s[oó] um instante|aguarde)\b/i;
/** Oferta condicional não é promessa ("Se quiser, vou buscar os fornecedores."). */
const CONDITIONAL_RE =
  /\b(?:se (?:quiser|preferir|desejar|precisar)|caso (?:queira|prefira|deseje|precise))\b/i;

/** Cobrança enviada ao modelo quando ele promete sem chamar ferramenta. */
export const PROMISE_NUDGE =
  'Você anunciou uma nova consulta, mas não chamou nenhuma ferramenta. Chame AGORA a ferramenta necessária (por exemplo, search_products com termos mais amplos, o tipo de equipamento ou a categoria) ou responda apenas com o que já foi obtido. Nunca anuncie ações futuras.';

/** Resposta honesta quando só havia a promessa. */
export const PROMISE_FALLBACK_EMPTY =
  'Não encontrei produtos para essa busca no catálogo atual. Tente citar o tipo de equipamento (ex.: bicicleta, step, elástico) ou peça o ranking de uma categoria.';

/** Complemento quando havia conteúdo útil antes da promessa. */
export const PROMISE_FALLBACK_SUFFIX =
  'Não consegui ampliar a busca agora. Tente citar o tipo de equipamento (ex.: bicicleta, step, elástico) ou peça o ranking de uma categoria.';

function lastSentence(text: string): string {
  const parts = text
    .trim()
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1) ?? '';
}

function isPromiseSentence(sentence: string): boolean {
  if (!sentence) return false;
  return (PROMISE_RE.test(sentence) || WAIT_RE.test(sentence)) && !CONDITIONAL_RE.test(sentence);
}

/** A última frase anuncia uma consulta/espera que não aconteceu. */
export function hasUnfulfilledPromise(text: string | null | undefined): boolean {
  return isPromiseSentence(lastSentence(text ?? ''));
}

/** Remove as frases finais de promessa (até 3). */
export function removeTrailingPromise(text: string | null | undefined): string {
  let current = (text ?? '').trim();
  for (let i = 0; i < 3; i++) {
    const sentence = lastSentence(current);
    if (!isPromiseSentence(sentence)) break;
    current = current.slice(0, current.lastIndexOf(sentence)).trim();
  }
  return current;
}

/** Sanitiza a resposta final: sem markup de ferramenta e sem terminar em promessa. */
export function finalizeReply(text: string | null | undefined): string {
  const cleaned = stripTextToolCalls(text);
  if (!hasUnfulfilledPromise(cleaned)) return cleaned;
  const rest = removeTrailingPromise(cleaned);
  return rest ? `${rest}\n\n${PROMISE_FALLBACK_SUFFIX}` : PROMISE_FALLBACK_EMPTY;
}

/** Quebra a resposta pronta em pedaços para o stream (a junção é o texto original). */
export function chunkReply(text: string, size = 48): string[] {
  const parts = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current && current.length + part.length > size) {
      chunks.push(current);
      current = '';
    }
    current += part;
  }
  if (current) chunks.push(current);
  return chunks;
}
