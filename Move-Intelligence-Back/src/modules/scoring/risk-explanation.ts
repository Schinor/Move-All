/**
 * Causas do risco (B4, decisão 4).
 *
 * Módulo PURO: sem Prisma, sem rede.
 * - Drivers aleatórios: vêm do Monte Carlo (Spearman² normalizado, script).
 * - Causas estruturais: comparando premissas com a receita, sem novos riscos
 *   operacionais (fornecimento/logística fora do escopo).
 */

export interface RiskPremises {
  preco_venda: number;
  custo_usd: number;
  cambio_base: number;
  imposto_importacao: number;
  frete_usd_unidade: number;
  comissao_marketplace: number;
  imposto_venda: number;
  frete_cliente: number;
  marketing_inicial: number;
  demanda_referencia: number;
  moeda_custo?: string;
  cambio_cny_usd?: number;
}

export interface RiskDriver {
  factor: string;
  share: number;
}

export interface RiskTuning {
  lowMarginPct: number;
  highImportCostPct: number;
  highInvestmentMonths?: number;
}

export const DEFAULT_RISK_TUNING: RiskTuning = {
  lowMarginPct: 10,
  highImportCostPct: 70,
  highInvestmentMonths: 2,
};

const FACTOR_LABEL: Record<string, string> = {
  cambio: 'câmbio',
  lead_time: 'lead time',
  preco: 'preço',
  demanda: 'incerteza da demanda',
  crescimento: 'crescimento',
};

export function factorLabel(factor: string): string {
  return FACTOR_LABEL[factor] ?? factor;
}

export interface StructuralCause {
  key: 'low_margin' | 'high_import_cost' | 'high_investment';
  text: string;
  marginPct?: number;
  importCostPct?: number;
}

export function structuralCauses(
  premises: Partial<RiskPremises>,
  tuning: RiskTuning = DEFAULT_RISK_TUNING,
): StructuralCause[] {
  const causes: StructuralCause[] = [];
  const preco = Number(premises.preco_venda);
  if (!Number.isFinite(preco) || preco <= 0) return causes;

  const custoUsd = Number(premises.custo_usd ?? NaN);
  const cambio = Number(premises.cambio_base ?? NaN);
  const imposto = Number(premises.imposto_importacao ?? 0);
  const freteUn = Number(premises.frete_usd_unidade ?? 0);
  const comissao = Number(premises.comissao_marketplace ?? 0);
  const impostoVenda = Number(premises.imposto_venda ?? 0);
  const freteCli = Number(premises.frete_cliente ?? 0);
  const moeda = premises.moeda_custo ?? 'USD';
  const fxCny = Number(premises.cambio_cny_usd ?? 1);

  if (Number.isFinite(custoUsd) && Number.isFinite(cambio) && custoUsd > 0 && cambio > 0) {
    const custoEfetivo = custoUsd * (moeda === 'CNY' ? fxCny : 1);
    const custoUnit = custoEfetivo * cambio;
    const landed = custoUnit * (1 + imposto) + freteUn * cambio;
    const netUnit = preco * (1 - comissao - impostoVenda) - freteCli;
    const marginPct = ((netUnit - landed) / preco) * 100;
    if (Number.isFinite(marginPct) && marginPct < tuning.lowMarginPct) {
      causes.push({
        key: 'low_margin',
        text: `margem unitária de ${marginPct.toFixed(marginPct < 0 ? 1 : 0)}% no preço atual`,
        marginPct: Math.round(marginPct * 10) / 10,
      });
    }
    const importPct = (landed / preco) * 100;
    if (Number.isFinite(importPct) && importPct > tuning.highImportCostPct) {
      causes.push({
        key: 'high_import_cost',
        text: `custo de importação em ${Math.round(importPct)}% do preço de venda`,
        importCostPct: Math.round(importPct),
      });
    }
    const demanda = Number(premises.demanda_referencia ?? NaN);
    const marketing = Number(premises.marketing_inicial ?? 0);
    if (Number.isFinite(demanda) && demanda > 0) {
      const qty = Math.round(demanda);
      const investimento = qty * landed + (Number.isFinite(marketing) ? marketing : 0);
      const receitaMensal = demanda * preco;
      const months = tuning.highInvestmentMonths ?? 2;
      if (receitaMensal > 0 && investimento > receitaMensal * months) {
        causes.push({
          key: 'high_investment',
          text: `investimento inicial alto frente à demanda (${(investimento / receitaMensal).toFixed(1)} meses de receita)`,
        });
      }
    }
  }
  return causes;
}

export function buildRiskExplanation(params: {
  riskLevel: string | null;
  premises: Partial<RiskPremises>;
  drivers: RiskDriver[] | null;
  tuning?: RiskTuning;
}): { text: string | null; drivers: RiskDriver[] } {
  const drivers = (params.drivers ?? [])
    .filter((d) => d && typeof d.factor === 'string' && Number.isFinite(Number(d.share)))
    .map((d) => ({ factor: String(d.factor), share: Number(d.share) }))
    .sort((a, b) => b.share - a.share);
  const structural = structuralCauses(params.premises, params.tuning ?? DEFAULT_RISK_TUNING);
  if (drivers.length === 0 && structural.length === 0) return { text: null, drivers: [] };

  const level =
    params.riskLevel === 'baixo' || params.riskLevel === 'Baixo'
      ? 'Risco baixo'
      : params.riskLevel === 'medio' || params.riskLevel === 'Medio'
        ? 'Risco médio'
        : params.riskLevel === 'alto' || params.riskLevel === 'Alto'
          ? 'Risco alto'
          : 'Risco';
  const parts: string[] = [];
  for (const c of structural) parts.push(c.text);
  for (const d of drivers.slice(0, 2)) {
    if (d.share > 0) parts.push(`${factorLabel(d.factor)} (${Math.round(d.share)}% da variação)`);
  }
  if (parts.length === 0) return { text: null, drivers };
  return { text: `${level}. Principais causas: ${parts.join('; ')}.`, drivers };
}
