import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Block, Market } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class MarketsService {
  private readonly api = inject(ApiClient);

  list(): Observable<Block<Market>> {
    return this.api.get<Block<Market>>('/markets');
  }
}
