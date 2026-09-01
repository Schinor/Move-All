import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Block, DEFAULT_WINDOW, Signal, SignalSource, TimeWindow } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class SignalsService {
  private readonly api = inject(ApiClient);

  feed(opts?: { window?: TimeWindow; category?: string }): Observable<Block<Signal>> {
    return this.api.get<Block<Signal>>('/signals', {
      window: opts?.window ?? DEFAULT_WINDOW,
      category: opts?.category,
    });
  }

  sources(): Observable<SignalSource[]> {
    return this.api.get<SignalSource[]>('/signals/sources');
  }
}
