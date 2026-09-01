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

  /** Normaliza as variações que chegam da API (LOW/MEDIUM/HIGH, low, médio…). */
  readonly normalized = computed<RiskLevel | null>(() => {
    const raw = this.level();
    if (!raw) return null;
    const key = String(raw).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const aliases: Record<string, RiskLevel> = {
      baixo: 'baixo', low: 'baixo',
      medio: 'medio', medium: 'medio', moderate: 'medio',
      alto: 'alto', high: 'alto',
    };
    return aliases[key] ?? null;
  });

  readonly label = computed(() => {
    const map: Record<RiskLevel, string> = { baixo: 'Risco baixo', medio: 'Risco médio', alto: 'Risco alto' };
    const level = this.normalized();
    if (!level) {
      return 'Risco não informado';
    }
    return this.of() ? `${map[level]} ${this.of()}` : map[level];
  });
}
