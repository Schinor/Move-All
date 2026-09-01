import { Injectable } from '@nestjs/common';
import { SalesSignalType } from '../types/marketplace.types';
import { DEFAULT_BUSINESS_RULES } from './business-rules.defaults';

@Injectable()
export class BusinessRulesService {
  getTrendWeights() {
    return DEFAULT_BUSINESS_RULES.trendWeights;
  }

  getMinimumVolume(category?: string): number {
    const key = category as keyof typeof DEFAULT_BUSINESS_RULES.minimumVolumeByCategory;
    return (
      DEFAULT_BUSINESS_RULES.minimumVolumeByCategory[key] ??
      DEFAULT_BUSINESS_RULES.minimumVolumeByCategory.default
    );
  }

  getMinimumMarginPct(): number {
    return DEFAULT_BUSINESS_RULES.margin.minimumAcceptableMarginPct;
  }

  getAlertThresholds() {
    return DEFAULT_BUSINESS_RULES.alertThresholds;
  }

  normalizeSalesSignal(
    rawValue: number | null | undefined,
    type: SalesSignalType | null | undefined,
  ): number {
    if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) {
      return 0;
    }

    if (type === 'best_seller_rank') {
      const config = DEFAULT_BUSINESS_RULES.signalNormalization.best_seller_rank;
      if (rawValue <= config.bestRank) {
        return 1;
      }
      if (rawValue >= config.relevantRank) {
        return 0;
      }

      return this.clamp(
        1 -
          (rawValue - config.bestRank) /
            (config.relevantRank - config.bestRank),
      );
    }

    const signalType =
      type && type !== 'unknown' ? type : ('latest_volume' as const);
    const config =
      DEFAULT_BUSINESS_RULES.signalNormalization[
        signalType as keyof typeof DEFAULT_BUSINESS_RULES.signalNormalization
      ];

    if (!config || !('maxReference' in config)) {
      return 0;
    }

    return this.clamp(rawValue / config.maxReference);
  }

  /**
   * Normaliza um volume absoluto (ex.: `reviewCount`) em 0–1 numa escala
   * logarítmica, usando `signalNormalization.review_count.maxReference` como
   * teto. A escala log é intencional: a maioria dos anúncios tem poucas
   * dezenas de reviews e uma normalização linear os achataria todos perto de
   * zero, impedindo qualquer ordenação útil na primeira importação.
   */
  normalizeVolumeLog(value: number | null | undefined): number {
    if (value === null || value === undefined || Number.isNaN(value) || value <= 0) {
      return 0;
    }

    const maxReference =
      DEFAULT_BUSINESS_RULES.signalNormalization.review_count.maxReference;

    return this.clamp(Math.log10(1 + value) / Math.log10(1 + maxReference));
  }

  clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
