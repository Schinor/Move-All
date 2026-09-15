/**
 * Classificação por quadrante (B3, decisões 2 e 3).
 *
 * Módulo PURO: regras determinísticas classificam; a IA só explica.
 * - Financeiro bom = faixa verde por padrão (regra quadrant.financialThreshold).
 * - Sem score ou momentum insuficiente → DADOS_INSUFICIENTES (fora da matriz).
 */

import type { MomentumResult } from './momentum';

export type QuadrantAction =
  | 'DECIDIR_AGORA'
  | 'NEGOCIAR_CUSTO'
  | 'TESTAR_DEMANDA'
  | 'IGNORAR'
  | 'DADOS_INSUFICIENTES';

export type ScoreBand = 'green' | 'yellow' | 'red';

export const ACTION_LABEL: Record<QuadrantAction, string> = {
  DECIDIR_AGORA: 'Decidir agora',
  NEGOCIAR_CUSTO: 'Negociar custo',
  TESTAR_DEMANDA: 'Testar demanda',
  IGNORAR: 'Ignorar',
  DADOS_INSUFICIENTES: 'Dados insuficientes',
};

export const ACTION_TOOLTIP: Record<QuadrantAction, string> = {
  DECIDIR_AGORA: 'Tendência em alta e simulação financeira favorável. Validar fornecedor e lote.',
  NEGOCIAR_CUSTO:
    'Tendência em alta, mas o custo atual derruba a viabilidade. Negociar FOB/frete ou buscar outro fornecedor.',
  TESTAR_DEMANDA:
    'Financeiro viável, mas a demanda não está crescendo. Testar com lote pequeno ou monitorar.',
  IGNORAR: 'Sem tendência e sem viabilidade financeira no cenário atual.',
  DADOS_INSUFICIENTES: 'Ainda não há histórico mínimo (4 observações em 21 dias) para decidir.',
};

export function isFinancialGood(
  band: ScoreBand | null | undefined,
  threshold: string = 'green',
): boolean {
  if (!band) return false;
  if (threshold === 'green') return band === 'green';
  if (threshold === 'yellow') return band === 'green' || band === 'yellow';
  return true;
}

export function scoreBandFromScore(
  score: number | null | undefined,
  bands: { green: number; yellow: number } = { green: 70, yellow: 50 },
): ScoreBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score > bands.green) return 'green';
  if (score > bands.yellow) return 'yellow';
  return 'red';
}

export interface QuadrantInput {
  score: number | null | undefined;
  scoreBand: ScoreBand | null | undefined;
  dataConfidence: string | null | undefined;
  momentum: Pick<MomentumResult, 'direction' | 'confidence'>;
  financialThreshold?: string;
}

export function classifyQuadrant(input: QuadrantInput): QuadrantAction {
  const hasScore =
    input.score !== null && input.score !== undefined && Number.isFinite(input.score);
  if (!hasScore || input.dataConfidence !== 'suficiente') {
    return 'DADOS_INSUFICIENTES';
  }
  if (input.momentum.confidence === 'insuficiente') {
    return 'DADOS_INSUFICIENTES';
  }
  const good = isFinancialGood(input.scoreBand ?? null, input.financialThreshold ?? 'green');
  const up = input.momentum.direction === 'sobe';
  if (up && good) return 'DECIDIR_AGORA';
  if (up && !good) return 'NEGOCIAR_CUSTO';
  if (!up && good) return 'TESTAR_DEMANDA';
  return 'IGNORAR';
}
