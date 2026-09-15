import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrendProduct } from '../../../../core/models/contract.models';
import { scoreBandFor } from '../../../util/format';

type Cell = {
  scoreBand: string;
  confidence: string;
  items: TrendProduct[];
};

@Component({
  selector: 'app-risk-matrix',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './risk-matrix.component.html',
  styleUrl: './risk-matrix.component.css',
})
export class RiskMatrixComponent {
  readonly products = input<TrendProduct[]>([]);

  readonly cells = computed<Cell[]>(() => {
    // Eixos faixa configurável (B1, 70/50) × confiança dos dados.
    const bands = ['Move verde (> 70)', 'Move amarelo (50–70)', 'Move vermelho ou sem score'];
    const confidences = ['Dados suficientes', 'Confiança limitada'];
    return bands.flatMap((scoreBand, row) =>
      confidences.map((confidence, col) => ({
        scoreBand,
        confidence,
        items: this.products().filter(
          (product) => this.scoreRow(product) === row && this.confidenceColumn(product) === col,
        ),
      })),
    );
  });

  private scoreRow(product: TrendProduct): number {
    const band = product.scoreBand ?? scoreBandFor(product.moveScore);
    if (band === 'green') {
      return 0;
    }
    if (band === 'yellow') {
      return 1;
    }
    return 2;
  }

  private confidenceColumn(product: TrendProduct): number {
    return product.dataConfidence === 'suficiente' ? 0 : 1;
  }
}
