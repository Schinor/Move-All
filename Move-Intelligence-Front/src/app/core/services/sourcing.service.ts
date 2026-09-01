import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { SourcingSummary, Supplier } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class SourcingService {
  private readonly api = inject(ApiClient);

  suppliers(): Observable<Supplier[]> {
    return this.api.get<Supplier[]>('/suppliers');
  }

  summary(): Observable<SourcingSummary> {
    return this.api.get<SourcingSummary>('/sourcing/summary');
  }

  /** Fornecedores de um produto. Sourcing global lista por produto em foco. */
  forProduct(productId: string): Observable<Supplier[]> {
    return this.api.get<Supplier[]>(`/products/${productId}/suppliers`);
  }
}
