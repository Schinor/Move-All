import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-cadastro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  templateUrl: './cadastro.component.html',
  styleUrl: './cadastro.component.css',
})
export class CadastroComponent {
  readonly nome = signal('');
  readonly empresa = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly showPassword = signal(false);
  readonly acceptTerms = signal(false);
  readonly loading = signal(false);
  readonly step = signal<1 | 2>(1);

  readonly passwordStrength = signal<0 | 1 | 2 | 3>(0);

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  onPasswordInput(value: string): void {
    this.password.set(value);
    let strength: 0 | 1 | 2 | 3 = 0;
    if (value.length >= 8) strength = 1;
    if (strength && /[A-Z]/.test(value) && /[0-9]/.test(value)) strength = 2;
    if (strength === 2 && /[^A-Za-z0-9]/.test(value)) strength = 3;
    this.passwordStrength.set(strength);
  }

  nextStep(): void {
    if (!this.nome() || !this.empresa() || !this.email()) return;
    this.step.set(2);
  }

  prevStep(): void {
    this.step.set(1);
  }

  onSubmit(): void {
    if (!this.acceptTerms() || !this.password() || this.password() !== this.confirmPassword()) return;
    this.loading.set(true);
    // TODO: integrar com AuthService
    setTimeout(() => this.loading.set(false), 1500);
  }
}
