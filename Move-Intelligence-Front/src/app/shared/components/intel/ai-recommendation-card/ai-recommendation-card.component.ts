import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AiRecommendationResult, TrendProduct } from '../../../../core/models/contract.models';
import { ACTION_TOOLTIP, actionLabel, dataConfidenceLabel, scoreBandLabel } from '../../../util/format';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Um motivo da decisão: o que foi medido, o valor e o que ele significa. */
export interface DecisionReason {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

/** Conta por unidade a partir das premissas do Monte Carlo vigente. */
export interface UnitEconomics {
  price: number;
  landedCost: number;
  fees: number;
  shipping: number;
  margin: number;
  marginPct: number;
  landedSharePct: number;
  costUsd: number;
  /** Custo FOB máximo (US$) para chegar à margem-alvo; null quando nem custo zero chega lá. */
  maxCostUsd: number | null;
  costCutPct: number | null;
}

/** Margem usada como alvo na sugestão de negociação. */
const TARGET_MARGIN = 0.15;
/** Corte de momentum das regras (B3): acima de +10% em 8 semanas é alta. */
const MOMENTUM_UP_PCT = 10;

const RISK_FACTOR_LABEL: Record<string, string> = {
  cambio: 'Câmbio',
  lead_time: 'Prazo de entrega',
  preco: 'Preço de venda',
  demanda: 'Demanda',
  crescimento: 'Crescimento',
};

const ACTION_SUMMARY: Record<string, string> = {
  DECIDIR_AGORA: 'A demanda está subindo e a simulação financeira é favorável.',
  NEGOCIAR_CUSTO: 'A demanda está subindo, mas a simulação financeira ainda não fecha com o custo atual.',
  TESTAR_DEMANDA: 'A conta fecha, mas a demanda ainda não mostra alta clara.',
  IGNORAR: 'A demanda não está subindo e a simulação financeira é desfavorável.',
  DADOS_INSUFICIENTES: ACTION_TOOLTIP['DADOS_INSUFICIENTES'],
};

const MOMENTUM_CONFIDENCE_LABEL: Record<string, string> = {
  alta: 'alta',
  media: 'média',
  baixa: 'baixa',
  so_vendas: 'apenas vendas dos marketplaces',
  so_busca: 'apenas volume de busca',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function pct(value: number, digits = 0): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return `${rounded.toLocaleString('pt-BR')}%`;
}

function signedPct(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR')}%`;
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

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

  /** Ação das regras (P0-2: a exibida é sempre a das regras). */
  readonly action = computed(() => this.product().action ?? this.recommendation()?.action ?? null);

  readonly decision = computed(() => {
    const action = this.action();
    if (action) {
      return actionLabel(action) || 'Dados insuficientes';
    }
    const aiRec = this.recommendation();
    if (aiRec?.decision) {
      return displayDecision(aiRec.decision);
    }
    return 'Dados insuficientes';
  });

  readonly tone = computed((): Tone => {
    switch (this.action()) {
      case 'DECIDIR_AGORA':
        return 'good';
      case 'NEGOCIAR_CUSTO':
      case 'TESTAR_DEMANDA':
        return 'warn';
      case 'IGNORAR':
        return 'bad';
      default:
        return 'neutral';
    }
  });

  readonly rationale = computed(() => {
    const aiRec = this.recommendation();
    if (aiRec?.rationale && !isRawRationale(aiRec.rationale)) {
      return aiRec.rationale;
    }
    if (aiRec?.rationale) {
      return 'Parecer indisponível no momento.';
    }
    return this.product().recommendation ?? null;
  });

  /** Frase curta, pelas regras, que explica a ação. */
  readonly summary = computed(() => ACTION_SUMMARY[this.action() ?? ''] ?? null);

  readonly economics = computed((): UnitEconomics | null => {
    const p = (this.product().premises ?? null) as Record<string, unknown> | null;
    if (!p) return null;
    const price = num(p['precoVenda']);
    const costUsd = num(p['custoUsd']);
    const fx = num(p['cambioBase']);
    if (!price || price <= 0 || costUsd === null || !fx) return null;
    const importTax = num(p['impostoImportacao']) ?? 0;
    const freightUsd = num(p['freteUsdUnidade']) ?? 0;
    const commission = num(p['comissaoMarketplace']) ?? 0;
    const saleTax = num(p['impostoVenda']) ?? 0;
    const shipping = num(p['freteCliente']) ?? 0;

    // Mesma conta do Monte Carlo: imposto de importação sobre o custo, frete convertido.
    const landedCost = costUsd * fx * (1 + importTax) + freightUsd * fx;
    const fees = price * (commission + saleTax);
    const margin = price - landedCost - fees - shipping;
    const room = price * (1 - commission - saleTax - TARGET_MARGIN) - shipping - freightUsd * fx;
    const maxCostUsd = room > 0 ? room / (fx * (1 + importTax)) : null;
    return {
      price,
      landedCost,
      fees,
      shipping,
      margin,
      marginPct: (margin / price) * 100,
      landedSharePct: (landedCost / price) * 100,
      costUsd,
      maxCostUsd,
      costCutPct: maxCostUsd !== null && costUsd > 0 ? Math.max(0, (1 - maxCostUsd / costUsd) * 100) : null,
    };
  });

  readonly reasons = computed((): DecisionReason[] => {
    const product = this.product();
    const reasons: DecisionReason[] = [];

    const growth = product.momentum?.growthPct ?? product.growthPct ?? null;
    if (growth !== null && growth !== undefined) {
      const rawConfidence = product.momentum?.confidence;
      const confidence = rawConfidence
        ? ` Base do sinal: ${MOMENTUM_CONFIDENCE_LABEL[rawConfidence] ?? dataConfidenceLabel(rawConfidence).toLowerCase()}.`
        : '';
      reasons.push({
        label: 'Tendência (8 semanas)',
        value: signedPct(growth),
        tone: growth >= MOMENTUM_UP_PCT ? 'good' : growth > -MOMENTUM_UP_PCT ? 'warn' : 'bad',
        detail:
          (growth >= MOMENTUM_UP_PCT
            ? 'Acima do corte de +10%: a demanda está em alta.'
            : growth > -MOMENTUM_UP_PCT
              ? 'Abaixo do corte de +10%: a demanda está estável, sem alta clara.'
              : 'A demanda está caindo nas últimas 8 semanas.') + confidence,
      });
    }

    if (product.moveScore !== null && product.moveScore !== undefined) {
      const probability = product.pVplPositivo;
      reasons.push({
        label: 'Viabilidade financeira',
        value: `${product.moveScore}/100`,
        tone: product.scoreBand === 'green' ? 'good' : product.scoreBand === 'yellow' ? 'warn' : 'bad',
        detail:
          probability !== null && probability !== undefined
            ? `Faixa ${scoreBandLabel(product.scoreBand).toLowerCase() || '—'}. O investimento dá lucro em ${pct(probability * 100)} dos cenários simulados.`
            : `Faixa ${scoreBandLabel(product.scoreBand).toLowerCase() || '—'} do Move Score.`,
      });
    }

    const economics = this.economics();
    if (economics) {
      reasons.push({
        label: 'Margem por unidade',
        value: `${brl.format(economics.margin)} (${pct(economics.marginPct, 1)})`,
        tone: economics.marginPct >= TARGET_MARGIN * 100 ? 'good' : economics.marginPct > 0 ? 'warn' : 'bad',
        detail:
          economics.marginPct >= TARGET_MARGIN * 100 && (product.moveScore ?? 100) <= 50
            ? `O custo importado ocupa ${pct(economics.landedSharePct)} do preço. A margem por peça é boa; o risco está no investimento (estoque, marketing e custos fixos) frente à incerteza da demanda.`
            : `O custo importado ocupa ${pct(economics.landedSharePct)} do preço de venda.`,
      });
    }

    if (product.cvar5 !== null && product.cvar5 !== undefined) {
      reasons.push({
        label: 'Pior cenário (5%)',
        value: brl0.format(product.cvar5),
        tone: product.cvar5 >= 0 ? 'good' : 'bad',
        detail:
          product.cvar5 >= 0
            ? 'Mesmo nos 5% piores cenários o resultado fica positivo.'
            : 'Resultado médio nos 5% piores cenários da simulação.',
      });
    }
    return reasons;
  });

  /** Fatores que mais pesam na incerteza do resultado (análise de sensibilidade). */
  readonly riskFactors = computed(() =>
    (this.product().riskExplanation?.drivers ?? [])
      .filter((driver) => Number(driver.share) > 0)
      .sort((a, b) => Number(b.share) - Number(a.share))
      .slice(0, 4)
      .map((driver) => ({
        label: RISK_FACTOR_LABEL[driver.factor] ?? driver.factor,
        share: Math.round(Number(driver.share)),
      })),
  );

  readonly aiDrivers = computed(() => this.recommendation()?.keyDrivers ?? []);

  readonly shortModel = computed(() => {
    const full = this.recommendation()?.modelVersion ?? '';
    if (!full) return '';
    const afterSlash = full.includes('/') ? full.slice(full.lastIndexOf('/') + 1) : full;
    const withoutTag = afterSlash.includes(':') ? afterSlash.slice(0, afterSlash.indexOf(':')) : afterSlash;
    return withoutTag.endsWith('-fin') ? withoutTag.slice(0, -'-fin'.length) : withoutTag;
  });

  /** Próximo passo: o da IA quando existe; senão, o das regras para a ação. */
  readonly nextStep = computed(() => {
    const fromAi = this.recommendation()?.recommendedNextStep;
    if (fromAi) return fromAi;
    const economics = this.economics();
    switch (this.action()) {
      case 'DECIDIR_AGORA':
        return 'Validar o fornecedor (amostra e prazo) e fechar um primeiro lote. Reavaliar o score após 4 semanas de vendas.';
      case 'NEGOCIAR_CUSTO':
        if (economics && economics.marginPct >= TARGET_MARGIN * 100) {
          return 'A margem por peça já passa de 15%: negociar lote mínimo menor, prazo de pagamento e frete para reduzir o capital empatado e o risco do primeiro lote.';
        }
        if (economics?.maxCostUsd !== null && economics?.maxCostUsd !== undefined && economics.costCutPct) {
          return `Negociar o custo para até ${usd.format(economics.maxCostUsd)} por unidade (hoje ${usd.format(economics.costUsd)}, −${pct(economics.costCutPct)}) para chegar a 15% de margem, ou buscar outro fornecedor ou frete.`;
        }
        if (economics && economics.maxCostUsd === null) {
          return 'Nem com custo zero o preço atual chega a 15% de margem: rever o preço de venda, o frete ou o canal antes de negociar.';
        }
        return 'Negociar FOB e frete com o fornecedor ou buscar outro fornecedor antes de comprar.';
      case 'TESTAR_DEMANDA':
        return 'Comprar um lote pequeno ou anunciar em pré-venda para medir a demanda antes de escalar.';
      case 'IGNORAR':
        return 'Não investir agora. O produto continua sendo reavaliado a cada nova coleta.';
      case 'DADOS_INSUFICIENTES':
        return 'Aguardar mais coletas antes de decidir.';
      default:
        return null;
    }
  });

  formatBrl(value: number): string {
    return brl.format(value);
  }
}

/**
 * D6: 5 ações por quadrante + passthrough legado (cache antigo).
 * P0-2: valor desconhecido vira "Dados insuficientes", nunca o texto cru.
 */
function displayDecision(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/_/g, ' ');
  if (normalized === 'DECIDIR AGORA') return 'Decidir agora';
  if (normalized === 'NEGOCIAR CUSTO') return 'Negociar custo';
  if (normalized === 'TESTAR DEMANDA') return 'Testar demanda';
  if (normalized === 'IGNORAR') return 'Ignorar';
  if (normalized === 'DADOS INSUFICIENTES') return 'Dados insuficientes';
  if (normalized === 'AVANCAR') return 'Decidir agora';
  if (normalized === 'AVANCAR COM RESSALVAS') return 'Negociar custo';
  if (normalized === 'REPROVAR') return 'Ignorar';
  if (normalized === 'SEM SCORE') return 'Dados insuficientes';
  const labeled = actionLabel(value.trim().toUpperCase());
  return labeled || 'Dados insuficientes';
}

/** P0-2: rationale cru (JSON ou cerca) nunca vai para a tela. */
function isRawRationale(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.startsWith('```') || trimmed.startsWith('{');
}
