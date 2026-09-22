import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { DiscoveryTerm, DiscoveryTermCounts } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class DiscoveryTermsService {
  private readonly api = inject(ApiClient);

  list(filters: { status: string; geo?: string; family?: string }): Observable<DiscoveryTerm[]> {
    const params: Record<string, string> = { status: filters.status };
    if (filters.geo) params['geo'] = filters.geo;
    if (filters.family) params['family'] = filters.family;
    return this.api.get<DiscoveryTerm[]>('/discovery/terms', params);
  }

  counts(): Observable<DiscoveryTermCounts> {
    return this.api.get<DiscoveryTermCounts>('/discovery/terms/counts');
  }

  approve(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/approve`, {}); }
  ignore(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/ignore`, {}); }
  restore(id: string) { return this.api.post<{ id: string; status: string }>(`/discovery/terms/${id}/restore`, {}); }
}
