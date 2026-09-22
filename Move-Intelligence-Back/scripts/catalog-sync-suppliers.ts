import { PrismaClient } from '@prisma/client';
import { COUNTED_ITEM_STATUSES } from '../src/modules/catalog/catalog.constants';
import { supplierIdentity } from '../src/modules/catalog/supplier-identity';
import { SUPPLIER_MARKETPLACES } from '../src/modules/products/offers/offer-rules';
import { syntheticSnapshotWhere } from '../src/shared/synthetic-data/synthetic-data.filter';

/**
 * Registra em `suppliers` os vendedores dos anúncios de fornecedor que estão
 * em cards (itens confirmed/auto). Idempotente; nunca apaga.
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const items = await prisma.productClusterItem.findMany({
      where: {
        marketplace: { in: [...SUPPLIER_MARKETPLACES] },
        status: { in: [...COUNTED_ITEM_STATUSES] },
      },
      select: { marketplace: true, externalProductId: true },
    });
    const seen = new Map<string, { source: string; nativeSupplierId: string; name: string }>();
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200);
      const snapshots = await prisma.productListingSnapshot.findMany({
        where: {
          ...syntheticSnapshotWhere(),
          OR: chunk.map((item) => ({
            marketplace: item.marketplace,
            externalProductId: item.externalProductId,
          })),
        },
        orderBy: { collectedAt: 'desc' },
        select: { marketplace: true, sellerId: true, sellerName: true },
      });
      for (const snapshot of snapshots) {
        const identity = supplierIdentity(snapshot);
        if (identity) seen.set(`${identity.source}::${identity.nativeSupplierId}`, identity);
      }
    }

    let upserts = 0;
    for (const identity of seen.values()) {
      await prisma.supplier.upsert({
        where: {
          source_nativeSupplierId: {
            source: identity.source,
            nativeSupplierId: identity.nativeSupplierId,
          },
        },
        create: identity,
        update: { name: identity.name },
      });
      upserts += 1;
    }
    const total = await prisma.supplier.count();
    console.log(`catalog:sync-suppliers — ${upserts} fornecedores atualizados/criados; total na tabela: ${total}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
