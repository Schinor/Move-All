import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { BlockStatus, PipelineColumn } from '../models/contract.models';

export interface PipelineBoard {
  status: BlockStatus;
  columns: PipelineColumn[];
}

@Injectable({ providedIn: 'root' })
export class PipelineService {
  private readonly api = inject(ApiClient);

  board(): Observable<PipelineBoard> {
    return this.api.get<PipelineBoard>('/pipeline');
  }
}
