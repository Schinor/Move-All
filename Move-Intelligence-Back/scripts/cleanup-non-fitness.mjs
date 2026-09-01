#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.split('=')[1];

const FITNESS_CLUSTERS = new Set([
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
]);

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

function clean(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isFitness({ category, cluster, title, canonicalName }) {
  const normalizedCategory = clean(category);
  const normalizedCluster = clean(cluster);
  const text = clean(`${title ?? ''} ${canonicalName ?? ''}`);
  if (NON_FITNESS_CATEGORY_PATTERNS.some((pattern) => pattern.test(normalizedCategory))) return false;
  if (NON_FITNESS_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (FITNESS_CLUSTERS.has(normalizedCategory) || FITNESS_CLUSTERS.has(normalizedCluster)) return true;
  return FITNESS_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

function chunks(values, size = 500) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function deleteInChunks(tx, model, field, ids) {
  let count = 0;
  for (const chunk of chunks(ids)) {
    if (chunk.length === 0) continue;
    const result = await tx[model].deleteMany({ where: { [field]: { in: chunk } } });
    count += result.count;
  }
  return count;
}

async function main() {
  const [clusters, products] = await Promise.all([
    prisma.productCluster.findMany({
      include: { snapshots: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.intelligenceProduct.findMany({
      select: { id: true, cluster: true, title: true, source: true },
      orderBy: { capturedAt: 'asc' },
    }),
  ]);

  const deleteClusters = clusters.filter((cluster) => {
    // A cluster can contain several historical snapshots. Use the canonical
    // name plus one representative title so one bad later snapshot does not
    // erase an otherwise valid fitness cluster.
    const snapshotTitle = cluster.snapshots[0]?.title ?? '';
    return !isFitness({
      category: cluster.category,
      cluster: cluster.category,
      canonicalName: cluster.canonicalName,
      title: snapshotTitle,
    });
  });
  const deleteProducts = products.filter((product) => !isFitness(product));
  const clusterIds = deleteClusters.map((cluster) => cluster.id);
  const productIds = deleteProducts.map((product) => product.id);

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    taxonomy: [...FITNESS_CLUSTERS],
    before: { clusters: clusters.length, products: products.length },
    planned: {
      clusters: deleteClusters.length,
      products: deleteProducts.length,
      clusterCategories: Object.entries(
        deleteClusters.reduce((counts, cluster) => {
          const key = cluster.category ?? '(sem categoria)';
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([, left], [, right]) => right - left),
      exactFitnessClustersDeleted: deleteClusters.filter((cluster) =>
        FITNESS_CLUSTERS.has(clean(cluster.category)),
      ).length,
      exactFitnessClustersDeletedSamples: deleteClusters
        .filter((cluster) => FITNESS_CLUSTERS.has(clean(cluster.category)))
        .slice(0, 50)
        .map((cluster) => ({
          id: cluster.id,
          category: cluster.category,
          canonicalName: cluster.canonicalName,
          title: cluster.snapshots[0]?.title ?? null,
        })),
      clusterIds,
      productIds,
      sampleClusters: deleteClusters.slice(0, 50).map((cluster) => ({
        id: cluster.id,
        category: cluster.category,
        canonicalName: cluster.canonicalName,
        title: cluster.snapshots[0]?.title ?? null,
      })),
      sampleProducts: deleteProducts.slice(0, 50),
    },
  };

  const reportDir = resolve(repoRoot, 'backups');
  await mkdir(reportDir, { recursive: true });
  const reportPath = resolve(reportDir, `fitness-cleanup-${Date.now()}-${apply ? 'applied' : 'dry-run'}.json`);

  if (!apply) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    return;
  }

  if (confirmation !== 'DELETE_NON_FITNESS') {
    throw new Error('Aplicação bloqueada: use --apply --confirm=DELETE_NON_FITNESS.');
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const snapshotsByCluster = await deleteInChunks(tx, 'productListingSnapshot', 'productClusterId', clusterIds);
    const snapshotsByProduct = await deleteInChunks(tx, 'productListingSnapshot', 'rawProductId', productIds);
    const clusterItems = await deleteInChunks(tx, 'productClusterItem', 'clusterId', clusterIds);
    const matchReviewsByCluster = await deleteInChunks(tx, 'productMatchReview', 'candidateClusterId', clusterIds);
    const matchReviewsByProductSource = await deleteInChunks(tx, 'productMatchReview', 'sourceProductId', productIds);
    const matchReviewsByProductCandidate = await deleteInChunks(tx, 'productMatchReview', 'candidateProductId', productIds);
    const alerts = await deleteInChunks(tx, 'alert', 'productClusterId', clusterIds);
    const watchlistItems = await deleteInChunks(tx, 'watchlistItem', 'productClusterId', clusterIds);
    const productDemandLinks = await deleteInChunks(tx, 'intelligenceProductDemandLink', 'productId', productIds);
    const deletedProducts = await deleteInChunks(tx, 'intelligenceProduct', 'id', productIds);
    const deletedClusters = await deleteInChunks(tx, 'productCluster', 'id', clusterIds);
    return {
      snapshots: snapshotsByCluster + snapshotsByProduct,
      clusterItems,
      matchReviews: matchReviewsByCluster + matchReviewsByProductSource + matchReviewsByProductCandidate,
      alerts,
      watchlistItems,
      productDemandLinks,
      products: deletedProducts,
      clusters: deletedClusters,
    };
  });

  report.deleted = deleted;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
