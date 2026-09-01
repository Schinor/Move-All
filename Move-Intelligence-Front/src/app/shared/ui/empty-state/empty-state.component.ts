import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, IconName } from '../icon/icon.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="empty-state" [class.compact]="compact()" [attr.aria-label]="title()">
      <span class="empty-icon"><app-icon [name]="icon()" [size]="20" /></span>
      <h2>{{ title() }}</h2>
      <p>{{ description() }}</p>
      <div class="empty-actions"><ng-content></ng-content></div>
    </section>
  `,
  styleUrl: './empty-state.component.css',
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly icon = input<IconName>('compass');
  readonly compact = input(false);
}
