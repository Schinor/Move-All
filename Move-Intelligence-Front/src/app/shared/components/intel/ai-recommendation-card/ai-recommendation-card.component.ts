import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AiRecommendationResult, TrendProduct } from '../../../../core/models/contract.models';

@Component({
  selector: 'app-ai-recommendation-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-recommendation-card.component.html',
  styleUrl: './ai-recommendation-card.component.css',
})
export class AiRecommendationCardComponent {
  readonly product = input.required<TrendProduct>();
  readonly recommendation = input<AiRecommendationResult | null>(null);
  readonly loading = input<boolean>(false);

  readonly decision = computed(() => {
    const aiRec = this.recommendation();
    if (aiRec?.decision) {
      return aiRec.decision;
    }
    const score = this.product().trendScore.value ?? 0;
    if (this.product().risk === 'alto') {
      return 'Monitorar';
    }
    if (score >= 60) {
      return 'Lançar';
    }
    if (score >= 35) {
      return 'Monitorar';
    }
    return 'Evitar';
  });

  readonly rationale = computed(() => {
    const aiRec = this.recommendation();
    if (aiRec?.rationale) {
      return aiRec.rationale;
    }
    const product = this.product();
    const growth = product.growthPct === null ? 'crescimento pendente' : `${product.growthPct}%`;
    return `${product.recommendation ?? 'Sinal em validação analítica.'} Crescimento observado: ${growth}.`;
  });

  readonly drivers = computed(() => {
    return this.recommendation()?.keyDrivers ?? [
      'Validar fornecedor com melhor score e preço FOB.',
      'Conferir MOQ antes de fechar pedido de importação.',
      'Acompanhar evolução de reviews nos marketplaces.',
    ];
  });

  readonly nextStep = computed(() => {
    return this.recommendation()?.recommendedNextStep ?? null;
  });
}
