import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TrendProduct } from '../../../../core/models/contract.models';

type Cell = {
  demand: string;
  risk: string;
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
    const demands = ['Alta demanda', 'Demanda média', 'Sinal inicial'];
    const risks = ['Baixo', 'Médio', 'Alto'];
    return demands.flatMap((demand, row) =>
      risks.map((risk, col) => ({
        demand,
        risk,
        items: this.products().filter(
          (product) => this.demandRow(product) === row && this.riskColumn(product) === col,
        ),
      })),
    );
  });

  private demandRow(product: TrendProduct): number {
    const score = product.trendScore.value ?? 0;
    if (score >= 60) {
      return 0;
    }
    if (score >= 35) {
      return 1;
    }
    return 2;
  }

  private riskColumn(product: TrendProduct): number {
    if (product.risk === 'baixo') {
      return 0;
    }
    if (product.risk === 'alto') {
      return 2;
    }
    return 1;
  }
}
