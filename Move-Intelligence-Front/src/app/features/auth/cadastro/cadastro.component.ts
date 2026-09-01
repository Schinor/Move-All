import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BrandMarkComponent } from '../../../shared/ui/brand-mark/brand-mark.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-cadastro',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, BrandMarkComponent, IconComponent],
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
  readonly submitted = signal(false);
  readonly message = signal('');
  readonly step = signal<1 | 2>(1);
  readonly passwordStrength = signal<0 | 1 | 2 | 3>(0);

  togglePassword(): void {
    this.showPassword.update((value) => !value);
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
    this.submitted.set(true);
    this.message.set('');
    if (!this.profileIsValid()) {
      this.focusFirstProfileError();
      return;
    }
    this.step.set(2);
    this.submitted.set(false);
  }

  prevStep(): void {
    this.step.set(1);
    this.submitted.set(false);
    this.message.set('');
  }

  onSubmit(): void {
    this.submitted.set(true);
    this.message.set('');
    if (!this.securityIsValid()) {
      this.focusFirstSecurityError();
      return;
    }
    this.message.set('O cadastro ainda não está conectado neste ambiente.');
  }

  nomeError(): string {
    return this.submitted() && !this.nome().trim() ? 'Informe seu nome.' : '';
  }

  empresaError(): string {
    return this.submitted() && !this.empresa().trim() ? 'Informe sua empresa.' : '';
  }

  emailError(): string {
    if (!this.submitted()) return '';
    if (!this.email().trim()) return 'Informe seu e-mail.';
    return this.isEmailValid() ? '' : 'Informe um e-mail válido.';
  }

  passwordError(): string {
    if (!this.submitted()) return '';
    if (!this.password()) return 'Informe uma senha.';
    return this.password().length >= 8 ? '' : 'Use pelo menos 8 caracteres.';
  }

  confirmError(): string {
    if (!this.submitted()) return '';
    if (!this.confirmPassword()) return 'Confirme sua senha.';
    return this.password() === this.confirmPassword() ? '' : 'As senhas não coincidem.';
  }

  termsError(): string {
    return this.submitted() && !this.acceptTerms() ? 'Aceite os termos para continuar.' : '';
  }

  private profileIsValid(): boolean {
    return Boolean(this.nome().trim() && this.empresa().trim() && this.email().trim() && this.isEmailValid());
  }

  private securityIsValid(): boolean {
    return Boolean(
      !this.passwordError() &&
        !this.confirmError() &&
        this.password().length >= 8 &&
        this.password() === this.confirmPassword() &&
        this.acceptTerms(),
    );
  }

  private isEmailValid(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim());
  }

  private focusFirstProfileError(): void {
    const id = this.nomeError() ? 'nome' : this.empresaError() ? 'empresa' : 'email-cad';
    document.getElementById(id)?.focus();
  }

  private focusFirstSecurityError(): void {
    const id = this.passwordError() ? 'password-cad' : this.confirmError() ? 'confirm-password' : 'terms';
    document.getElementById(id)?.focus();
  }
}
