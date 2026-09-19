import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CardListing, CatalogFamily, ReviewCounts, ReviewListingItem, ReviewTypeItem } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly api = inject(ApiClient);

  cardListings(id: string): Observable<CardListing[]> {
    return this.api.get<CardListing[]>(`/catalog/cards/${id}/listings`);
  }
  searchCards(q: string): Observable<Array<{ id: string; name: string; category: string | null; cardStatus: string }>> {
    return this.api.get('/catalog/cards', { q });
  }
  families(): Observable<CatalogFamily[]> {
    return this.api.get<CatalogFamily[]>('/catalog/families');
  }
  reviewCounts(): Observable<ReviewCounts> {
    return this.api.get<ReviewCounts>('/catalog/review/counts');
  }
  reviewList(kind: 'provisional_listing', page?: number): Observable<{ total: number; items: ReviewListingItem[] }>;
  reviewList(kind: 'suggested_type', page?: number): Observable<{ total: number; items: ReviewTypeItem[] }>;
  reviewList(kind: string, page = 1): Observable<{ total: number; items: unknown[] }> {
    return this.api.get('/catalog/review', { kind, page, page_size: 20 });
  }
  confirm(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/confirm`, {}); }
  move(id: string, targetClusterId: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/move`, { targetClusterId }); }
  createCard(id: string, body: { typeKey: string; cardKeyValues: Record<string, string>; name?: string }) {
    return this.api.post<{ decisionId: string; clusterId: string }>(`/catalog/review/${id}/create-card`, body);
  }
  outOfScope(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/review/${id}/out-of-scope`, {}); }
  approveType(id: string, body: { familyKey: string; key: string; namePt: string; ncm?: string }) {
    return this.api.post<{ decisionId: string; typeId: string }>(`/catalog/types/suggestions/${id}/approve`, body);
  }
  mergeType(id: string, typeKey: string) { return this.api.post<{ decisionId: string; requeued: number }>(`/catalog/types/suggestions/${id}/merge`, { typeKey }); }
  discardType(id: string) { return this.api.post<{ decisionId: string }>(`/catalog/types/suggestions/${id}/discard`, {}); }
  renameCard(id: string, name: string) { return this.api.patch<{ decisionId: string }>(`/catalog/cards/${id}`, { name }); }
  undo(decisionId: string) { return this.api.post<{ decisionId: string }>(`/catalog/decisions/${decisionId}/undo`, {}); }
}
