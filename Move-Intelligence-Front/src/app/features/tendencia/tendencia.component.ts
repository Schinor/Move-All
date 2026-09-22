import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AsyncState, toAsyncState } from '../../core/api/async-state';
import { TrendsService } from '../../core/services/trends.service';
import {
  CardOffer,
  CardOffers,
  DEFAULT_WINDOW,
  MonteCarloAiPremisesResult,
  MonteCarloDefaults,
  MonteCarloPremises,
  MonteCarloSimulationResult,
  TimeWindow,
} from '../../core/models/contract.models';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card/kpi-card.component';
import { WindowSelectorComponent } from '../../shared/ui/window-selector/window-selector.component';
import { ProductImageComponent } from '../../shared/ui/product-image/product-image.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { TabsComponent, TabItem } from '../../shared/ui/tabs/tabs.component';
import { SparklineComponent } from '../../shared/components/intel/sparkline/sparkline.component';
import { ScoreGaugeComponent } from '../../shared/components/intel/score-gauge/score-gauge.component';
import { OpportunityRadarComponent } from '../../shared/components/intel/opportunity-radar/opportunity-radar.component';
import { AdoptionCurveChartComponent } from '../../shared/components/intel/adoption-curve-chart/adoption-curve-chart.component';
import { SearchTrendChartComponent } from '../../shared/components/intel/search-trend-chart/search-trend-chart.component';
import { ReviewSentimentChartComponent } from '../../shared/components/intel/review-sentiment-chart/review-sentiment-chart.component';
import { AiRecommendationCardComponent } from '../../shared/components/intel/ai-recommendation-card/ai-recommendation-card.component';
import { SignalSourceCardComponent } from '../../shared/components/intel/signal-source-card/signal-source-card.component';
import { MonteCarloHistogramComponent } from '../../shared/components/intel/monte-carlo-histogram/monte-carlo-histogram.component';
import { PriceCurveChartComponent } from '../../shared/components/intel/price-curve-chart/price-curve-chart.component';
import { UnitEconomicsCalculatorComponent } from '../../shared/components/intel/unit-economics-calculator/unit-economics-calculator.component';
import { CompetitorMatrixComponent } from '../../shared/components/intel/competitor-matrix/competitor-matrix.component';
import { CardListingsTableComponent } from '../../shared/components/intel/card-listings-table/card-listings-table.component';
import { SeasonalityForecastComponent } from '../../shared/components/intel/seasonality-forecast/seasonality-forecast.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { AuthService } from '../../core/auth/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { comparisonCountText, listingsText } from '../../shared/util/card-format';
import { categoryLabel, dataConfidenceLabel, decisionLabel, premiseSourceLabel, actionTooltip, scoreBandLabel, socialSignalLabel, sourceLabel } from '../../shared/util/format';
import { offerLabel, offerStateLabel, offerStoreCount } from '../../shared/util/offer-format';
import { filterByMarketplace, marketplaceChips } from '../../shared/util/marketplace-filter';

type PremiseKey = keyof MonteCarloPremises;

interface PremiseField {
  key: PremiseKey;
  label: string;
  step: string;
}

@Component({
  selector: 'app-tendencia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    StatePanelComponent,
    KpiCardComponent,
    WindowSelectorComponent,
    ProductImageComponent,
    RiskBadgeComponent,
    TabsComponent,
    SparklineComponent,
    ScoreGaugeComponent,
    OpportunityRadarComponent,
    AdoptionCurveChartComponent,
    SearchTrendChartComponent,
    ReviewSentimentChartComponent,
    AiRecommendationCardComponent,
    MonteCarloHistogramComponent,
    PriceCurveChartComponent,
    UnitEconomicsCalculatorComponent,
    CompetitorMatrixComponent,
    CardListingsTableComponent,
    SeasonalityForecastComponent,
    IconComponent,
    DecimalPipe,
  ],
  templateUrl: './tendencia.component.html',
  styleUrl: './tendencia.component.css',
})
export class TendenciaComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly trends = inject(TrendsService);
  private readonly auth = inject(AuthService);
  private readonly catalog = inject(CatalogService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly window = signal<TimeWindow>(DEFAULT_WINDOW);
  readonly activeTab = signal('adoption');
  readonly simulation = signal<AsyncState<MonteCarloSimulationResult> | null>(null);
  readonly aiPremises = signal<AsyncState<MonteCarloAiPremisesResult> | null>(null);
  readonly selectedOfferKey = signal<string | null>(null);
  readonly simulationDefaults = toAsyncState(
    toObservable(this.selectedOfferKey).pipe(
      switchMap((key) => this.trends.monteCarloDefaults(this.id, key ?? undefined)),
    ),
  );
  readonly premiseForm = signal<Partial<Record<PremiseKey, number>>>({});
  readonly scenarioCount = signal(1_000_000);
  readonly priceScan = signal(true);
  readonly aiNotes = signal('');
  readonly tabs: TabItem[] = [
    { id: 'adoption', label: 'Adoção' },
    { id: 'economics', label: 'Unit Economics' },
    { id: 'competitors', label: 'Anúncios' },
    { id: 'seasonality', label: 'Sazonalidade' },
    { id: 'sourcing', label: 'Ofertas' },
    { id: 'simulation', label: 'Simulação' },
    { id: 'decision', label: 'Decisão' },
  ];

  readonly historyMetric = signal<'volume' | 'price' | 'review'>('volume');
  readonly adoptionView = signal<'history' | 'search'>('history');
  readonly comparePrevious = signal(false);

  readonly product = toAsyncState(this.trends.getProduct(this.id));
  readonly searchTrends = toAsyncState(this.trends.searchTrends(this.id));
  readonly isAdmin = computed(() => this.auth.currentUser()?.role === 'ADMIN');
  readonly countText = comparisonCountText;
  readonly listingsText = listingsText;
  private readonly redirectMerged = effect(() => {
    const target = (this.product() as unknown as { data?: { mergedIntoId?: string } })?.data?.mergedIntoId;
    if (target && typeof window !== 'undefined') window.location.replace(`/tendencia/${target}`);
  });
  readonly offers = toAsyncState(this.trends.offers(this.id), (v: CardOffers) => v.offers.length === 0);
  readonly offerMarketplace = signal<string | null>(null);
  readonly offerChips = computed(() => {
    const state = this.offers();
    return state.status === 'ready'
      ? marketplaceChips(state.data.offers, (offer) => offer.marketplace, (marketplace) => this.sourceName(marketplace))
      : [];
  });
  readonly visibleOffers = computed(() => {
    const state = this.offers();
    return state.status === 'ready'
      ? filterByMarketplace(state.data.offers, (offer) => offer.marketplace, this.offerMarketplace())
      : [];
  });
  readonly offerLabel = offerLabel;
  readonly offerStateLabel = offerStateLabel;
  readonly offerStoreCount = offerStoreCount;
  readonly simulatableOffers = computed(() => {
    const state = this.offers();
    return state.status === 'ready' ? state.data.offers.filter((o) => o.state === 'com_score') : [];
  });
  private readonly historyParams$ = combineLatest([toObservable(this.window), toObservable(this.comparePrevious)]).pipe(
    map(([w, c]) => ({ w, c: c ? ('previous' as const) : undefined })),
  );
  readonly priceHistory = toAsyncState(
    this.historyParams$.pipe(switchMap(({ w, c }) => this.trends.priceHistory(this.id, w, c))),
  );
  readonly volumeHistory = toAsyncState(
    this.historyParams$.pipe(switchMap(({ w, c }) => this.trends.volumeHistory(this.id, w, c))),
  );
  readonly reviewHistory = toAsyncState(
    this.historyParams$.pipe(switchMap(({ w, c }) => this.trends.reviewHistory(this.id, w, c))),
  );
  /** Avaliações positivas/neutras/negativas por semana (só a janela; sem período anterior). */
  readonly reviewSentiment = toAsyncState(
    toObservable(this.window).pipe(switchMap((w) => this.trends.reviewSentiment(this.id, w))),
    (data) => !data?.points?.length,
  );
  readonly aiRecommendation = toAsyncState(this.trends.aiRecommendation(this.id));

  readonly currentHistory = computed(() => {
    const metric = this.historyMetric();
    if (metric === 'price') return this.priceHistory();
    if (metric === 'review') return this.reviewHistory();
    return this.volumeHistory();
  });

  readonly signalEntries = computed(() => {
    const state = this.product();
    if (state.status !== 'ready') {
      return [];
    }
    return Object.entries(state.data.signals ?? {});
  });
  readonly premiseGroups: { title: string; fields: PremiseField[] }[] = [
    {
      title: 'Decisões',
      fields: [
        { key: 'precoVenda', label: 'Preço de venda (R$)', step: '1' },
        { key: 'tmaMensal', label: 'TMA mensal', step: '0.001' },
        { key: 'folgaEstoque', label: 'Folga de estoque', step: '0.01' },
        { key: 'horizonteMeses', label: 'Horizonte (meses)', step: '1' },
      ],
    },
    {
      title: 'Mercado',
      fields: [
        { key: 'precoReferencia', label: 'Preço referência (R$)', step: '1' },
        { key: 'demandaReferencia', label: 'Demanda referência', step: '1' },
        { key: 'elasticidade', label: 'Elasticidade', step: '0.1' },
      ],
    },
    {
      title: 'Importação',
      fields: [
        { key: 'custoUsd', label: 'Custo unitário (US$)', step: '0.01' },
        { key: 'qtdMinimaPedido', label: 'Pedido mínimo (un.)', step: '1' },
        { key: 'freteUsdUnidade', label: 'Frete internacional (US$)', step: '0.01' },
        { key: 'impostoImportacao', label: 'Imposto importação', step: '0.01' },
        { key: 'cambioBase', label: 'Câmbio USD/BRL', step: '0.01' },
        { key: 'marketingInicial', label: 'Marketing inicial (R$)', step: '100' },
      ],
    },
    {
      title: 'Venda e operação',
      fields: [
        { key: 'comissaoMarketplace', label: 'Comissão marketplace', step: '0.01' },
        { key: 'impostoVenda', label: 'Imposto venda', step: '0.01' },
        { key: 'freteCliente', label: 'Frete cliente (R$)', step: '0.5' },
        { key: 'custoFixoMensal', label: 'Custo fixo mensal (R$)', step: '50' },
        { key: 'leadTimeDias', label: 'Lead time (dias)', step: '1' },
        { key: 'fracaoSalvage', label: 'Salvage estoque', step: '0.01' },
      ],
    },
    {
      title: 'Incertezas',
      fields: [
        { key: 'volCambio', label: 'Volatilidade câmbio', step: '0.01' },
        { key: 'volPreco', label: 'Volatilidade preço', step: '0.01' },
        { key: 'volDemanda', label: 'Volatilidade demanda', step: '0.01' },
        { key: 'volLead', label: 'Volatilidade lead', step: '0.01' },
        { key: 'corrCambioLead', label: 'Correlação câmbio/lead', step: '0.01' },
      ],
    },
  ];

  signalLabel(key: string): string {
    const labels: Record<string, string> = {
      marketplaceGrowth: 'Marketplace',
      supplierGrowth: 'Fornecedores',
      priceOpportunity: 'Preço FOB',
      reviewVelocity: 'Reviews',
      searchGrowth: 'Busca',
      socialBuzz: 'Social',
    };
    if (labels[key]) return labels[key];
    // Sinais de demanda por país (ex.: googleTrends_BR → "Google Trends BR").
    const byCountry = /^([a-z]+(?:[A-Z][a-z]+)*)_([A-Z]{2})$/.exec(key);
    if (byCountry) {
      const base = byCountry[1].replace(/([A-Z])/g, ' $1').trim();
      return `${base.charAt(0).toUpperCase()}${base.slice(1)} ${byCountry[2]}`;
    }
    return key.replace(/([A-Z])/g, ' $1').trim();
  }

  /** Move Score ou, sem score, o rótulo da confiança (sem número). */
  moveScoreText(data: any): string {
    if (data?.moveScore === null || data?.moveScore === undefined) {
      return dataConfidenceLabel(data?.dataConfidence);
    }
    return String(data.moveScore);
  }

  moveDecisionText(data: any): string {
    return decisionLabel(data?.action ?? data?.decision) || 'Sem ação calculada';
  }

  moveConfidenceText(data: any): string {
    return dataConfidenceLabel(data?.dataConfidence);
  }

  moveProbabilityText(data: any): string {
    const value = data?.pVplPositivo;
    if (value === null || value === undefined) return '—';
    return `${Math.round(Number(value) * 100)}%`;
  }

  moveCvarText(data: any): string {
    const value = data?.cvar5;
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(Number(value));
  }

  setWindow(w: TimeWindow): void {
    this.window.set(w);
  }

  setTab(tab: string): void {
    this.activeTab.set(tab);
  }

  selectSimulationOffer(key: string | null): void {
    this.selectedOfferKey.set(key);
    this.premiseForm.set({});
    this.simulation.set(null);
    this.aiPremises.set(null);
  }

  simulateOffer(offer: CardOffer): void {
    this.selectSimulationOffer(offer.key);
    this.setTab('simulation');
  }

  setHistoryMetric(metric: 'volume' | 'price' | 'review'): void {
    this.adoptionView.set('history');
    this.historyMetric.set(metric);
  }

  setAdoptionView(view: 'history' | 'search'): void {
    this.adoptionView.set(view);
  }

  toggleComparePrevious(event: Event): void {
    this.comparePrevious.set((event.target as HTMLInputElement).checked);
  }

  /** D4: ação e faixa no topo, com tooltip "O que fazer". */
  actionTooltipText(data: any): string {
    return actionTooltip(data?.action) || 'Ação ainda não calculada: o produto não tem Move Score e momentum suficientes.';
  }

  /** Faixa do Move Score em português (a API envia green/yellow/red). */
  bandText(data: any): string {
    return scoreBandLabel(data?.scoreBand) || '—';
  }

  sourceName(source: string | null | undefined): string {
    return sourceLabel(source) || '—';
  }

  /** D4: badge de risco com causas no hover e no toque (title + aria). */
  riskTitle(data: any): string {
    return data?.riskExplanation?.text ?? 'Sem explicação de risco';
  }

  /** D4: "Sinal social indisponível" quando aplicável (B6). */
  socialText(data: any): string {
    return socialSignalLabel(data?.tiktokGrowthPct);
  }

  previousPoints(): Array<{ t: string; v: number }> {
    const state = this.currentHistory();
    if (state.status !== 'ready') return [];
    const data = state.data as unknown as { previous?: Array<{ t: string; v: number }> };
    return data.previous ?? [];
  }

  currentPoints(): Array<{ t: string; v: number }> {
    const state = this.currentHistory();
    if (state.status !== 'ready') return [];
    const data = state.data as unknown as { points?: Array<{ t: string; v: number }>; current?: Array<{ t: string; v: number }> };
    return data.points ?? data.current ?? [];
  }

  reviewBands(data: any): Array<{ band: string; summary: string; top_reasons: unknown; sample_size: number }> {
    const byBand = data?.reviewSummary?.by_band ?? {};
    return Object.entries(byBand).map(([band, v]) => ({ band, ...(v as { summary: string; top_reasons: unknown; sample_size: number }) }));
  }

  /** D5: "Detectado em: Amazon BR · Mercado Livre · Alibaba" com nomes comerciais. */
  detectedText(data: any): string {
    const sources: string[] = data?.detectedOn ?? data?.detected_on ?? data?.mainSources ?? [];
    if (!sources.length) return '—';
    return sources.map((s) => sourceLabel(s)).join(' · ');
  }

  rename(currentName: string): void {
    const name = window.prompt('Novo nome do card', currentName)?.trim();
    if (!name || name === currentName || name.length < 3) return;
    this.catalog.renameCard(this.id, name).subscribe({ next: () => window.location.reload() });
  }

  runMonteCarlo(): void {
    const request = {
      premises: this.toSnakePremises(this.currentPremises()),
      scenario_count: this.scenarioCount(),
      price_scan: this.priceScan(),
      price_scan_scenarios: 4_000,
      offer_key: this.selectedOfferKey() ?? undefined,
    };
    this.simulation.set({ status: 'loading' });
    this.trends.monteCarloSimulation(this.id, request).subscribe({
      next: (data) => this.simulation.set({ status: 'ready', data }),
      error: () =>
        this.simulation.set({
          status: 'error',
          error: 'Não foi possível rodar a simulação agora.',
        }),
    });
  }

  exportDossier(format: 'pdf' | 'csv'): void {
    if (!this.id) return;
    const url = `/api/products/${this.id}/export/${format}`;
    window.open(url, '_blank');
  }

  fillPremisesWithAi(): void {
    const request = {
      premises: this.toSnakePremises(this.currentPremises()),
      user_notes: this.aiNotes().trim() || undefined,
    };
    this.aiPremises.set({ status: 'loading' });
    this.trends.monteCarloAiPremises(this.id, request).subscribe({
      next: (data) => {
        this.aiPremises.set({ status: 'ready', data });
        this.applyAiPremises(data.premises);
      },
      error: () =>
        this.aiPremises.set({
          status: 'error',
          error: 'Não foi possível preencher as premissas com IA agora.',
        }),
    });
  }

  premiseValue(key: PremiseKey): number | null {
    return this.currentPremises()[key] ?? null;
  }

  humanize(value: string | null | undefined): string {
    return categoryLabel(value);
  }

  premiseSource(key: PremiseKey): string {
    const aiState = this.aiPremises();
    if (aiState?.status === 'ready' && aiState.data.premiseSources[key]) {
      return premiseSourceLabel(aiState.data.premiseSources[key]);
    }
    const state = this.simulationDefaults();
    return premiseSourceLabel(
      state.status === 'ready' ? state.data.premiseSources[key] : undefined,
    );
  }

  updatePremise(key: PremiseKey, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.premiseForm.update((form) => ({ ...form, [key]: value }));
  }

  updateScenarioCount(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) {
      this.scenarioCount.set(Math.max(100, Math.round(value)));
    }
  }

  updatePriceScan(event: Event): void {
    this.priceScan.set((event.target as HTMLInputElement).checked);
  }

  updateAiNotes(event: Event): void {
    this.aiNotes.set((event.target as HTMLTextAreaElement).value);
  }

  private applyAiPremises(premises: MonteCarloPremises): void {
    const updates: Partial<Record<PremiseKey, number>> = {};
    for (const [key, value] of Object.entries(premises) as [
      PremiseKey,
      number | number[],
    ][]) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        updates[key] = value;
      }
    }
    this.premiseForm.set(updates);
  }

  private currentPremises(): Partial<Record<PremiseKey, number>> {
    const defaults = this.simulationDefaults();
    const base = defaults.status === 'ready' ? defaults.data.premises : {};
    return { ...base, ...this.premiseForm() };
  }

  private toSnakePremises(
    premises: Partial<Record<PremiseKey, number>>,
  ): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(premises)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] = value;
      }
    }
    return out;
  }

  formatBRL(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(value);
  }

  formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return new Intl.NumberFormat('pt-BR', {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value);
  }
}
