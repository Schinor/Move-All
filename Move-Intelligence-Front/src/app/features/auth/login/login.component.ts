import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BrandMarkComponent } from '../../../shared/ui/brand-mark/brand-mark.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BrandMarkComponent, IconComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent {
  readonly email = signal('');
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly submitted = signal(false);
  readonly message = signal('');

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
    this.message.set('A autenticação ainda não está conectada neste ambiente.');
  }

  private isEmailValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim());
  }
}
