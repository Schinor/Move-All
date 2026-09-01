import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-confidence-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confidence-indicator.component.html',
  styleUrl: './confidence-indicator.component.css',
})
export class ConfidenceIndicatorComponent {
  readonly value = input<number | null>(null);
  readonly size = input(54);
  readonly label = input('Confiança');

  readonly percent = computed(() => Math.round(Math.max(0, Math.min(1, this.value() ?? 0)) * 100));
  readonly center = computed(() => this.size() / 2);
  readonly radius = computed(() => this.size() / 2 - 6);
  readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  readonly circumference = computed(() => 2 * Math.PI * this.radius());
  readonly dash = computed(() => (this.percent() / 100) * this.circumference());
}
