import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="field">
      <span class="field-label">{{ label() }}@if (required()) { <b aria-hidden="true">*</b> }</span>
      <input
        [id]="id()"
        [type]="type()"
        [value]="value()"
        [placeholder]="placeholder()"
        [autocomplete]="autocomplete()"
        [required]="required()"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="descriptionId()"
        (input)="valueChange.emit($any($event.target).value)"
      />
      @if (error()) {
        <span class="field-error" [id]="errorId()" role="alert">{{ error() }}</span>
      } @else if (hint()) {
        <span class="field-hint" [id]="hintId()">{{ hint() }}</span>
      }
    </label>
  `,
  styleUrl: './field.component.css',
})
export class FieldComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly type = input('text');
  readonly value = input('');
  readonly placeholder = input('');
  readonly autocomplete = input('off');
  readonly required = input(false);
  readonly hint = input('');
  readonly error = input('');
  readonly valueChange = output<string>();

  descriptionId(): string | null {
    return this.error() ? this.errorId() : this.hint() ? this.hintId() : null;
  }

  errorId(): string {
    return `${this.id()}-error`;
  }

  hintId(): string {
    return `${this.id()}-hint`;
  }
}
