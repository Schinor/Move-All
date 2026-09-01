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
