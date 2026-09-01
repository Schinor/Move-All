import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Block, Recommendation } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly api = inject(ApiClient);

  list(): Observable<Block<Recommendation>> {
    return this.api.get<Block<Recommendation>>('/recommendations');
  }
}
