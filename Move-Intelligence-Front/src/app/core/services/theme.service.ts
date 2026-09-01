import { Injectable, signal } from '@angular/core';

type Theme = 'dark' | 'light';

/** Controla o tema estampando data-theme no <html> (dark-first). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>('dark');

  constructor() {
    this.apply(this.theme());
  }

  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.apply(next);
  }

  private apply(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
