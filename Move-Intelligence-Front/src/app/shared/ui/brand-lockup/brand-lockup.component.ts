import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Assinatura da plataforma: wordmark oficial da Move (vetor, nunca texto)
 * + o nome do produto em tipografia de display.
 * O manual da marca proíbe recompor ou reescrever o logotipo, por isso
 * "Move" é sempre o vetor e nunca uma fonte.
 */
@Component({
  selector: 'app-brand-lockup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './brand-lockup.component.html',
  styleUrl: './brand-lockup.component.css',
})
export class BrandLockupComponent {
  /** Só o wordmark, para a sidebar em modo rail. */
  readonly compact = input(false);
}
