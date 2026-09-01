import { ChangeDetectionStrategy, Component, input, OnInit } from '@angular/core';

export const ICON_NAMES = [
  'alert-triangle',
  'arrow-down-right',
  'arrow-right',
  'arrow-up-right',
  'bar-chart',
  'bell',
  'boxes',
  'building',
  'calculator',
  'calendar',
  'check',
  'check-circle',
  'chevron-down',
  'chevron-up',
  'clock',
  'columns',
  'command',
  'compass',
  'crown',
  'customs',
  'diamond',
  'edit',
  'email',
  'eye',
  'eye-off',
  'factory',
  'file-check',
  'file-text',
  'fire',
  'flame',
  'flask',
  'globe',
  'kanban',
  'lightbulb',
  'lock',
  'logout',
  'medal-bronze',
  'medal-gold',
  'medal-silver',
  'menu',
  'money',
  'moon',
  'monitor',
  'package',
  'password',
  'panel-left',
  'panel-left-close',
  'pin',
  'pin-filled',
  'refresh',
  'robot',
  'scroll',
  'search',
  'ship',
  'sliders',
  'sparkles',
  'square-pen',
  'star',
  'sun',
  'target',
  'trending-down',
  'trending-up',
  'user',
  'x',
  'x-circle',
  'zap',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.css',
})
export class IconComponent implements OnInit {
  readonly name = input.required<IconName>();
  readonly size = input<number>(16);

  ngOnInit(): void {
    if (!ICON_NAMES.includes(this.name())) {
      console.warn(`[Move Intelligence] Ícone não registrado: ${this.name()}`);
    }
  }
}
