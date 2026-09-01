import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-score-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './score-gauge.component.html',
  styleUrl: './score-gauge.component.css',
})
export class ScoreGaugeComponent {
  readonly value = input<number | null>(null);
  readonly size = input(72);
  /** Legenda opcional. Vazio por padrão: o contexto ao redor já nomeia o número. */
  readonly label = input('');

  /** Anel proporcional: 6px a 72px pesava demais quando o gauge cai para 40px na tabela. */
  readonly strokeWidth = computed(() => Math.max(3, Math.round(this.size() / 12)));
  readonly center = computed(() => this.size() / 2);
  readonly radius = computed(() => this.size() / 2 - this.strokeWidth() / 2 - 2);
  readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  readonly circumference = computed(() => 2 * Math.PI * this.radius());
  readonly normalized = computed(() => Math.max(0, Math.min(100, this.value() ?? 0)));
  readonly dash = computed(() => (this.normalized() / 100) * this.circumference());
  readonly color = computed(() => {
    const value = this.normalized();
    if (value >= 60) {
      return 'var(--primary)';
    }
    if (value >= 35) {
      return 'var(--warning)';
    }
    return 'var(--muted-foreground)';
  });
}
