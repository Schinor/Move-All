import { Prisma } from '@prisma/client';

/**
 * Helper central para a flag `is_synthetic` (ver RELATORIO_ANALISE_DADOS_E_SCORES.md
 * seções 2.1 A5 e 5 "Fase 0"). Todo produto/snapshot gerado pelo pipeline
 * sintético (`historical-collection`, `seed-6months`, supplier
 * "Move Fitness Partner%") é marcado com `is_synthetic = true`.
 *
 * `INCLUDE_SYNTHETIC_DATA` (default `false`) controla se esses registros
 * entram no ranking/dashboard, no Monte Carlo em lote, nos alertas e no
 * copilot. Documentado em `.env.example` e `docs/production.md`.
 *
 * Use os helpers abaixo em vez de repetir a condição em cada consulta.
 */
export function includeSyntheticData(): boolean {
  return process.env.INCLUDE_SYNTHETIC_DATA === 'true';
}

/**
 * Fragmento SQL para colar dentro de um `WHERE` (após `1 = 1` ou outra
 * condição) de uma query raw que lê `product_listing_snapshots`.
 * Retorna SQL vazio quando `INCLUDE_SYNTHETIC_DATA=true`.
 *
 * @param alias alias da tabela na query (ex.: 's'); omitir quando a coluna
 *   não estiver qualificada.
 */
export function syntheticSnapshotFilterSql(alias?: string): Prisma.Sql {
  if (includeSyntheticData()) return Prisma.empty;
  const column = alias ? `${alias}.is_synthetic` : 'is_synthetic';
  return Prisma.sql`AND ${Prisma.raw(column)} = false`;
}

/** Filtro Prisma (typed query) para `product_listing_snapshots`. */
export function syntheticSnapshotWhere(): Prisma.ProductListingSnapshotWhereInput {
  return includeSyntheticData() ? {} : { isSynthetic: false };
}

/** Filtro Prisma (typed query) para `products` (IntelligenceProduct). */
export function syntheticProductWhere(): Prisma.IntelligenceProductWhereInput {
  return includeSyntheticData() ? {} : { isSynthetic: false };
}
