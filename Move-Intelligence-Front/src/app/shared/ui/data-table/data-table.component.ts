import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-data-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-shell" [class.responsive-cards]="responsiveCards()" [attr.aria-label]="label()">
      <ng-content></ng-content>
    </div>
  `,
  styleUrl: './data-table.component.css',
})
export class DataTableComponent {
  readonly label = input.required<string>();
  readonly responsiveCards = input(false);
}
