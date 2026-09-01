import { Injectable } from '@nestjs/common';
import { CanonicalProductListing } from '../../shared/types/marketplace.types';
import { PrismaService } from '../../shared/database/prisma.service';

@Injectable()
export class SnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(product: CanonicalProductListing, productClusterId?: string) {
    return this.prisma.productListingSnapshot.create({
      data: {
        marketplace: product.marketplace,
        externalProductId: product.externalProductId,
        productClusterId,
        title: product.titleTranslated ?? product.titleOriginal,
        priceMin: product.priceMin,
        priceMax: product.priceMax,
        currency: product.currency,
        moq: product.moq,
        stock: product.stock,
        rating: product.rating,
        reviewCount: product.reviewCount,
        salesSignalRaw: product.salesSignalRaw,
        salesSignalType: product.salesSignalType,
        sellerId: product.externalSellerId,
        sellerName: product.sellerName,
        imageCount: product.imageUrls.length,
        collectedAt: product.collectedAt,
      },
    });
  }
}
