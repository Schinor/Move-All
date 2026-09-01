export interface TrendScoreBreakdown {
  searchGrowthScore: number;
  marketplaceGrowthScore: number;
  supplierGrowthScore: number;
  priceOpportunityScore: number;
  reviewVelocityScore: number;
  socialBuzzScore: number;
  trendScore: number;
}

export interface MarginEstimate {
  originCost: number;
  landedCost: number;
  estimatedSalePrice: number;
  margin: number;
  marginPct: number;
  marginScore: number;
}

export interface OpportunityScoreBreakdown {
  trendScore: number;
  marginScore: number;
  westernSaturationScore: number;
  opportunityScore: number;
}
