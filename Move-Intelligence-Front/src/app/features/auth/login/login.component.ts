import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  readonly email = signal('');
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly loading = signal(false);

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit(): void {
    if (!this.email() || !this.password()) return;
    this.loading.set(true);
    // TODO: integrar com AuthService
    setTimeout(() => this.loading.set(false), 1500);
  }
}
