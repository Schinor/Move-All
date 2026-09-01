import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Layout wrapper para as páginas de autenticação.
 * Renderiza apenas o router-outlet, sem sidebar nem topbar.
 */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: [':host { display: block; min-height: 100vh; }'],
})
export class AuthLayoutComponent {}
