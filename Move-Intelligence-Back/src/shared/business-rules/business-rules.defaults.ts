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
  discovery: {
    // Teto de chamadas pagas por execução da descoberta, contando busca +
    // raspagens (A3.5). Espelho de DISCOVERY_MAX_CALLS no ETL Python.
    maxCalls: 300,
  },
  tracking: {
    // Anúncio vira DEAD após N "not_found" seguidos; preço fora de ±X% da
    // mediana das últimas 4 observações ok vira "partial" (A3.7/A3.1).
    notFoundAfterFailures: 3,
    priceDeviationPct: 60,
  },
  reviewSampling: {
    // Nova amostra de textos quando reviews_count crescer ≥ N ou ≥ X%
    // desde reviews_count_at_sample; até Y por faixa 1–2/3/4–5 (A5).
    minNewReviews: 10,
    minGrowthPct: 10,
    perBand: 10,
  },
  sourcing: {
    // "Alto volume" (A6): maior soma de vendidos/transações, ou presença em
    // ≥ N anúncios do mesmo cluster. Foco B2B (Alibaba, 1688, AliExpress).
    highVolumeMinListings: 2,
  },
  socialSourcesStatus: {
    // A7 (14/09/2026): descoberta TikTok Shop acha produtos no SERP, mas as
    // páginas /pdp/ voltam vazias no unlocker (0/2) — fonte indisponível: o
    // momentum ignora "social" e a UI mostra "sinal social indisponível" (B6).
    tiktok_shop: 'unavailable',
  },
  moveScoreBands: {
    // B1 (decisão 5): faixas configuráveis do Move Score. Verde > green,
    // amarelo green–yellow, vermelho <= yellow. Padrão 70/50.
    green: 70,
    yellow: 50,
  },
  momentum: {
    // B2 (decisão 7): pesos e limiares do momentum. Crescimento de vendas =
    // inclinação de log(vendas) nas últimas 8 semanas; busca = variação 8
    // semanas contra 8 anteriores (+ YoY quando existir). Default 0,6/0,4.
    salesWeight: 0.6,
    searchWeight: 0.4,
    upThresholdPct: 10,
    downThresholdPct: -10,
  },
  quadrant: {
    // B3 (decisões 2-3): "financeiro bom" = faixa verde por padrão; permite
    // incluir o amarelo depois sem trocar código.
    financialThreshold: 'green',
  },
  riskCauses: {
    // B4 (decisão 4): limiares estruturais comparando premissas com receita.
    lowMarginPct: 10,
    highImportCostPct: 70,
    highInvestmentMonths: 2,
  },
  // Subprojeto B: oferta com custo < 30% da mediana do card fica sem score (preço de isca).
  offers: {
    suspiciousPriceRatio: 0.3,
  },
} as const;
