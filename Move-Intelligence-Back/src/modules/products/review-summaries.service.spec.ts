import { ReviewSummariesService, reasonGrounded } from './review-summaries.service';

describe('review-summaries (B5)', () => {
  function buildService(openRouter: unknown, prisma: unknown) {
    return new ReviewSummariesService(
      prisma as never,
      openRouter as never,
    );
  }

  it('reasonGrounded exige palavra da amostra', () => {
    expect(reasonGrounded('entrega rápida', ['A entrega foi muito rápida'])).toBe(true);
    expect(reasonGrounded('bateria dura muito', ['Entrega rápida, produto bom'])).toBe(false);
  });

  it('agrupa por faixa 1-2/3/4-5', () => {
    const svc = buildService({}, {});
    const grouped = svc.groupByBand([
      { stars: 1, text: 'ruim' },
      { stars: 2, text: 'fraco' },
      { stars: 3, text: 'ok' },
      { stars: 5, text: 'ótimo' },
      { stars: null, text: 'sem estrela' },
    ]);
    expect(grouped['1-2']).toHaveLength(2);
    expect(grouped['3']).toHaveLength(1);
    expect(grouped['4-5']).toHaveLength(1);
  });

  it('salva resumo válido e registra ok', async () => {
    const created: unknown[] = [];
    const logs: unknown[] = [];
    const prisma = {
      reviewSummary: { create: jest.fn(async (args: unknown) => { created.push(args); return {}; }) },
      aiCallLog: { create: jest.fn(async (args: unknown) => { logs.push(args); return {}; }) },
    };
    const openRouter = {
      chatCompletion: jest.fn(async () => ({
        content: JSON.stringify({
          band: '4-5',
          summary: 'Produto resistente e fácil de montar.',
          top_reasons: ['resistente', 'fácil de montar'],
          sample_size: 2,
        }),
        model: 'test-model',
      })),
    };
    const svc = buildService(openRouter, prisma);
    const res = await svc.summarizeCluster({
      productClusterId: 'cluster-1',
      samplesByBand: { '1-2': [], '3': [], '4-5': ['Produto muito resistente', 'Fácil de montar e resistente'] },
      reviewsCountAt: 42,
    });
    expect(res).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(logs.some((l) => JSON.stringify(l).includes('"ok"'))).toBe(true);
  });

  it('descarta motivo fora da amostra e registra rejected_validation', async () => {
    const created: unknown[] = [];
    const logs: Array<{ status?: string }> = [];
    const prisma = {
      reviewSummary: { create: jest.fn(async () => { created.push(1); return {}; }) },
      aiCallLog: {
        create: jest.fn(async (args: { data: { status: string } }) => { logs.push(args.data); return {}; }),
      },
    };
    const openRouter = {
      chatCompletion: jest.fn(async () => ({
        content: JSON.stringify({
          band: '4-5',
          summary: 'Bom produto.',
          top_reasons: ['bateria solar invisível'],
          sample_size: 1,
        }),
        model: 'test-model',
      })),
    };
    const svc = buildService(openRouter, prisma);
    const res = await svc.summarizeCluster({
      productClusterId: 'cluster-1',
      samplesByBand: { '1-2': [], '3': [], '4-5': ['Entrega rápida, produto bom'] },
    });
    expect(res).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(logs.some((l) => l.status === 'rejected_validation')).toBe(true);
  });
});
