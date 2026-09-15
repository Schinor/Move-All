import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { BrandLockupComponent } from '../../../shared/ui/brand-lockup/brand-lockup.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BrandLockupComponent, IconComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly email = signal('');
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly submitted = signal(false);
  readonly message = signal('');
  readonly loading = signal(false);

  readonly emailError = computed(() => {
    if (!this.submitted()) return '';
    if (!this.email().trim()) return 'Informe seu e-mail.';
    return this.isEmailValid() ? '' : 'Informe um e-mail válido.';
  });

  readonly passwordError = computed(() =>
    this.submitted() && !this.password() ? 'Informe sua senha.' : '',
  );

  togglePassword(): void {
    this.showPassword.update((value) => !value);
  }

  onSubmit(): void {
    this.submitted.set(true);
    this.message.set('');
    if (this.emailError() || this.passwordError()) {
      document.getElementById(this.emailError() ? 'email' : 'password')?.focus();
      return;
    }
    if (this.loading()) return;
    this.loading.set(true);
    this.auth.login(this.email().trim(), this.password()).subscribe({
      next: () => {
        this.loading.set(false);
        const redirect = this.route.snapshot.queryParamMap.get('redirect');
        void this.router.navigateByUrl(redirect || '/');
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.message.set(this.toErrorMessage(error));
      },
    });
  }

  private isEmailValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim());
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401) return 'E-mail ou senha inválidos.';
      if (typeof error.error === 'string' && error.error.trim()) return error.error;
      const backendMessage = (error.error as { message?: unknown } | null)?.message;
      if (typeof backendMessage === 'string' && backendMessage.trim()) return backendMessage;
      if (Array.isArray(backendMessage) && typeof backendMessage[0] === 'string') return backendMessage[0];
    }
    return 'Não foi possível entrar. Tente novamente.';
  }
}
