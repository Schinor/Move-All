import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'move:theme';

/** Preferência visual persistida, com o sistema como estado inicial honesto. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.readTheme());

  constructor() {
    this.apply(this.theme());
    this.watchSystemTheme();
  }

  toggle(): void {
    const current = this.theme();
    const next: Theme = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    this.setTheme(next);
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // A preferência continua válida nesta sessão quando o storage está indisponível.
    }
  }

  label(): string {
    const current = this.theme();
    return current === 'system'
      ? 'sistema'
      : current === 'light'
        ? 'claro'
        : 'escuro';
  }

  /** O ícone mostra o tema ATUAL, igual ao texto de label(), e não o próximo. */
  icon(): 'contrast' | 'moon' | 'monitor' {
    const current = this.theme();
    if (current === 'light') return 'contrast';
    if (current === 'dark') return 'moon';
    return 'monitor';
  }

  private apply(theme: Theme): void {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    document.documentElement.setAttribute('data-theme', theme);
  }

  private readTheme(): Theme {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  private watchSystemTheme(): void {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      if (this.theme() === 'system') this.apply('system');
    };
    media.addEventListener?.('change', onChange);
  }
}
