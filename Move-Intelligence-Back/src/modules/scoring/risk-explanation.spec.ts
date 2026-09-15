import { buildRiskExplanation, structuralCauses } from './risk-explanation';

describe('risk-explanation (B4)', () => {
  const premises = {
    preco_venda: 209,
    custo_usd: 14,
    cambio_base: 5,
    imposto_importacao: 0.35,
    frete_usd_unidade: 3,
    comissao_marketplace: 0.16,
    imposto_venda: 0.08,
    frete_cliente: 8,
    marketing_inicial: 5000,
    demanda_referencia: 520,
  };

  it('margem saudável não gera causa estrutural', () => {
    const causes = structuralCauses(premises);
    // landed = 70*1.35+15 = 109.5; net = 209*0.76-8 = 150.8; margem ~19.8% → sem causa
    expect(causes.find((c) => c.key === 'low_margin')).toBeUndefined();
  });

  it('margem < 10% gera causa', () => {
    const causes = structuralCauses({ ...premises, preco_venda: 120 });
    expect(causes.find((c) => c.key === 'low_margin')).toBeDefined();
  });

  it('custo de importação > 70% gera causa', () => {
    const causes = structuralCauses({ ...premises, custo_usd: 30 });
    expect(causes.find((c) => c.key === 'high_import_cost')).toBeDefined();
  });

  it('texto combina estrutural + drivers (exemplo do plano)', () => {
    const { text } = buildRiskExplanation({
      riskLevel: 'alto',
      premises: { ...premises, preco_venda: 120 },
      drivers: [
        { factor: 'demanda', share: 41 },
        { factor: 'cambio', share: 27 },
        { factor: 'preco', share: 20 },
      ],
    });
    expect(text).toContain('Risco alto');
    expect(text).toContain('margem unitária');
    expect(text).toContain('incerteza da demanda (41%');
    expect(text).toContain('câmbio (27%');
  });

  it('sem causas retorna texto nulo', () => {
    const { text } = buildRiskExplanation({ riskLevel: 'baixo', premises, drivers: [] });
    // Margem saudável e sem drivers → nulo (nada a explicar).
    expect(text).toBeNull();
  });
});
