import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RiskLevel } from '../../../core/models/contract.models';

/** Badge de risco com semântica padronizada e "risco de quê" explícito (pesquisa). */
@Component({
  selector: 'app-risk-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './risk-badge.component.html',
  styleUrl: './risk-badge.component.css',
})
export class RiskBadgeComponent {
  readonly level = input<RiskLevel | null>(null);
  /** O que está em risco (ex.: "de investimento", "de tropicalização"). */
  readonly of = input('');

  readonly label = computed(() => {
    const map: Record<RiskLevel, string> = { baixo: 'Risco baixo', medio: 'Risco médio', alto: 'Risco alto' };
    const l = this.level();
    if (!l) {
      return 'Risco —';
    }
    return this.of() ? `${map[l]} ${this.of()}` : map[l];
  });
}
