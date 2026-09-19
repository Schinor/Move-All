import { Prisma } from '@prisma/client';
import { ValidatedFicha } from './ficha-parser';

/** Mapeamento único da ficha validada para a linha persistida. */
export function fichaDbFields(v: ValidatedFicha): Prisma.ListingFichaUpdateInput {
  return {
    typeKey: v.typeKey,
    suggestedType: v.suggestedType,
    inScope: v.inScope,
    isAccessoryOrPart: v.isAccessoryOrPart,
    isKitOrBundle: v.isKitOrBundle,
    hasVariations: v.hasVariations,
    cardKeyValues: v.cardKeyValues as Prisma.InputJsonValue,
    newDifferential: v.newDifferential,
    missingKeyAttrs: v.missingKeyAttrs,
    comparisonValues: v.comparisonValues as Prisma.InputJsonValue,
    variationValues: v.variationValues as Prisma.InputJsonValue,
    specs: v.specs as Prisma.InputJsonValue,
    brand: v.brand,
    model: v.model,
    confidence: v.confidence,
  };
}
