/** Formata número como moeda BRL compacta (ex.: R$ 1,2M). */
export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export const STAGE_LABEL: Record<string, string> = {
  emerging: 'Emergente',
  rising: 'Em ascensão',
  peaking: 'Em pico',
  mainstream: 'Mainstream',
};

/**
 * Converte slugs vindos da API (categorias, fontes de premissa) em texto legível.
 * O backend entrega `musculacao_pesos_livres` e `derived_default`; a interface
 * não deve expor nomenclatura interna ao usuário.
 */
export function humanizeSlug(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Categorias do catálogo em português correto. O slug da API não carrega
 * acentuação, então humanizeSlug sozinho devolveria "Musculacao pesos livres".
 */
export const CATEGORY_LABEL: Record<string, string> = {
  musculacao_pesos_livres: 'Musculação e pesos livres',
  cardio_fitness: 'Cardio e fitness',
  treino_funcional_crossfit: 'Treino funcional e CrossFit',
  calistenia_peso_corporal: 'Calistenia e peso corporal',
  pilates_yoga_mobilidade: 'Pilates, yoga e mobilidade',
  recuperacao_fisioterapia: 'Recuperação e fisioterapia',
};

export function categoryLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CATEGORY_LABEL[value] ?? humanizeSlug(value);
}

/** Origem de cada premissa da simulação, em português. */
export const PREMISE_SOURCE_LABEL: Record<string, string> = {
  default: 'Padrão do modelo',
  derived_default: 'Derivado dos dados',
  csv: 'Base coletada',
  ai_suggestion: 'Sugerido pela IA',
};

export function premiseSourceLabel(value: string | null | undefined): string {
  if (!value) return PREMISE_SOURCE_LABEL['default'];
  return PREMISE_SOURCE_LABEL[value] ?? humanizeSlug(value);
}

/** Faixas configuráveis do Move Score (B1, decisão 5): verde > 70, amarelo 50–70, vermelho ≤ 50. */
export const MOVE_SCORE_GREEN = 70;
export const MOVE_SCORE_YELLOW = 50;
/** Legados F2.6 (85/70) — mantidos para compat até D6 remover o vocabulário. */
export const MOVE_SCORE_ADVANCE = MOVE_SCORE_GREEN;
export const MOVE_SCORE_CONSIDER = MOVE_SCORE_YELLOW;

export type ScoreBand = 'green' | 'yellow' | 'red';

/** Faixa pronta vem da API (score_band); fallback local só quando ausente. */
export function scoreBandFor(score: number | null | undefined): ScoreBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score > MOVE_SCORE_GREEN) return 'green';
  if (score > MOVE_SCORE_YELLOW) return 'yellow';
  return 'red';
}

/** Rótulo da faixa em português (a API envia green/yellow/red). */
export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  green: 'Verde',
  yellow: 'Amarela',
  red: 'Vermelha',
};

export function scoreBandLabel(value: string | null | undefined): string {
  if (!value) return '';
  return SCORE_BAND_LABEL[value as ScoreBand] ?? value;
}

/** Decisão legada (AVANCAR/RESSALVAS/REPROVAR) — D6 substitui pelas 5 ações; mantida só para histórico. */
export const DECISION_LABEL: Record<string, string> = {
  AVANCAR: 'Avançar',
  'AVANCAR COM RESSALVAS': 'Avançar com ressalvas',
  REPROVAR: 'Reprovar',
  SEM_SCORE: 'Sem score',
};

export function decisionLabel(value: string | null | undefined): string {
  if (!value) return '';
  // D6: 5 ações primeiro; legado só como fallback.
  return actionLabel(value) || DECISION_LABEL[value] || value;
}

/** Ações por quadrante (B3, decisões 2-3): regras classificam, IA explica. */
export const ACTION_LABEL: Record<string, string> = {
  DECIDIR_AGORA: 'Decidir agora',
  NEGOCIAR_CUSTO: 'Negociar custo',
  TESTAR_DEMANDA: 'Testar demanda',
  IGNORAR: 'Ignorar',
  DADOS_INSUFICIENTES: 'Dados insuficientes',
};

export const ACTION_TOOLTIP: Record<string, string> = {
  DECIDIR_AGORA: 'Tendência em alta e simulação financeira favorável. Validar fornecedor e lote.',
  NEGOCIAR_CUSTO:
    'Tendência em alta, mas o custo atual derruba a viabilidade. Negociar FOB/frete ou buscar outro fornecedor.',
  TESTAR_DEMANDA:
    'Financeiro viável, mas a demanda não está crescendo. Testar com lote pequeno ou monitorar.',
  IGNORAR: 'Sem tendência e sem viabilidade financeira no cenário atual.',
  DADOS_INSUFICIENTES: 'Ainda não há histórico mínimo (4 observações em 21 dias) para decidir.',
};

export function actionLabel(value: string | null | undefined): string {
  if (!value) return '';
  return ACTION_LABEL[value] ?? '';
}

export function actionTooltip(value: string | null | undefined): string {
  if (!value) return '';
  return ACTION_TOOLTIP[value] ?? '';
}

/** Momentum (B2/D1): seta sem nota 0–100. */
export function momentumArrow(direction: string | null | undefined): string {
  if (direction === 'sobe') return '↑';
  if (direction === 'cai') return '↓';
  return '→';
}

export function momentumLabel(direction: string | null | undefined): string {
  if (direction === 'sobe') return 'em alta';
  if (direction === 'cai') return 'em queda';
  if (direction === 'estavel') return 'estável';
  return '—';
}

/** Confiança dos dados em português. Sem score, mostra o rótulo, sem número. */
export const DATA_CONFIDENCE_LABEL: Record<string, string> = {
  suficiente: 'Dados suficientes',
  historico_curto: 'Histórico curto',
  sem_vendas: 'Sem vendas observadas',
  sem_custo: 'Sem custo observável',
};

export function dataConfidenceLabel(value: string | null | undefined): string {
  if (!value) return 'Sem score';
  return DATA_CONFIDENCE_LABEL[value] ?? humanizeSlug(value);
}

/** Nome comercial das fontes de coleta. O slug interno não deve vazar para a tela. */
export const SOURCE_LABEL: Record<string, string> = {
  '1688': '1688',
  alibaba: 'Alibaba',
  aliexpress: 'AliExpress',
  amazon: 'Amazon',
  amazon_br: 'Amazon BR',
  douyin: 'Douyin',
  google_shopping: 'Google Shopping',
  google_trends: 'Google Trends',
  mercado_livre: 'Mercado Livre',
  mercadolivre: 'Mercado Livre',
  shopee_br: 'Shopee BR',
  tiktok_shop: 'TikTok Shop',
  tradeatlas: 'TradeAtlas',
  xiaohongshu: 'Xiaohongshu',
};

export function sourceLabel(value: string | null | undefined): string {
  if (!value) return '';
  return SOURCE_LABEL[value] ?? humanizeSlug(value);
}

/** Sinal social (B6, decisão 11): nunca nota baixa por falta de coleta. */
export const SOCIAL_UNAVAILABLE_LABEL = 'Sinal social indisponível';

export function socialSignalLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return SOCIAL_UNAVAILABLE_LABEL;
  return `${value >= 0 ? '+' : ''}${value}%`;
}
