import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';

export interface SegmentOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-segmented',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="segmented" role="radiogroup" [attr.aria-label]="label()">
      @for (option of options(); track option.value) {
        <button
          type="button"
          role="radio"
          [attr.aria-checked]="selected() === option.value"
          [class.selected]="selected() === option.value"
          (click)="selectedChange.emit(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styleUrl: './segmented.component.css',
})
export class SegmentedComponent {
  readonly label = input.required<string>();
  readonly options = input.required<SegmentOption[]>();
  readonly selected = input.required<string>();
  readonly selectedChange = output<string>();

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const options = this.options();
    const index = options.findIndex((option) => option.value === this.selected());
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    const next = options[nextIndex];
    if (next) this.selectedChange.emit(next.value);
  }
}
