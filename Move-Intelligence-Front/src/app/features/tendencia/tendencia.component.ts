import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { AsyncState, toAsyncState } from '../../core/api/async-state';
import { TrendsService } from '../../core/services/trends.service';
import {
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
import { SupplierComparisonTableComponent } from '../../shared/components/intel/supplier-comparison-table/supplier-comparison-table.component';
import { AiRecommendationCardComponent } from '../../shared/components/intel/ai-recommendation-card/ai-recommendation-card.component';
import { SignalSourceCardComponent } from '../../shared/components/intel/signal-source-card/signal-source-card.component';
import { MonteCarloHistogramComponent } from '../../shared/components/intel/monte-carlo-histogram/monte-carlo-histogram.component';
import { PriceCurveChartComponent } from '../../shared/components/intel/price-curve-chart/price-curve-chart.component';
import { UnitEconomicsCalculatorComponent } from '../../shared/components/intel/unit-economics-calculator/unit-economics-calculator.component';
import { CompetitorMatrixComponent } from '../../shared/components/intel/competitor-matrix/competitor-matrix.component';
import { SeasonalityForecastComponent } from '../../shared/components/intel/seasonality-forecast/seasonality-forecast.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { categoryLabel, premiseSourceLabel } from '../../shared/util/format';

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
    SupplierComparisonTableComponent,
    AiRecommendationCardComponent,
    MonteCarloHistogramComponent,
    PriceCurveChartComponent,
    UnitEconomicsCalculatorComponent,
    CompetitorMatrixComponent,
    SeasonalityForecastComponent,
    IconComponent,
  ],
  templateUrl: './tendencia.component.html',
  styleUrl: './tendencia.component.css',
})
export class TendenciaComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly trends = inject(TrendsService);

  readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  readonly window = signal<TimeWindow>(DEFAULT_WINDOW);
  readonly activeTab = signal('adoption');
  readonly simulation = signal<AsyncState<MonteCarloSimulationResult> | null>(null);
  readonly aiPremises = signal<AsyncState<MonteCarloAiPremisesResult> | null>(null);
  readonly simulationDefaults = toAsyncState(this.trends.monteCarloDefaults(this.id));
  readonly premiseForm = signal<Partial<Record<PremiseKey, number>>>({});
  readonly scenarioCount = signal(1_000_000);
  readonly priceScan = signal(true);
  readonly aiNotes = signal('');
  readonly tabs: TabItem[] = [
    { id: 'adoption', label: 'Adoção' },
    { id: 'economics', label: 'Unit Economics' },
    { id: 'competitors', label: 'Concorrência' },
    { id: 'seasonality', label: 'Sazonalidade' },
    { id: 'sourcing', label: 'Sourcing' },
    { id: 'simulation', label: 'Simulação' },
    { id: 'decision', label: 'Decisão' },
  ];

  readonly historyMetric = signal<'volume' | 'price' | 'review'>('volume');

  readonly product = toAsyncState(this.trends.getProduct(this.id));
  readonly suppliers = toAsyncState(this.trends.suppliers(this.id));
  readonly priceHistory = toAsyncState(
    toObservable(this.window).pipe(switchMap((w) => this.trends.priceHistory(this.id, w))),
  );
  readonly volumeHistory = toAsyncState(
    toObservable(this.window).pipe(switchMap((w) => this.trends.volumeHistory(this.id, w))),
  );
  readonly reviewHistory = toAsyncState(
    toObservable(this.window).pipe(switchMap((w) => this.trends.reviewHistory(this.id, w))),
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
    return labels[key] ?? key.replace(/([A-Z])/g, ' $1').trim();
  }

  setWindow(w: TimeWindow): void {
    this.window.set(w);
  }

  setTab(tab: string): void {
    this.activeTab.set(tab);
  }

  setHistoryMetric(metric: 'volume' | 'price' | 'review'): void {
    this.historyMetric.set(metric);
  }

  runMonteCarlo(): void {
    const request = {
      premises: this.toSnakePremises(this.currentPremises()),
      scenario_count: this.scenarioCount(),
      price_scan: this.priceScan(),
      price_scan_scenarios: 4_000,
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
