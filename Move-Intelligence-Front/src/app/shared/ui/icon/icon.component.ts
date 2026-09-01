import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.css',
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number>(16);
}
