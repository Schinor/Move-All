import { EMPTY_MOVE_SCORE, loadLatestMoveScores } from './product-score-loader';

describe('loadLatestMoveScores (F2.5)', () => {
  function delegate(rows: Array<Record<string, unknown>>) {
    return {
      findMany: jest.fn().mockResolvedValue(
        [...rows].sort(
          (a, b) => (b.computedAt as Date).getTime() - (a.computedAt as Date).getTime(),
        ),
      ),
    };
  }

  it('o vigente por cluster é o de maior computedAt', async () => {
    const prisma = {
      productScore: delegate([
        {
          productClusterId: 'c1',
          score: 80,
          decision: 'AVANCAR',
          dataConfidence: 'suficiente',
          pVplPositivo: 0.9,
          cvar5: 10,
          computedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          productClusterId: 'c1',
          score: 40,
          decision: 'REPROVAR',
          dataConfidence: 'suficiente',
          pVplPositivo: 0.4,
          cvar5: -50,
          computedAt: new Date('2026-09-14T00:00:00.000Z'),
        },
      ]),
    };

    const scores = await loadLatestMoveScores(prisma as never, ['c1']);

    expect(scores.get('c1')).toEqual({
      moveScore: 40,
      decision: 'REPROVAR',
      dataConfidence: 'suficiente',
      pVplPositivo: 0.4,
      cvar5: -50,
      action: null,
      scoreBand: null,
      momentumDirection: null,
      momentumGrowthPct: null,
      momentumConfidence: null,
      riskExplanation: null,
      riskDrivers: null,
      premises: null,
    });
  });

  it('lê ação, faixa, momentum e risco quando presentes (B3/B4)', async () => {
    const prisma = {
      productScore: delegate([
        {
          productClusterId: 'c1',
          score: 82,
          decision: 'AVANCAR',
          dataConfidence: 'suficiente',
          pVplPositivo: 0.88,
          cvar5: 100,
          computedAt: new Date('2026-09-14T00:00:00.000Z'),
          action: 'DECIDIR_AGORA',
          scoreBand: 'green',
          momentumDirection: 'sobe',
          momentumGrowthPct: 24.5,
          momentumConfidence: 'completa',
          riskExplanation: 'Risco baixo.',
          riskDrivers: [{ factor: 'demanda', share: 60 }],
        },
      ]),
    };
    const scores = await loadLatestMoveScores(prisma as never, ['c1']);
    expect(scores.get('c1')).toEqual(
      expect.objectContaining({
        action: 'DECIDIR_AGORA',
        scoreBand: 'green',
        momentumDirection: 'sobe',
        momentumGrowthPct: 24.5,
        riskExplanation: 'Risco baixo.',
      }),
    );
  });

  it('sem linhas ou sem ids, devolve mapa vazio', async () => {
    const prisma = { productScore: delegate([]) };

    expect(await loadLatestMoveScores(prisma as never, ['c1'])).toEqual(new Map());
    expect(await loadLatestMoveScores(prisma as never, [])).toEqual(new Map());
    expect(prisma.productScore.findMany).toHaveBeenCalledTimes(1);
  });

  it('expõe o vazio canônico para produto sem score', () => {
    expect(EMPTY_MOVE_SCORE).toEqual({
      moveScore: null,
      decision: null,
      dataConfidence: null,
      pVplPositivo: null,
      cvar5: null,
      action: null,
      scoreBand: null,
      momentumDirection: null,
      momentumGrowthPct: null,
      momentumConfidence: null,
      riskExplanation: null,
      riskDrivers: null,
      premises: null,
    });
  });
});
