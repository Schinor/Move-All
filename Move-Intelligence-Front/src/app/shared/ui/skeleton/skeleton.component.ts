import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="skeleton" [style.width]="width()" [style.height]="height()" aria-hidden="true"></span>`,
  styleUrl: './skeleton.component.css',
})
export class SkeletonComponent {
  readonly width = input('100%');
  readonly height = input('16px');
}
