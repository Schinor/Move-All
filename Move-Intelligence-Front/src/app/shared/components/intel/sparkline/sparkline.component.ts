import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Sparkline em SVG (portado 1:1 do mockup). Recebe a série via @Input. */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sparkline.component.html',
  styleUrl: './sparkline.component.css',
})
export class SparklineComponent {
  readonly data = input<number[]>([]);
  readonly up = input(true);

  private readonly w = 100;
  private readonly h = 36;
  readonly gradId = `sp-${Math.random().toString(36).slice(2)}`;

  readonly stroke = computed(() => (this.up() ? 'var(--primary)' : 'var(--danger)'));

  private readonly points = computed<[number, number][]>(() => {
    const d = this.data();
    if (!d.length) {
      return [];
    }
    const min = Math.min(...d);
    const max = Math.max(...d);
    const span = Math.max(1, max - min);
    return d.map((v, i) => {
      const x = (i / Math.max(1, d.length - 1)) * this.w;
      const y = this.h - ((v - min) / span) * (this.h - 4) - 2;
      return [x, y];
    });
  });

  readonly linePath = computed(() =>
    this.points()
      .map((p, i) => (i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`))
      .join(' '),
  );

  readonly areaPath = computed(() => {
    const p = this.linePath();
    return p ? `${p} L${this.w},${this.h} L0,${this.h} Z` : '';
  });
}
