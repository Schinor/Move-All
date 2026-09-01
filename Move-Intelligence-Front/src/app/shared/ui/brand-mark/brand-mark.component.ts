import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Símbolo M monocromático da Move, sem moldura ou efeitos. */
@Component({
  selector: 'app-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './brand-mark.component.html',
  styleUrl: './brand-mark.component.css',
})
export class BrandMarkComponent {
  readonly size = input(28);
  readonly label = input<string | null>(null);
}
