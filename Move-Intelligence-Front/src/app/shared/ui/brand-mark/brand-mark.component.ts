import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MOVE_M_PATH, MOVE_M_VIEWBOX } from './move-m.path';

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
  readonly path = MOVE_M_PATH;
  readonly viewBox = MOVE_M_VIEWBOX;
}
