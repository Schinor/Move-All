import { Injectable } from '@nestjs/common';
import {
  CanonicalProductListing,
  RawProduct,
} from '../../shared/types/marketplace.types';
import { TranslationService } from '../translation/translation.service';

@Injectable()
export class NormalizationService {
  constructor(private readonly translation: TranslationService) {}

  async normalize(raw: RawProduct): Promise<CanonicalProductListing> {
    const titleTranslated = await this.translation.translateToPortuguese(
      raw.titleOriginal,
    );

    return {
      marketplace: raw.source,
      sourceType: raw.sourceType,
      externalProductId: raw.externalProductId,
      externalSellerId: raw.externalSellerId,
      titleOriginal: raw.titleOriginal,
      titleTranslated,
      titleNormalized: this.normalizeText(titleTranslated),
      categoryOriginal: raw.categoryOriginal,
      categoryNormalized: raw.categoryOriginal
        ? this.normalizeText(raw.categoryOriginal)
        : undefined,
      brand: raw.brand,
      priceMin: raw.priceMin,
      priceMax: raw.priceMax,
      currency: raw.currency,
      moq: raw.moq,
      stock: raw.stock,
      rating: raw.rating,
      reviewCount: raw.reviewCount,
      salesSignalRaw: raw.salesSignalRaw,
      salesSignalType: raw.salesSignalType,
      sellerName: raw.sellerName,
      sellerLocation: raw.sellerLocation,
      sellerRating: raw.sellerRating,
      imageUrls: raw.imageUrls ?? [],
      videoUrl: raw.videoUrl,
      productUrl: raw.productUrl,
      collectedAt: raw.collectedAt ?? new Date(),
    };
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
