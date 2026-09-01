/**
 * Escopo editorial da plataforma: produtos fitness, treino e recovery.
 *
 * A categoria recebida por marketplaces é inconsistente (e às vezes vazia),
 * por isso a decisão usa a taxonomia do ETL e sinais de título de alta
 * precisão. Termos genéricos como "sport" ou "fitness" sozinhos não bastam.
 */

export const FITNESS_CLUSTERS = [
  'resistance_bands',
  'dumbbells',
  'vibration_plate',
  'compact_cardio',
  'kettlebells',
  'ab_wheel',
  'rowing_machine',
  'pull_up_equipment',
  'recovery_massage',
  'yoga_pilates',
  'yoga_mat',
  'weight_bench',
  'push_up_equipment',
  'jump_rope',
  'home_gym_station',
  'home_fitness_equipment',
] as const;

const FITNESS_CLUSTER_SET = new Set<string>(FITNESS_CLUSTERS);

const FITNESS_TITLE_PATTERNS = [
  /resistance[\s_-]*band/i,
  /\bminiband\b/i,
  /\b(dumbbell|kettlebell|barbell)\b/i,
  /\b(halter(?:es)?|peso(?:s)?)\b.*\b(academia|gym|muscul|treino|exerc)/i,
  /\b(treadmill|walking[\s_-]*pad)\b/i,
  /\b(rowing[\s_-]*machine|rower)\b/i,
  /\b(jump[\s_-]*rope|speed[\s_-]*rope)\b/i,
  /\bcorda\s+de\s+pular\b/i,
  /\bpull[\s_-]*up\s+(bar|equipment|tower|station)\b/i,
  /\bpush[\s_-]*up\s+(bar|board|equipment|grip|stand)\b/i,
  /\bab[\s_-]*(wheel|roller)\b/i,
  /\b(yoga[\s_-]*mat|tapete.*yoga|colchonete.*(?:fitness|exerc))\b/i,
  /\bpilates\s+(board|equipment|reformer|ring|bar)\b/i,
  /\b(weight[\s_-]*bench|banco.*(?:musculacao|academia))\b/i,
  /\b(vibration[\s_-]*plate|plataforma\s+vibrat)/i,
  /\b(massage[\s_-]*gun|percussion[\s_-]*massager|muscle\s+recovery|foam\s+roller)\b/i,
  /\b(home[\s_-]*gym|gym\s+(station|equipment)|fitness\s+equipment|workout\s+equipment|exercise\s+equipment|exercise\s+machine)\b/i,
  /\bboxing\s+(wall|bag|target)\b/i,
  /\b(whey\s+protein|muscletech\s+whey)\b/i,
  /\b(fitness|workout)\s+(pant|pants|legging|leggings|shorts)\b/i,
  /\b(training|running)\s+(shoe|sneaker|shirt|shorts|legging)\b/i,
  /\b(fitness|workout|gym|training)\b.*\b(active[\s_-]*wear|sportswear|tracksuit|leggings|shorts|pants|shirt)\b/i,
  /\b(active[\s_-]*wear|sportswear|tracksuit)\b.*\b(fitness|workout|gym|training)\b/i,
  /\b(yoga|pilates)\b.*\b(set|wear|leggings|pants)\b/i,
  /\b(sandbag|punching\s+bag|arm\s+trainer)\b/i,
];

const NON_FITNESS_PATTERNS = [
  /\b(headphones?|earphones?|smartwatch|smart\s+watch)\b/i,
  /\b(fone\s+de\s+ouvido|fone\s+bluetooth)\b/i,
  /\b(video\s*games?|gaming\s+console|playstation|xbox|nintendo)\b/i,
  /\b(book|books|livro|livros|kindle|novel|edicao\s+para\s+kindle)\b/i,
  /\b(water\s+shoes?|aqua\s+socks?)\b/i,
  /\b(shoelaces?|laces?|cadarcos?)\b/i,
  /\b(phone\s+case|smartphone|mobile\s+phone|laptop|tablet|drone|smart\s+tv)\b/i,
  /\b(capa\s+para\s+(iphone|celular)|teclado\s+bluetooth|carregador\s+para\s+iphone)\b/i,
  /\b(bird\s+feeder|alimentador(?:es)?\s+de\s+passaros)\b/i,
  /\b(horse|cavalo|equestrian)\b/i,
  /\b(mouse\s+sem\s+fio|laserpecker|knife\s+sharpener|afiador\s+de\s+faca)\b/i,
  /\b(wall\s+art|canvas\s+art|arte\s+de\s+parede|wall\s+sticker|cortina\s+de\s+chuveiro)\b/i,
  /\b(flag|bandeira|fishing\s+rod|vara\s+de\s+pesca|bowling|paddle\s+board)\b/i,
  /\b(jewelry|necklace|earrings?|makeup|cosmetic|handbag|vestido|dress)\b/i,
  /\b(cabo\s+para\s+iphone|cable\s+management\s+under\s+the\s+desk)\b/i,
  /\b(atenas|helenas)\b/i,
  /\b(estatuet|statuet|decora[cç][aã]o)\b/i,
];

const NON_FITNESS_CATEGORY_PATTERNS = [
  /\binteractive\s+gaming\b/i,
  /\bgaming\s+figures?\b/i,
  /\bvideo\s*games?\b/i,
];

export interface FitnessScopeInput {
  category?: string | null;
  cluster?: string | null;
  title?: string | null;
  canonicalName?: string | null;
}

function clean(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Retorna true somente para itens que pertencem ao escopo fitness. */
export function isFitnessProduct(input: FitnessScopeInput): boolean {
  const category = clean(input.category);
  const cluster = clean(input.cluster);
  const text = clean(`${input.title ?? ''} ${input.canonicalName ?? ''}`);

  if (NON_FITNESS_CATEGORY_PATTERNS.some((pattern) => pattern.test(category))) {
    return false;
  }
  if (NON_FITNESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }

  if (FITNESS_CLUSTER_SET.has(category) || FITNESS_CLUSTER_SET.has(cluster)) {
    return true;
  }

  return FITNESS_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}
