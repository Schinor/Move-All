/**
 * Models do frontend — espelham o contrato (docs/contract/openapi.yaml).
 * Convenção: o JSON da API é snake_case; aqui usamos camelCase e a conversão
 * acontece na borda (ver ApiClient / mapeadores por serviço).
 */

export type BlockStatus = 'computed' | 'pending' | 'not_available';
export type RiskLevel = 'baixo' | 'medio' | 'alto';

/** Envelope de explicabilidade de um indicador sensível. */
export interface Indicator {
  value: number | null;
  explanation: string | null;
  inputs: Record<string, number> | null;
  window: string | null;
}

/** Bloco que pode não ter motor no backend ainda. */
export interface Block<T> {
  status: BlockStatus;
  items: T[];
}

/** Estágio na curva de adoção. */
export type TrendStage = 'emerging' | 'rising' | 'peaking' | 'mainstream';

export type CardStatus = 'legacy' | 'provisional' | 'confirmed' | 'merged';

export interface CardComparison {
  listingCount: number;
  storeCount: number;
  brandCount: number;
  priceMedianBr: number | null;
  priceMinBr: number | null;
  priceMaxBr: number | null;
  ranges: Array<{ attr: string; labelPt: string; unit: string | null; min: number; max: number }>;
  counts: Array<{ attr: string; labelPt: string; total: number; values: Array<{ value: string; count: number }> }>;
  techWarning: string | null;
}

export interface CardListingTracking {
  status: string;
  tier: number;
  reason: string | null;
  cadenceDays: number | null;
  lastSuccessAt: string | null;
}

export interface CardListing {
  marketplace: string;
  externalProductId: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  status: 'confirmed' | 'auto' | 'provisional';
  variation: string | null;
  brand: string | null;
  tracking?: CardListingTracking | null;
}

export interface DiscoveryTerm {
  id: string;
  term: string;
  geo: 'BR' | 'US';
  typeKey: string;
  typeName: string | null;
  familyKey: string | null;
  risingLabel: string;
  breakout: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'new' | 'approved' | 'searched' | 'ignored';
  searchedAt: string | null;
  newListings: number | null;
  searchError: string | null;
}

export interface DiscoveryTermCounts { new: number; approved: number; searched: number; ignored: number }

export interface ReviewCounts { provisionalListing: number; suggestedType: number }

export interface ReviewListingItem {
  id: string;
  kind: 'provisional_listing';
  reason: string;
  marketplace: string;
  externalProductId: string;
  title: string;
  url: string | null;
  price: number | null;
  currency: string | null;
  suggestedCard: { id: string; name: string; category: string | null } | null;
  ficha: { typeKey: string | null; cardKeyValues: Record<string, string>; missingKeyAttrs: string[]; comparisonValues: Record<string, unknown>; brand: string | null } | null;
}

export interface ReviewTypeItem {
  id: string;
  kind: 'suggested_type';
  reason: string;
  suggestedTypeKey: string;
  aliases: string[];
  listingCount: number;
  samples: Array<{ title: string; marketplace: string }>;
  similarTypes: Array<{ key: string; namePt: string }>;
}

export interface CatalogFamily { key: string; namePt: string }

export interface TrendProduct {
  productClusterId: string;
  canonicalName: string;
  category: string | null;
  imageUrl: string | null;
  /** Legados removidos do contrato em F2.7 (opcionais por tolerância). */
  trendScore?: Indicator;
  opportunityScore?: Indicator;
  westernSaturationScore?: Indicator;
  marginEstimate: Indicator;
  risk: RiskLevel | null;
  /** Move Score oficial (F2.6, D9 pendente: nome exibido "Move Score"). */
  moveScore: number | null;
  decision: string | null;
  /** Faixa pronta da API (B1, decisão 5): green > 70, yellow 50–70, red ≤ 50. */
  scoreBand?: 'green' | 'yellow' | 'red' | null;
  /** Ação por quadrante (B3, decisões 2-3). */
  action?: string | null;
  actionLabel?: string | null;
  momentum?: {
    direction: string | null;
    growthPct: number | null;
    confidence: string | null;
    sources: string[];
  } | null;
  riskExplanation?: { text: string | null; drivers: Array<{ factor: string; share: number }> } | null;
  /** Premissas do Monte Carlo vigente (precoVenda, custoUsd, freteUsdUnidade, impostoImportacao, cambioBase…). */
  premises?: Record<string, number> | null;
  dataConfidence: string | null;
  pVplPositivo?: number | null;
  cvar5?: number | null;
  mainSources: string[];
  recommendation: string | null;
  /** Campos de apresentação usados pelos cards (opcionais até o backend calcular). */
  stage: TrendStage | null;
  spark: number[] | null;
  growthPct: number | null;
  marginPct: number | null;
  leadTimeDays: number | null;
  projectedRevenue: number | null;
  /** Crescimento TikTok Δlog→% (B6); null = "Sinal social indisponível". */
  tiktokGrowthPct?: number | null;
  /** C1/C2: indicadores do ranking (nunca inventados; null vira "—"). */
  price?: number | null;
  reviews?: number | null;
  rating?: number | null;
  detectedOn?: string[];
  topSupplier?: { name: string; source: string; verified: boolean; years: number | null } | null;
  reviewSummary?: { by_band: Record<string, { summary: string; top_reasons: unknown; sample_size: number }>; distribution: Record<string, number> | null } | null;
  /** Catálogo (subprojeto A): o cluster é o card. */
  cardStatus?: CardStatus | null;
  familyName?: string | null;
  typeName?: string | null;
  cardChips?: string[];
  listingCount?: number | null;
  storeCount?: number | null;
  brandCount?: number | null;
  priceMedianBr?: number | null;
  priceMinBr?: number | null;
  priceMaxBr?: number | null;
}

/** Resumo do dashboard executivo (KPIs de topo + ticker). */
export interface DashboardKpi {
  label: string;
  value: string;
  delta: number;
  spark: number[] | null;
}
export interface DashboardTicker {
  name: string;
  value: string;
  up: boolean;
}
export interface DashboardSummary {
  kpis: DashboardKpi[];
  tickers: DashboardTicker[];
}

export interface TrendProductDetail extends TrendProduct {
  imageUrls: string[];
  signals: Record<string, Indicator>;
  comparison?: CardComparison | null;
  mergedIntoId?: string;
}

export interface SeriesPoint {
  t: string;
  v: number;
}
export interface Series {
  window: string;
  points: SeriesPoint[];
}

export interface SearchTrendPoint {
  weekStart: string;
  value: number;
  partial: boolean;
}

export interface SearchTrendSeries {
  geo: 'BR' | 'US' | string;
  term: string;
  capturedAt: string;
  status: 'ok' | 'sem_volume';
  points: SearchTrendPoint[];
  growth4w: number | null;
  growth12w: number | null;
}

export interface SearchTrends {
  typeKey: string | null;
  series: SearchTrendSeries[];
}

/** Avaliações por semana (positivas 4–5★, neutras 3★, negativas 1–2★) + nota média. */
export interface ReviewSentimentPoint {
  t: string;
  positive: number;
  neutral: number;
  negative: number;
  avgRating: number | null;
  totalReviews: number;
}

export interface ReviewSentiment {
  window: string;
  points: ReviewSentimentPoint[];
  totals: {
    positive: number;
    neutral: number;
    negative: number;
    positiveShare: number | null;
    negativeShare: number | null;
    avgRating: number | null;
  } | null;
}

/** Item do bloco "Recomendação" do executivo. */
export interface ExecutiveRecommendationItem {
  productClusterId: string;
  canonicalName: string;
  moveScore: number | null;
  action: string | null;
  actionLabel?: string | null;
  text: string;
}

export interface Supplier {
  id: string;
  name: string;
  /** D5: fonte do anúncio — B2B (Alibaba/1688/AliExpress) é fornecedor; retail é canal. */
  source?: string | null;
  country: string | null;
  countryCode: string | null;
  flag: string | null;
  city: string | null;
  category: string | null;
  score: Indicator;
  ratingStars?: number;
  rating_stars?: number;
  tier?: 'Diamante' | 'Ouro' | 'Prata' | 'Bronze' | string;
  totalProducts?: number;
  total_products?: number;
  totalMonthlySales?: number | null;
  total_monthly_sales?: number | null;
  confidence: number | null;
  moq: number | null;
  fob: number | null;
  leadTime: number | null;
  shipping: number | null;
  quality: number | null;
  margin: Indicator;
  risk: RiskLevel | null;
  certifications: string[];
}

export interface SourcingSummary {
  totalSuppliers: number;
  avgFob: number | null;
  countries: number;
  topOrigin: string | null;
}

export type OfferState = 'com_score' | 'sem_preco' | 'suspeito' | 'aguardando_lote' | 'sem_score_card';

export interface CardOffer {
  key: string;
  marketplace: string;
  externalProductId: string;
  title: string | null;
  sellerName: string | null;
  url: string | null;
  unitCostUsd: number | null;
  currency: string | null;
  moq: number;
  rating: number | null;
  salesSignal: number | null;
  itemStatus: string;
  state: OfferState;
  score: number | null;
  pVplPositivo: number | null;
  capitalPrimeiroPedido: number | null;
  computedAt: string | null;
}

export interface CardOffers {
  card: { score: number | null; unitCostUsd: number | null; dataConfidence: string | null };
  bestOfferKey: string | null;
  offers: CardOffer[];
}

export type PremiseSource =
  | 'csv'
  | 'exchange_rate'
  | 'default'
  | 'derived_default'
  | 'override'
  | 'ai_suggestion'
  | 'offer';

export interface MonteCarloPremises {
  precoVenda: number;
  tmaMensal: number;
  folgaEstoque: number;
  horizonteMeses: number;
  precoReferencia: number;
  demandaReferencia: number;
  elasticidade: number;
  custoUsd: number;
  freteUsdUnidade: number;
  impostoImportacao: number;
  cambioBase: number;
  marketingInicial: number;
  comissaoMarketplace: number;
  impostoVenda: number;
  freteCliente: number;
  custoFixoMensal: number;
  leadTimeDias: number;
  fracaoSalvage: number;
  curvaRampa: number[];
  volCambio: number;
  volPreco: number;
  volDemanda: number;
  volLead: number;
  corrCambioLead: number;
  qtdMinimaPedido: number;
}

export interface MonteCarloMetrics {
  cenarios: number;
  pVplPositivo: number;
  vplMedio: number;
  vplMediano: number;
  vplP5: number;
  vplP95: number;
  cvar5: number;
  ilMediano: number;
  roiMedio: number;
}

export interface MonteCarloHistogramBin {
  min: number;
  max: number;
  count: number;
}

export interface MonteCarloPricePoint {
  price: number;
  medianVpl: number;
}

export interface MonteCarloSimulationResult {
  productClusterId: string;
  canonicalName: string;
  premiseSources: Record<string, PremiseSource>;
  premises: MonteCarloPremises;
  metrics: MonteCarloMetrics;
  financialScore: number;
  riskLevel: RiskLevel;
  decision: string;
  histogram: MonteCarloHistogramBin[];
  priceCurve: MonteCarloPricePoint[];
  optimalPrice: MonteCarloPricePoint | null;
  /**
   * true quando a simulação usou premissas alteradas pelo usuário ("e se").
   * Nesse caso o backend NÃO grava o resultado como score oficial do cluster
   * (ver RELATORIO_ANALISE_DADOS_E_SCORES.md seção 3.2 S7) — a UI precisa
   * deixar isso explícito para não passar a impressão de que o ranking mudou.
   */
  isUserScenario: boolean;
}

export interface MonteCarloDefaults {
  productClusterId: string;
  canonicalName: string;
  premises: MonteCarloPremises;
  premiseSources: Record<string, PremiseSource>;
  scenarioCount: number;
  seed: number;
  priceScan: boolean;
  priceScanScenarios: number;
  offerKey: string | null;
}

export interface MonteCarloSimulationRequest {
  premises?: Partial<Record<string, number | number[]>>;
  scenario_count?: number;
  seed?: number;
  price_scan?: boolean;
  price_scan_scenarios?: number;
  offer_key?: string;
}

export interface MonteCarloAiPremisesResult {
  productClusterId: string;
  canonicalName: string;
  premises: MonteCarloPremises;
  premiseSources: Record<string, PremiseSource>;
  rationale: string | null;
  warnings: string[];
  fragileAssumptions: string[];
}

export interface MonteCarloAiPremisesRequest {
  premises?: Partial<Record<string, number | number[]>>;
  user_notes?: string;
}

export interface Signal {
  id: string;
  source: string;
  origin: string | null;
  time: string | null;
  title: string;
  body: string | null;
  category: string | null;
  intensity: number | null;
  growth: number | null;
  score: Indicator;
  confidence: Indicator;
  risk: RiskLevel | null;
  tags: string[];
}

export interface SignalSource {
  source: string;
  activeSignals: number;
  growth: number;
  confidence: Indicator;
  dominantCategory: string | null;
}

export interface Market {
  id: string;
  country: string;
  code: string | null;
  region: string | null;
  score: Indicator;
  growth: number | null;
  brazilFit: Indicator;
  demand: number | null;
  risk: RiskLevel | null;
}

export type RecommendationAction =
  | 'comprar'
  | 'comprar_cautela'
  | 'monitorar'
  | 'negociar'
  | 'ajustar_quantidade'
  | 'bloquear';

export interface Recommendation {
  id: string;
  productClusterId: string | null;
  title: string;
  action: RecommendationAction;
  rationale: string | null;
  /** Legado removido do contrato em F2.7. */
  opportunityScore?: Indicator;
  moveScore?: number | null;
  decision?: string | null;
  dataConfidence?: string | null;
}

export interface AiRecommendationResult {
  id: string;
  productClusterId: string;
  decision: string;
  action: string;
  rationale: string;
  generatedText: string;
  keyDrivers?: string[];
  recommendedNextStep?: string | null;
  modelVersion: string;
  cached: boolean;
  createdAt: string;
}

export interface PipelineCard {
  id: string;
  title: string;
  productClusterId: string | null;
}
export interface PipelineColumn {
  id: string;
  label: string;
  cards: PipelineCard[];
}

export interface Alert {
  id: string;
  productClusterId: string | null;
  alertType: string;
  severity: string;
  message: string;
  createdAt: string;
  status: string;
}

export interface SourceStatus {
  source: string;
  online: boolean;
  lastCollectedAt: string | null;
}

export type TimeWindow = '24h' | '7d' | '30d' | '60d' | '3m' | '6m' | 'all';
export const TIME_WINDOWS: TimeWindow[] = ['7d', '30d', '60d', '3m', '6m', 'all'];
export const DEFAULT_WINDOW: TimeWindow = '6m';

export interface CopilotChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  id?: string;
  timestamp?: string;
  createdAt?: string;
  toolCallsExecuted?: number;
  groundedAt?: string;
}

export interface CopilotChatRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  conversationId?: string;
  clientId?: string;
  scope?: Record<string, unknown>;
}

export interface CopilotChatResponse {
  reply: string;
  conversationId: string;
  toolCallsExecuted: number;
  groundedAt: string;
}

export interface CopilotConversationSummary {
  id: string;
  title: string;
  isPinned: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotConversationUpdate {
  title?: string;
  isPinned?: boolean;
}

export interface CopilotConversationDetail extends CopilotConversationSummary {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    toolCalls?: unknown;
    createdAt: string;
  }>;
}
