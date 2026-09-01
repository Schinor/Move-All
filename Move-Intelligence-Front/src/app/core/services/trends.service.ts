import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import {
  DEFAULT_WINDOW,
  AiRecommendationResult,
  MonteCarloAiPremisesRequest,
  MonteCarloAiPremisesResult,
  MonteCarloDefaults,
  MonteCarloSimulationRequest,
  MonteCarloSimulationResult,
  Series,
  Supplier,
  TimeWindow,
  TrendProduct,
  TrendProductDetail,
} from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class TrendsService {
  private readonly api = inject(ApiClient);

  listProducts(opts?: { sort?: string; category?: string; limit?: number }): Observable<TrendProduct[]> {
    return this.api.get<TrendProduct[]>('/trends/products', {
      sort: opts?.sort,
      category: opts?.category,
      limit: opts?.limit,
    });
  }

  getProduct(id: string): Observable<TrendProductDetail> {
    return this.api.get<TrendProductDetail>(`/trends/products/${id}`);
  }

  priceHistory(id: string, window: TimeWindow = DEFAULT_WINDOW): Observable<Series> {
    return this.api.get<Series>(`/products/${id}/price-history`, { window });
  }

  reviewHistory(id: string, window: TimeWindow = DEFAULT_WINDOW): Observable<Series> {
    return this.api.get<Series>(`/products/${id}/review-history`, { window });
  }

  volumeHistory(id: string, window: TimeWindow = DEFAULT_WINDOW): Observable<Series> {
    return this.api.get<Series>(`/products/${id}/volume-history`, { window });
  }

  suppliers(id: string): Observable<Supplier[]> {
    return this.api.get<Supplier[]>(`/products/${id}/suppliers`);
  }

  monteCarloDefaults(id: string): Observable<MonteCarloDefaults> {
    return this.api.get<MonteCarloDefaults>(`/products/${id}/monte-carlo/defaults`);
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
