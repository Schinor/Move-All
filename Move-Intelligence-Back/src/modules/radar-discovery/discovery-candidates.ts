/** Subprojeto D (spec §5.2): filtro de ruído dos termos em alta do radar. Função pura. */

export interface RisingItem { query: string; value: number; label: string; breakout: boolean }
export interface SnapshotInput { typeKey: string; geo: string; relatedRising: RisingItem[] }
export interface TypeTerms { typeKey: string; pt: string | null; en: string | null }
export interface DiscoveryCandidate {
  typeKey: string;
  geo: string;
  term: string;
  termNorm: string;
  risingValue: number;
  risingLabel: string;
  breakout: boolean;
}

export const MAX_TERMS_PER_SNAPSHOT = 3;

/** Termo com qualquer uma destas palavras é pergunta/conteúdo, não produto: sai. */
export const BLOCK_WORDS = new Set([
  'what', 'is', 'are', 'how', 'why', 'when', 'who', 'which', 'does', 'do', 'can', 'vs', 'versus',
  'benefits', 'benefit', 'beneficios', 'beneficio', 'meaning', 'significado', 'near', 'como', 'que',
  'qual', 'quais', 'serve', 'funciona', 'funcionam', 'calories', 'calorias', 'exercises', 'exercise',
  'exercicios', 'exercicio', 'workout', 'workouts', 'routine', 'rotina', 'plan', 'plano', 'class',
  'classes', 'aula', 'aulas', 'lesson', 'lessons', 'tutorial', 'video', 'videos', 'youtube', 'reddit',
  'wiki', 'definition', 'definicao', 'lunges', 'squats', 'squat', 'curls', 'curl', 'press', 'pushups',
  'results', 'resultados', 'before', 'after', 'antes', 'depois', 'diet', 'dieta', 'loss', 'emagrecer',
  'emagrece', 'best', 'melhor', 'melhores', 'review', 'reviews', 'top',
]);

/** Palavras que não contam na comparação com o vocabulário do tipo. */
export const GENERIC_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'the', 'for', 'with', 'and', 'of', 'me',
  'buy', 'price', 'preco', 'cheap', 'barato', 'used', 'usado', 'amazon', 'machine', 'maquina', 'aparelho',
  'equipment', 'equipamento', 'set', 'kit', 'fitness', 'gym', 'academia', 'home', 'casa',
]);

export function normalizeTerm(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countingWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizeTerm(text).split(' ')) {
    if (word.length < 3 || GENERIC_WORDS.has(word)) continue;
    out.add(word);
    if (word.endsWith('s')) out.add(word.slice(0, -1));
  }
  return out;
}

export function buildDiscoveryCandidates(snapshots: SnapshotInput[], types: TypeTerms[]): DiscoveryCandidate[] {
  const vocab = new Map(
    types.map((t) => [t.typeKey, new Set([...countingWords(t.pt ?? ''), ...countingWords(t.en ?? '')])]),
  );
  const radarTerms = new Set(
    types.flatMap((t) => [t.pt, t.en]).filter((v): v is string => !!v).map(normalizeTerm),
  );
  const best = new Map<string, DiscoveryCandidate>();

  for (const snapshot of snapshots) {
    const words = vocab.get(snapshot.typeKey);
    if (!words || words.size === 0) continue;
    const kept: DiscoveryCandidate[] = [];
    for (const item of snapshot.relatedRising ?? []) {
      const query = String(item?.query ?? '').trim();
      const termNorm = normalizeTerm(query);
      if (!termNorm) continue;
      if (termNorm.split(' ').some((word) => BLOCK_WORDS.has(word))) continue;
      if (radarTerms.has(termNorm)) continue;
      if (![...countingWords(query)].some((word) => words.has(word))) continue;
      kept.push({
        typeKey: snapshot.typeKey,
        geo: snapshot.geo,
        term: query,
        termNorm,
        risingValue: Number(item.value) || 0,
        risingLabel: String(item.label ?? ''),
        breakout: item.breakout === true,
      });
    }
    kept.sort((a, b) => b.risingValue - a.risingValue || a.termNorm.localeCompare(b.termNorm));
    for (const candidate of kept.slice(0, MAX_TERMS_PER_SNAPSHOT)) {
      const key = `${candidate.geo}::${candidate.termNorm}`;
      const previous = best.get(key);
      if (!previous || candidate.risingValue > previous.risingValue) best.set(key, candidate);
    }
  }
  return [...best.values()];
}
