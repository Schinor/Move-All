import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { CardAssignerService } from '../src/modules/catalog/card-assigner.service';
import { CatalogReviewService } from '../src/modules/catalog/catalog-review.service';
import { TaxonomyService } from '../src/modules/catalog/taxonomy.service';
import { TaxonomySeedFile } from '../src/modules/catalog/taxonomy.types';

async function main() {
  const prisma = new PrismaClient();
  try {
    const file = JSON.parse(
      readFileSync(join(__dirname, '../prisma/seed/catalog-taxonomy.json'), 'utf-8'),
    ) as TaxonomySeedFile;
    // PrismaClient é compatível com o que o TaxonomyService usa do PrismaService.
    const service = new TaxonomyService(prisma as never);
    const result = await service.seedFromFile(file);
    const [families, types] = await Promise.all([
      prisma.catalogFamily.count(),
      prisma.catalogType.count({ where: { active: true } }),
    ]);
    const nullable = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'catalog_decisions' AND column_name = 'actor_user_id'`;
    if (nullable[0]?.is_nullable !== 'YES') {
      console.log(`catalog:seed OK — famílias: ${families}, tipos ativos: ${types}, sugestões resolvidas: 0 (migration actor_user_id ainda não aplicada)`);
      return;
    }
    const assigner = new CardAssignerService(prisma as never, service);
    const review = new CatalogReviewService(prisma as never, assigner);
    const pending = await prisma.catalogReviewItem.findMany({
      where: { kind: 'suggested_type', status: 'pending' },
      select: { id: true, suggestedTypeAliases: true },
    });
    const targets = new Map([
      ['pilates_reformer', 'pilates_reformer'],
      ['pilates_accessory_kit', 'pilates_accessory_kit'],
      ['pilates_half_moon', 'pilates_barrel'],
    ]);
    let resolvedSuggested = 0;
    for (const item of pending) {
      const target = item.suggestedTypeAliases.map((alias) => targets.get(alias)).find((value): value is string => !!value);
      if (!target) continue;
      await review.mergeSuggestedTypeToExisting(item.id, target, null);
      resolvedSuggested += 1;
    }
    console.log(`catalog:seed OK — famílias: ${families}, tipos ativos: ${types}, tipos atualizados: ${result.types}, sugestões resolvidas: ${resolvedSuggested}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
