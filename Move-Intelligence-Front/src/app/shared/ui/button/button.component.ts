import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [class]="'button button-' + variant() + ' button-' + size()"
      [class.icon-only]="iconOnly()"
      [disabled]="disabled() || loading()"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-busy]="loading()"
    >
      @if (loading()) {
        <span class="button-status" aria-hidden="true"></span>
        <span class="sr-only">Carregando</span>
      }
      <ng-content></ng-content>
    </button>
  `,
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly iconOnly = input(false);
  readonly ariaLabel = input('');
}
