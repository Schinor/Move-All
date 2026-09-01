import { Injectable, signal } from '@angular/core';

const SIDEBAR_OPEN_KEY = 'move-intelligence:sidebar-open';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarOpen = signal(this.readSidebarOpen());

  toggleSidebar(): void {
    this.setSidebarOpen(!this.sidebarOpen());
  }

  closeSidebar(): void {
    this.setSidebarOpen(false);
  }

  private setSidebarOpen(isOpen: boolean): void {
    this.sidebarOpen.set(isOpen);
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, String(isOpen));
    } catch {
      // A preferência visual continua válida apenas nesta sessão quando o storage está indisponível.
    }
  }

  private readSidebarOpen(): boolean {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_OPEN_KEY);
      if (stored !== null) return stored === 'true';
      return window.innerWidth > 1024;
    } catch {
      return true;
    }
  }
}
