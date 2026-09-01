import { Injectable, Logger } from '@nestjs/common';
import { IntelligenceProduct, Prisma } from '@prisma/client';
import { CanonicalProductListing } from '../../shared/types/marketplace.types';
import { PrismaService } from '../../shared/database/prisma.service';

type Candidate = {
  id: string;
  source: string;
  recordId: string;
  canonicalTitle: string;
  gtin: string | null;
  brand: string | null;
  attrs: Prisma.JsonValue;
  priceValue: Prisma.Decimal | null;
  priceCurrency: string | null;
  clusterId: string;
  similarity: number;
};

@Injectable()
export class ProductMatchingService {
  private readonly logger = new Logger(ProductMatchingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mantém compatibilidade com o pipeline legado, agora com matching real. */
  async findOrCreateTrivialCluster(product: CanonicalProductListing): Promise<string> {
    const existing = await this.prisma.productClusterItem.findUnique({
      where: {
        marketplace_externalProductId: {
          marketplace: product.marketplace,
          externalProductId: product.externalProductId,
        },
      },
    });
    if (existing) return existing.clusterId;

    const canonicalTitle = this.canonicalize(product.titleNormalized || product.titleOriginal);
    try {
      const candidates = await this.prisma.$queryRaw<
        Array<{ id: string; similarity: number }>
      >(Prisma.sql`
        SELECT id, similarity(canonical_name, ${canonicalTitle})::float AS similarity
        FROM product_clusters
        WHERE (${product.categoryNormalized ?? null}::text IS NULL OR category = ${
          product.categoryNormalized ?? null
        })
          AND canonical_name % ${canonicalTitle}
        ORDER BY similarity DESC
        LIMIT 1
      `);
      const candidate = candidates[0];
      if (candidate && Number(candidate.similarity) >= 0.55) {
        await this.attach(
          candidate.id,
          product.marketplace,
          product.externalProductId,
          Number(candidate.similarity),
          'trigram',
        );
        return candidate.id;
      }
    } catch (error) {
      this.logger.warn(`Matching trigram indisponível; criando cluster isolado: ${String(error)}`);
    }

    const cluster = await this.prisma.productCluster.create({
      data: {
        canonicalName: canonicalTitle,
        category: product.categoryNormalized,
        confidenceScore: 1,
        items: {
          create: {
            marketplace: product.marketplace,
            externalProductId: product.externalProductId,
            similarityScore: 1,
            matchedBy: 'new_cluster',
          },
        },
      },
    });
    return cluster.id;
  }

  async findOrCreateClusterForProduct(product: IntelligenceProduct): Promise<string> {
    const existing = await this.prisma.productClusterItem.findUnique({
      where: {
        marketplace_externalProductId: {
          marketplace: product.source,
          externalProductId: product.recordId,
        },
      },
    });
    if (existing) return existing.clusterId;

    const canonicalTitle = product.canonicalTitle || this.canonicalize(product.title);
    const candidates = await this.candidates(product, canonicalTitle);
    for (const candidate of candidates) {
      const decision = this.decide(product, candidate);
      if (decision.match) {
        await this.attach(
          candidate.clusterId,
          product.source,
          product.recordId,
          decision.score,
          decision.method,
        );
        return candidate.clusterId;
      }
      if (decision.review) {
        await this.prisma.productMatchReview.upsert({
          where: {
            sourceProductId_candidateProductId: {
              sourceProductId: product.id,
              candidateProductId: candidate.id,
            },
          },
          update: {
            candidateClusterId: candidate.clusterId,
            similarityScore: decision.score,
            reason: decision.reason,
            status: 'PENDING',
          },
          create: {
            sourceProductId: product.id,
            candidateProductId: candidate.id,
            candidateClusterId: candidate.clusterId,
            similarityScore: decision.score,
            reason: decision.reason,
          },
        });
        break;
      }
    }

    // Check if an existing productCluster exists by canonical name or category
    const existingCluster = await this.prisma.productCluster.findFirst({
      where: {
        OR: [
          { canonicalName: canonicalTitle },
          ...(product.cluster ? [{ category: product.cluster }] : []),
        ],
      },
    });
    if (existingCluster) {
      await this.attach(existingCluster.id, product.source, product.recordId, 1, 'category_match');
      return existingCluster.id;
    }

    return this.createStandaloneCluster(product, canonicalTitle);
  }

  async reclusterAll(batchSize = 100): Promise<{ processed: number; batches: number }> {
    let cursor: string | undefined;
    let processed = 0;
    let batches = 0;
    while (true) {
      const products = await this.prisma.intelligenceProduct.findMany({
        orderBy: { id: 'asc' },
        take: Math.max(1, Math.min(batchSize, 500)),
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (products.length === 0) break;
      batches += 1;
      for (const product of products) {
        await this.prisma.productClusterItem.deleteMany({
          where: { marketplace: product.source, externalProductId: product.recordId },
        });
        const clusterId = await this.findOrCreateClusterForProduct(product);
        await this.prisma.productListingSnapshot.updateMany({
          where: { rawProductId: product.id },
          data: { productClusterId: clusterId },
        });
        processed += 1;
      }
      cursor = products.at(-1)?.id;
    }
    return { processed, batches };
  }

  private async candidates(product: IntelligenceProduct, canonicalTitle: string): Promise<Candidate[]> {
    return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          p.id,
          p.source,
          p.record_id AS "recordId",
          p.canonical_title AS "canonicalTitle",
          p.gtin,
          p.brand,
          p.attrs,
          p.price_value AS "priceValue",
          p.price_currency AS "priceCurrency",
          pci.cluster_id AS "clusterId",
          similarity(p.canonical_title, ${canonicalTitle})::float AS similarity,
          CASE WHEN ${product.gtin}::text IS NOT NULL AND p.gtin = ${product.gtin} THEN 1 ELSE 0 END AS strong_match,
          ROW_NUMBER() OVER (
            PARTITION BY pci.cluster_id
            ORDER BY
              CASE WHEN ${product.gtin}::text IS NOT NULL AND p.gtin = ${product.gtin} THEN 1 ELSE 0 END DESC,
              similarity(p.canonical_title, ${canonicalTitle}) DESC
          ) AS candidate_rank
        FROM products p
        JOIN product_cluster_items pci
          ON pci.marketplace = p.source AND pci.external_product_id = p.record_id
        WHERE p.id <> ${product.id}::uuid
          AND p.canonical_title IS NOT NULL
          AND (p.cluster IS NOT DISTINCT FROM ${product.cluster})
          AND (
            (${product.gtin}::text IS NOT NULL AND p.gtin = ${product.gtin})
            OR p.canonical_title % ${canonicalTitle}
          )
      )
      SELECT
        id, source, "recordId", "canonicalTitle", gtin, brand, attrs,
        "priceValue", "priceCurrency", "clusterId", similarity
      FROM ranked
      WHERE candidate_rank = 1
      ORDER BY strong_match DESC, similarity DESC
      LIMIT 5
    `);
  }

  private decide(product: IntelligenceProduct, candidate: Candidate) {
    if (product.gtin && candidate.gtin) {
      return product.gtin === candidate.gtin
        ? { match: true, review: false, score: 1, method: 'identifier', reason: 'GTIN igual' }
        : { match: false, review: false, score: 0, method: 'veto', reason: 'GTIN divergente' };
    }

    const score = Number(candidate.similarity);
    const attrs = this.record(product.attrs);
    const candidateAttrs = this.record(candidate.attrs);
    for (const unit of ['kg', 'g', 'cm', 'mm', 'm', 'lb', 'un', 'model']) {
      if (attrs[unit] && candidateAttrs[unit] && attrs[unit] !== candidateAttrs[unit]) {
        return { match: false, review: false, score, method: 'veto', reason: `${unit} divergente` };
      }
    }
    if (product.brand && candidate.brand && product.brand !== candidate.brand) {
      return { match: false, review: false, score, method: 'veto', reason: 'marca divergente' };
    }
    if (
      product.priceCurrency &&
      product.priceCurrency === candidate.priceCurrency &&
      product.priceValue &&
      candidate.priceValue
    ) {
      const left = Number(product.priceValue);
      const right = Number(candidate.priceValue);
      if (left > 0 && right > 0 && Math.max(left, right) / Math.min(left, right) > 3) {
        return { match: false, review: false, score, method: 'veto', reason: 'preço acima de 3x' };
      }
    }
    if (score >= 0.55) {
      return { match: true, review: false, score, method: 'trigram', reason: 'similaridade aprovada' };
    }
    return {
      match: false,
      review: score >= 0.4,
      score,
      method: 'review',
      reason: 'similaridade ambígua entre 0.40 e 0.55',
    };
  }

  private async createStandaloneCluster(
    product: IntelligenceProduct,
    canonicalTitle: string,
  ): Promise<string> {
    const cluster = await this.prisma.productCluster.create({
      data: {
        canonicalName: canonicalTitle,
        category: product.cluster,
        confidenceScore: product.gtin ? 1 : 0.7,
      },
    });
    await this.attach(cluster.id, product.source, product.recordId, 1, 'new_cluster');
    return cluster.id;
  }

  private async attach(
    clusterId: string,
    marketplace: string,
    externalProductId: string,
    similarityScore: number,
    matchedBy: string,
  ) {
    await this.prisma.productClusterItem.upsert({
      where: { marketplace_externalProductId: { marketplace, externalProductId } },
      update: { clusterId, similarityScore, matchedBy },
      create: { clusterId, marketplace, externalProductId, similarityScore, matchedBy },
    });
  }

  private canonicalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(dumbbells?|halteres?)\b/g, 'halter')
      .replace(/\b(premium|original|novo|nova|kit|set|par|de|da|do|para|com)\b/g, ' ')
      .replace(/(\d+(?:[.,]\d+)?)\s*(kg|g|cm|mm|m|lb|un|pcs)\b/g, '$1$2')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .filter((token, index, all) => token !== all[index - 1])
      .join(' ');
  }

  private record(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
