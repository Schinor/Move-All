export const DEFAULT_BUSINESS_RULES = {
  trendWeights: {
    searchGrowth: 0.15,
    marketplaceGrowth: 0.25,
    supplierGrowth: 0.2,
    priceOpportunity: 0.2,
    reviewVelocity: 0.1,
    socialBuzz: 0.1,
  },
  minimumVolumeByCategory: {
    default: 30,
    equipment: 50,
    accessories: 40,
    apparel: 80,
    supplements: 100,
  },
  signalNormalization: {
    sales_count: { maxReference: 5000 },
    latest_volume: { maxReference: 1000 },
    review_count: { maxReference: 3000 },
    hot_value: { maxReference: 100000 },
    best_seller_rank: { bestRank: 1, relevantRank: 50000 },
  },
  margin: {
    minimumAcceptableMarginPct: 0.35,
  },
  westernSaturation: {
    bestSellerPenalty: 0.6,
    multiStorePenalty: 0.25,
    highReviewCountPenalty: 0.35,
  },
  alertThresholds: {
    reviewGrowth7d: 0.5,
    supplierGrowth30d: 25,
    factoryPriceDrop30d: -0.18,
    minimumOpportunityScore: 0.7,
  },
} as const;
