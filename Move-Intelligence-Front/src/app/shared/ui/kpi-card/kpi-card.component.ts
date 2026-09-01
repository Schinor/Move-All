import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Indicator } from '../../../core/models/contract.models';

/**
 * Cartão de KPI com explicabilidade sob demanda (achado nº 1 da pesquisa).
 * O slot "por quê?" existe sempre — mesmo quando a explicação vem null,
 * mostra "explicação indisponível" em vez de um número sem contexto.
 */
@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kpi-card.component.html',
  styleUrl: './kpi-card.component.css',
})
export class KpiCardComponent {
  readonly label = input.required<string>();
  readonly indicator = input<Indicator | null>(null);
  /** Sufixo opcional (ex.: '%', 'pts'). */
  readonly suffix = input('');

  readonly showExplanation = signal(false);

  readonly displayValue = computed(() => {
    const v = this.indicator()?.value;
    return v === null || v === undefined ? '—' : `${v}${this.suffix()}`;
  });

  readonly inputEntries = computed(() => {
    const inputs = this.indicator()?.inputs;
    return inputs ? Object.entries(inputs) : [];
  });

  toggle(): void {
    this.showExplanation.update((v) => !v);
  }
}
