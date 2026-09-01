import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Alert, SourceStatus } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class AlertsService {
  private readonly api = inject(ApiClient);

  list(): Observable<Alert[]> {
    return this.api.get<Alert[]>('/alerts');
  }

  sourcesStatus(): Observable<SourceStatus[]> {
    return this.api.get<SourceStatus[]>('/sources/status');
  }
}
