import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { LayoutService } from './core/services/layout.service';
import { AppSidebarComponent } from './shared/layout/app-sidebar/app-sidebar.component';
import { TopBarComponent } from './shared/layout/top-bar/top-bar.component';

const AUTH_ROUTES = ['/login', '/cadastro'];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AppSidebarComponent, TopBarComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  readonly layout = inject(LayoutService);

  /** Retorna true quando a URL atual pertence ao fluxo de autenticação. */
  readonly isAuthRoute = toSignal(
    this.router.events.pipe(
      map(() => AUTH_ROUTES.some((r) => this.router.url.startsWith(r))),
    ),
    { initialValue: AUTH_ROUTES.some((r) => this.router.url.startsWith(r)) },
  );
}
