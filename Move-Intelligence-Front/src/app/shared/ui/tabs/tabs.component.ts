import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TabItem {
  id: string;
  label: string;
}

@Component({
  selector: 'app-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.css',
})
export class TabsComponent {
  readonly tabs = input.required<TabItem[]>();
  readonly active = input.required<string>();
  readonly changed = output<string>();
}
