import {
  HistoryObservation,
  derivePremisesFromHistory,
} from './premises-from-history';

/**
 * Séries SINTÉTICAS de teste (fixtures no spec, nunca no banco): crescimento
 * positivo, negativo, zero e dados faltantes.
 */
const DAY = 86_400_000;
const BASE = new Date('2026-08-01T12:00:00.000Z').getTime();

function obs(
  week: number,
  sales: number | null,
  extra: Partial<HistoryObservation> = {},
): HistoryObservation {
  return {
    listingKey: 'amazon_br:B1',
    marketplace: 'amazon_br',
    currency: 'BRL',
    priceMin: 500,
    salesSignal: sales,
    collectedAt: new Date(BASE + week * 7 * DAY),
    ...extra,
  };
}

function withCost(observations: HistoryObservation[]): HistoryObservation[] {
  return [
    ...observations,
    {
      listingKey: '1688:C1',
      marketplace: '1688',
      currency: 'CNY',
      priceMin: 100,
      salesSignal: null,
      collectedAt: new Date(BASE + 21 * DAY),
    },
  ];
}

describe('derivePremisesFromHistory (F2.2)', () => {
  it('crescimento positivo dobra por semana (slope mensal ≈ ln2×30.44/7)', () => {
    const { premises, dataConfidence } = derivePremisesFromHistory(
      withCost([obs(0, 100), obs(1, 200), obs(2, 400), obs(3, 800)]),
      { fxCnyUsd: 0.14 },
    );

    expect(dataConfidence).toBe('suficiente');
    expect(premises?.crescimento_demanda_mensal).toBeGreaterThan(2);
    expect(premises?.crescimento_demanda_mensal).toBeLessThan(4);
    expect(premises?.demanda_referencia).toBe(375);
    expect(premises?.preco_venda).toBe(500);
    expect(premises?.custo_usd).toBeCloseTo(14, 10);
    expect(premises?.dataVersion).toBe('premises@1');
  });

  it('crescimento negativo espelha o positivo', () => {
    const { premises, dataConfidence } = derivePremisesFromHistory(
      withCost([obs(0, 800), obs(1, 400), obs(2, 200), obs(3, 100)]),
      { fxCnyUsd: 0.14 },
    );

    expect(dataConfidence).toBe('suficiente');
    expect(premises?.crescimento_demanda_mensal).toBeLessThan(-2);
    expect(premises?.crescimento_demanda_mensal).toBeGreaterThan(-4);
  });

  it('série constante tem crescimento e volatilidade zero', () => {
    const { premises } = derivePremisesFromHistory(
      withCost([obs(0, 100), obs(1, 100), obs(2, 100), obs(3, 100)]),
      { fxCnyUsd: 0.14 },
    );

    expect(premises?.crescimento_demanda_mensal).toBeCloseTo(0, 10);
    expect(premises?.vol_demanda).toBe(0);
  });

  it('poucas observações ou janela curta → historico_curto sem premissas', () => {
    expect(
      derivePremisesFromHistory([obs(0, 100), obs(1, 100)], { fxCnyUsd: 0.14 }).dataConfidence,
    ).toBe('historico_curto');
    expect(
      derivePremisesFromHistory(withCost([obs(0, 100), obs(1, 100)]), { fxCnyUsd: 0.14 })
        .premises,
    ).toBeNull();
  });

  it('sem vendas no painel → sem_vendas', () => {
    const { premises, dataConfidence } = derivePremisesFromHistory(
      withCost([obs(0, null), obs(1, null), obs(2, null), obs(3, null)]),
      { fxCnyUsd: 0.14 },
    );

    expect(dataConfidence).toBe('sem_vendas');
    expect(premises).toBeNull();
  });

  it('sem custo 1688/Alibaba → sem_custo (Amazon não serve como custo)', () => {
    const observations = [
      obs(0, 100),
      obs(1, 100),
      obs(2, 100),
      obs(3, 100),
      {
        listingKey: 'amazon:C9',
        marketplace: 'amazon',
        currency: 'USD',
        priceMin: 50,
        salesSignal: null,
        collectedAt: new Date(BASE + 21 * DAY),
      },
    ];
    const { premises, dataConfidence } = derivePremisesFromHistory(observations, {
      fxCnyUsd: 0.14,
    });

    expect(dataConfidence).toBe('sem_custo');
    expect(premises).toBeNull();
  });

  it('AliExpress serve como custo de sourcing (A4)', () => {
    const { premises, dataConfidence } = derivePremisesFromHistory(
      [
        obs(0, 100),
        obs(1, 100),
        obs(2, 100),
        obs(3, 100),
        {
          listingKey: 'aliexpress:C9',
          marketplace: 'aliexpress',
          currency: 'USD',
          priceMin: 20,
          salesSignal: null,
          collectedAt: new Date(BASE + 21 * DAY),
        },
      ],
      { fxCnyUsd: 0.14 },
    );

    expect(dataConfidence).toBe('suficiente');
    expect(premises?.custo_usd).toBeCloseTo(20, 10);
  });

  it('sem preço BR → historico_curto', () => {
    const { dataConfidence } = derivePremisesFromHistory(
      withCost([
        obs(0, 100, { marketplace: 'amazon', currency: 'USD', priceMin: 90 }),
        obs(1, 100, { marketplace: 'amazon', currency: 'USD', priceMin: 90 }),
        obs(2, 100, { marketplace: 'amazon', currency: 'USD', priceMin: 90 }),
        obs(3, 100, { marketplace: 'amazon', currency: 'USD', priceMin: 90 }),
      ]),
      { fxCnyUsd: 0.14 },
    );

    expect(dataConfidence).toBe('historico_curto');
  });
});
