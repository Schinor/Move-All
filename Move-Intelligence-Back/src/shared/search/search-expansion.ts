/**
 * Busca de produtos do Copilot que entende a intenção (grupo muscular,
 * objetivo) e não só o nome literal. Módulo PURO: sem Prisma.
 *
 * Ex.: "Tem algum produto para as pernas?" não bate com nenhum nome de
 * produto, mas vira bicicleta, step, caneleira, mini band… e as categorias
 * correspondentes.
 */

export interface SearchExpansion {
  /** Palavras relevantes da pergunta (sem acento, sem palavras vazias, no singular). */
  tokens: string[];
  /** Termos de nome de produto sugeridos pelos tópicos reconhecidos. */
  terms: string[];
  /** Categorias (slugs do catálogo) sugeridas pelos tópicos reconhecidos. */
  categories: string[];
  /** Tópicos reconhecidos (ex.: "perna", "cardio"). */
  topics: string[];
  /** Rótulos dos tópicos reconhecidos (ex.: "Pernas"). */
  labels: string[];
}

interface Topic {
  /** Rótulo exibido na busca (ex.: "Pernas"). */
  label: string;
  keys: string[];
  terms: string[];
  categories: string[];
}

const STOPWORDS = new Set([
  'tem', 'temos', 'ter', 'algum', 'alguma', 'alguns', 'algumas', 'algo', 'produto', 'produtos',
  'item', 'itens', 'equipamento', 'equipamentos', 'aparelho', 'aparelhos', 'para', 'pra', 'pro',
  'pras', 'pros', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'com', 'sem', 'um', 'uma', 'uns',
  'umas', 'me', 'mostre', 'mostra', 'mostrar', 'quero', 'queria', 'preciso', 'qual', 'quais',
  'que', 'no', 'na', 'nos', 'nas', 'em', 'por', 'sobre', 'treino', 'treinar', 'treinos',
  'exercicio', 'exercicios', 'academia', 'casa', 'voce', 'voces', 'existe', 'existem', 'ha',
  'bom', 'boa', 'bons', 'boas', 'melhor', 'melhores', 'ideal', 'indicado', 'indicados',
  'recomenda', 'recomendado', 'recomendados', 'catalogo', 'fitness', 'busque', 'buscar',
  'procure', 'procurar', 'encontre', 'encontrar', 'liste', 'listar', 'ver', 'veja',
]);

const TOPICS: Topic[] = [
  {
    label: 'Pernas',
    keys: ['perna', 'pernas', 'coxa', 'coxas', 'quadriceps', 'posterior de coxa', 'panturrilha', 'panturrilhas', 'membros inferiores'],
    terms: ['agachamento', 'leg', 'step', 'caneleira', 'stepper', 'bicicleta', 'bike', 'spinning', 'mini band', 'elástico', 'elastico', 'plataforma vibratória', 'plataforma vibratoria', 'corda'],
    categories: ['spinning_bike', 'compact_cardio', 'vibration_plate', 'resistance_bands', 'jump_rope', 'ankle_weights'],
  },
  {
    label: 'Glúteos',
    keys: ['gluteo', 'gluteos', 'bumbum', 'quadril'],
    terms: ['agachamento', 'mini band', 'elástico', 'elastico', 'step', 'caneleira'],
    categories: ['resistance_bands', 'ankle_weights'],
  },
  {
    label: 'Braços',
    keys: ['braco', 'bracos', 'biceps', 'triceps', 'ombro', 'ombros', 'antebraco', 'antebracos'],
    terms: ['haltere', 'halter', 'kettlebell', 'anilha', 'barra', 'elástico', 'elastico'],
    categories: ['dumbbells', 'kettlebells', 'resistance_bands'],
  },
  {
    label: 'Peito',
    keys: ['peito', 'peitoral', 'supino'],
    terms: ['banco', 'supino', 'flexão', 'flexao', 'push up', 'anilha'],
    categories: ['weight_bench', 'push_up_equipment'],
  },
  {
    label: 'Costas',
    keys: ['costas', 'dorsal', 'dorsais', 'lombar'],
    terms: ['barra fixa', 'remo', 'puxada'],
    categories: ['pull_up_equipment', 'rowing_machine'],
  },
  {
    label: 'Abdômen',
    keys: ['abdomen', 'abdominal', 'abdominais', 'core', 'barriga', 'prancha'],
    terms: ['abdominal', 'roda', 'prancha'],
    categories: ['ab_wheel'],
  },
  {
    label: 'Cardio',
    keys: ['cardio', 'aerobico', 'aerobicos', 'emagrecer', 'emagrecimento', 'queimar', 'condicionamento'],
    terms: ['esteira', 'bicicleta', 'bike', 'spinning', 'corda', 'remo', 'walking pad', 'elíptico', 'eliptico'],
    categories: ['compact_cardio', 'spinning_bike', 'rowing_machine', 'jump_rope'],
  },
  {
    label: 'Alongamento',
    keys: ['alongamento', 'alongar', 'flexibilidade', 'mobilidade', 'yoga', 'pilates', 'postura'],
    terms: ['yoga', 'tapete', 'pilates', 'reformer', 'rolo'],
    categories: ['yoga_mat', 'yoga_pilates'],
  },
  {
    label: 'Recuperação',
    keys: ['recuperacao', 'massagem', 'dor', 'dores', 'liberacao', 'relaxar', 'fisioterapia'],
    terms: ['massagem', 'massageador', 'rolo', 'liberação', 'liberacao'],
    categories: ['recovery_massage'],
  },
  {
    label: 'Força',
    keys: ['forca', 'musculacao', 'hipertrofia', 'peso', 'pesos', 'musculo', 'musculos', 'ganho de massa'],
    terms: ['haltere', 'halter', 'kettlebell', 'anilha', 'barra', 'banco'],
    categories: ['dumbbells', 'kettlebells', 'weight_bench', 'commercial_gym_equipment'],
  },
];

/** Tópicos de objetivo/grupo muscular expostos na busca (chips "Pernas", "Cardio"…). */
export const SEARCH_TOPICS: Array<{ key: string; label: string; categories: string[] }> = TOPICS.map((topic) => ({
  key: topic.keys[0],
  label: topic.label,
  categories: topic.categories,
}));

/** Minúsculas, sem acento, só letras/números/espaço/hífen. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singular(token: string): string {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

export function expandSearchQuery(query: string): SearchExpansion {
  const normalized = normalizeSearchText(query ?? '');
  const words = normalized.split(' ').filter(Boolean);
  const singularWords = words.map(singular);
  const tokens = [
    ...new Set(words.filter((word) => word.length >= 3 && !STOPWORDS.has(word)).map(singular)),
  ];

  const terms = new Set<string>();
  const categories = new Set<string>();
  const topics: string[] = [];
  const labels: string[] = [];
  for (const topic of TOPICS) {
    const hit = topic.keys.some((key) => {
      const normalizedKey = normalizeSearchText(key);
      return normalizedKey.includes(' ')
        ? normalized.includes(normalizedKey)
        : singularWords.includes(singular(normalizedKey));
    });
    if (!hit) continue;
    topics.push(topic.keys[0]);
    labels.push(topic.label);
    topic.terms.forEach((term) => terms.add(term));
    topic.categories.forEach((category) => categories.add(category));
  }

  return { tokens, terms: [...terms], categories: [...categories], topics, labels };
}
