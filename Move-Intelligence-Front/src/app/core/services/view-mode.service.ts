import { Injectable, signal } from '@angular/core';

export type RankingViewMode = 'table' | 'cards';

const RANKING_VIEW_KEY = 'move:ranking-view';

@Injectable({ providedIn: 'root' })
export class ViewModeService {
  readonly viewMode = signal<RankingViewMode>(this.readViewMode());

  setViewMode(viewMode: RankingViewMode): void {
    this.viewMode.set(viewMode);
    try {
      window.localStorage.setItem(RANKING_VIEW_KEY, viewMode);
    } catch {
      // A preferência continua válida nesta sessão quando o storage está indisponível.
    }
  }

  private readViewMode(): RankingViewMode {
    try {
      const stored = window.localStorage.getItem(RANKING_VIEW_KEY);
      return stored === 'cards' || stored === 'table' ? stored : 'table';
    } catch {
      return 'table';
    }
  }
}
