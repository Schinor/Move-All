import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BrandMarkComponent } from '../brand-mark/brand-mark.component';

/**
 * Marca do assistente: símbolo M oficial da Move (vetor, nunca redesenhado)
 * seguido de ".AI" na tipografia de display. `size` é a altura do M em px.
 */
@Component({
  selector: 'app-mai-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMarkComponent],
  template: `
    <span
      class="mai"
      [class.accent]="accent()"
      [style.--mai-h.px]="size()"
      [attr.role]="label() ? 'img' : null"
      [attr.aria-label]="label()"
      [attr.aria-hidden]="label() ? null : 'true'"
    >
      <app-brand-mark class="mai-m" [size]="markBox()" />
      <span class="mai-ai">.AI</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: 0 0 auto;
        line-height: 1;
      }
      .mai {
        display: inline-flex;
        align-items: center;
        color: currentColor;
      }
      /* O viewBox do M é 450×357: com caixa quadrada de lado L o glifo mede L × 0,79 de altura. */
      .mai-m {
        margin-inline: calc(var(--mai-h) * -0.02) calc(var(--mai-h) * 0.04);
      }
      .accent .mai-m {
        color: var(--brand-lockup);
      }
      .mai-ai {
        font-family: var(--font-display);
        font-size: calc(var(--mai-h) * 1.32);
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1;
        white-space: nowrap;
      }
    `,
  ],
})
export class MaiMarkComponent {
  /** Altura visual do M (px). */
  readonly size = input(14);
  /** M na cor oficial da marca (verde no escuro, preto no claro). */
  readonly accent = input(false);
  readonly label = input<string | null>(null);

  /** Lado da caixa quadrada do brand-mark para o M ter a altura pedida. */
  markBox(): number {
    return Math.round((this.size() * 450) / 357);
  }
}
