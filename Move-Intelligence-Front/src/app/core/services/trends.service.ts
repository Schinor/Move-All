import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ReviewSentiment, ExecutiveRecommendationItem,
  DEFAULT_WINDOW,
  AiRecommendationResult,
  CardOffers,
  MonteCarloAiPremisesRequest,
  MonteCarloAiPremisesResult,
  MonteCarloDefaults,
  MonteCarloSimulationRequest,
  MonteCarloSimulationResult,
  SearchTrends,
  Series,
  Supplier,
  TimeWindow,
  TrendProduct,
  TrendProductDetail,
} from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class TrendsService {
  private readonly api = inject(ApiClient);

  listProducts(
    opts?: { sort?: string; dir?: 'asc' | 'desc'; category?: string; limit?: number; page?: number; pageSize?: number; action?: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Observable<any> {
    return this.api.get('/trends/products', {
      sort: opts?.sort,
      dir: opts?.dir,
      category: opts?.category,
      limit: opts?.limit,
      page: opts?.page,
      page_size: opts?.pageSize,
      action: opts?.action,
    });
  }

  searchAll(q: string, limit = 20): Observable<{
    products: Array<{ id: string; name: string; category: string | null; match?: 'nome' | 'objetivo' }>;
    categories: string[];
    suppliers: Array<{ id: string; name: string; source: string }>;
    /** Objetivos reconhecidos na busca (ex.: "Pernas"). */
    topics?: Array<{ key: string; label: string; categories: string[] }>;
  }> {
    return this.api.get('/search', { q, limit });
  }

  executiveRecommendation(): Observable<{
    status: string;
    recommended: ExecutiveRecommendationItem | null;
    alternatives: ExecutiveRecommendationItem[];
  }> {
    return this.api.get('/recommendations/executive', {});
  }

  getProduct(id: string): Observable<TrendProductDetail> {
    return this.api.get<TrendProductDetail>(`/trends/products/${id}`);
  }

  priceHistory(id: string, window: TimeWindow = DEFAULT_WINDOW, compare?: 'previous'): Observable<Series & { current?: Array<{ t: string; v: number }>; previous?: Array<{ t: string; v: number }> }> {
    return this.api.get(`/products/${id}/price-history`, { window, compare });
  }

  reviewHistory(id: string, window: TimeWindow = DEFAULT_WINDOW, compare?: 'previous'): Observable<Series & { current?: Array<{ t: string; v: number }>; previous?: Array<{ t: string; v: number }> }> {
    return this.api.get(`/products/${id}/review-history`, { window, compare });
  }

  /** Avaliações positivas (4–5★), neutras (3★) e negativas (1–2★) por semana + nota média. */
  reviewSentiment(id: string, window: TimeWindow = DEFAULT_WINDOW): Observable<ReviewSentiment> {
    return this.api.get<ReviewSentiment>(`/products/${id}/review-sentiment`, { window });
  }

  volumeHistory(id: string, window: TimeWindow = DEFAULT_WINDOW, compare?: 'previous'): Observable<Series & { current?: Array<{ t: string; v: number }>; previous?: Array<{ t: string; v: number }> }> {
    return this.api.get(`/products/${id}/volume-history`, { window, compare });
  }

  suppliers(id: string): Observable<Supplier[]> {
    return this.api.get<Supplier[]>(`/products/${id}/suppliers`);
  }

  offers(id: string): Observable<CardOffers> {
    return this.api.get<CardOffers>(`/products/${id}/offers`);
  }

  searchTrends(id: string): Observable<SearchTrends> {
    return this.api.get<SearchTrends>(`/products/${id}/search-trends`);
  }

  monteCarloDefaults(id: string, offerKey?: string): Observable<MonteCarloDefaults> {
    return this.api.get<MonteCarloDefaults>(
      `/products/${id}/monte-carlo/defaults`,
      offerKey ? { offer_key: offerKey } : undefined,
    );
  }

  monteCarloSimulation(
    id: string,
    request: MonteCarloSimulationRequest = {},
  ): Observable<MonteCarloSimulationResult> {
    return this.api.post<MonteCarloSimulationResult>(`/products/${id}/monte-carlo`, request);
  }

  monteCarloAiPremises(
    id: string,
    request: MonteCarloAiPremisesRequest = {},
  ): Observable<MonteCarloAiPremisesResult> {
    return this.api.post<MonteCarloAiPremisesResult>(
      `/products/${id}/monte-carlo/ai-premises`,
      request,
    );
  }

  aiRecommendation(id: string): Observable<AiRecommendationResult> {
    return this.api.get<AiRecommendationResult>(`/products/${id}/ai-recommendation`);
  }

  unitEconomicsDefaults(id: string): Observable<any> {
    return this.api.get<any>(`/products/${id}/unit-economics/defaults`);
  }

  simulateUnitEconomics(id: string, request: any): Observable<any> {
    return this.api.post<any>(`/products/${id}/unit-economics/simulate`, request);
  }

  competitors(id: string): Observable<any> {
    return this.api.get<any>(`/products/${id}/competitors`);
  }

  seasonalityForecast(id: string): Observable<any> {
    return this.api.get<any>(`/products/${id}/seasonality-forecast`);
  }

  compareProducts(ids: string[]): Observable<any[]> {
    return this.api.get<any[]>('/products/compare', { ids: ids.join(',') });
  }

  getAlerts(status?: string): Observable<any[]> {
    return this.api.get<any[]>('/alerts', { status });
  }

  getAlertRules(): Observable<any> {
    return this.api.get<any>('/alerts/rules');
  }

  saveAlertRules(rules: any): Observable<any> {
    return this.api.post<any>('/alerts/rules', rules);
  }

  testAlertWebhook(data: { webhookUrl: string; channel: string; telegramChatId?: string }): Observable<any> {
    return this.api.post<any>('/alerts/test-webhook', data);
  }

  scanAlerts(): Observable<any> {
    return this.api.post<any>('/alerts/scan', {});
  }
}
