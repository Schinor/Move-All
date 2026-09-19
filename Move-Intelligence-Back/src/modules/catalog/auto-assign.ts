import { AutoAssignConfig } from './catalog.constants';

export interface Candidate {
  clusterId: string;
  similarity: number;
  countedItems: number;
}

export type AutoDecision =
  | { kind: 'assign'; clusterId: string; rule: 'single_candidate' | 'best_similarity' }
  | { kind: 'review'; reason: string };

const MISSING_SPEC_REASON = 'falta a especificação';

/** Camadas 1 e 2. Os candidatos já vêm filtrados por tipo, card ativo e especificações compatíveis. */
export function decideMissingSpec(candidates: Candidate[], cfg: AutoAssignConfig): AutoDecision {
  if (!cfg.enabled || candidates.length === 0) {
    return { kind: 'review', reason: MISSING_SPEC_REASON };
  }

  if (candidates.length === 1) {
    const [candidate] = candidates;
    return candidate.countedItems >= 1
      ? { kind: 'assign', clusterId: candidate.clusterId, rule: 'single_candidate' }
      : { kind: 'review', reason: MISSING_SPEC_REASON };
  }

  const ordered = [...candidates].sort((a, b) =>
    b.similarity - a.similarity || a.clusterId.localeCompare(b.clusterId),
  );
  const [best, second] = ordered;
  const margin = best.similarity - second.similarity;
  const marginTolerance = Number.EPSILON * Math.max(1, Math.abs(margin), Math.abs(cfg.minMargin)) * 8;
  if (best.similarity >= cfg.minSimilarity && margin + marginTolerance >= cfg.minMargin) {
    return { kind: 'assign', clusterId: best.clusterId, rule: 'best_similarity' };
  }

  return { kind: 'review', reason: `empate entre cards: ${ordered.map((candidate) => candidate.clusterId).join(', ')}` };
}
