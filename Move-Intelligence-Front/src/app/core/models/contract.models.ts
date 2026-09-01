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

export interface TrendProduct {
  productClusterId: string;
  canonicalName: string;
  category: string | null;
  imageUrl: string | null;
  trendScore: Indicator;
  opportunityScore: Indicator;
  westernSaturationScore: Indicator;
  marginEstimate: Indicator;
  risk: RiskLevel | null;
  mainSources: string[];
  recommendation: string | null;
  /** Campos de apresentação usados pelos cards (opcionais até o backend calcular). */
  stage: TrendStage | null;
  spark: number[] | null;
  growthPct: number | null;
  marginPct: number | null;
  leadTimeDays: number | null;
  projectedRevenue: number | null;
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
}

export interface SeriesPoint {
  t: string;
  v: number;
}
export interface Series {
  window: string;
  points: SeriesPoint[];
}

export interface Supplier {
  id: string;
  name: string;
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
  totalMonthlySales?: number;
  total_monthly_sales?: number;
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

export type PremiseSource =
  | 'csv'
  | 'exchange_rate'
  | 'default'
  | 'derived_default'
  | 'override'
  | 'ai_suggestion';

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
}

export interface MonteCarloSimulationRequest {
  premises?: Partial<Record<string, number | number[]>>;
  scenario_count?: number;
  seed?: number;
  price_scan?: boolean;
  price_scan_scenarios?: number;
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
  opportunityScore: Indicator;
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

export type TimeWindow = '24h' | '7d' | '30d' | '3m' | '6m' | 'all';
export const TIME_WINDOWS: TimeWindow[] = ['7d', '30d', '3m', '6m', 'all'];
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
