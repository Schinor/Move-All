import { ChangeDetectionStrategy, Component, HostListener, input, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-explain',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="explain-wrap">
      <button
        type="button"
        class="explain-trigger"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="id()"
        [attr.aria-label]="'Como calculamos ' + label()"
        (click)="open.update((value) => !value)"
      >
        <app-icon name="lightbulb" [size]="14" />
      </button>
      @if (open()) {
        <span class="explain-popover" [id]="id()" role="tooltip">{{ explanation() }}</span>
      }
    </span>
  `,
  styleUrl: './explain.component.css',
})
export class ExplainComponent {
  readonly label = input.required<string>();
  readonly explanation = input.required<string>();
  readonly id = input.required<string>();
  readonly open = signal(false);

  @HostListener('document:keydown.escape')
  close(): void {
    this.open.set(false);
  }
}
