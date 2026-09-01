import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { DashboardSummary } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiClient);

  summary(): Observable<DashboardSummary> {
    return this.api.get<DashboardSummary>('/dashboard/summary');
  }
}
