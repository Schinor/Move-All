import { DEFAULT_FX_USD_BRL } from '../../shared/fx/fx.constants';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { ProductsService } from './products.service';

function buildService(exchangeRows: Array<{ rate: number }>) {
  const prisma = {
    productCluster: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cluster-1',
        snapshots: [{ priceMin: 600, salesSignalRaw: 100 }],
      }),
    },
    exchangeRate: {
      findMany: jest.fn().mockResolvedValue(exchangeRows.map((row) => ({ rate: row.rate }))),
    },
  };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    {} as OpenRouterService,
  );
  return service;
}

describe('ProductsService — câmbio único (F1.7)', () => {
  it('usa a cotação de exchange_rates com origem observada', async () => {
    const service = buildService([{ rate: 6.0 }]);

    const defaults = await service.getUnitEconomicsDefaults('cluster-1');

    expect(defaults.cambioUsd).toBe(6.0);
    expect(defaults.premiseSources).toMatchObject({ cambioUsd: 'observado' });
    // FOB = 600/6*0.18 = 18.
    expect(defaults.fobUsd).toBe(18);
  });

  it('sem cotação, usa o fallback único documentado com origem default', async () => {
    const service = buildService([]);

    const defaults = await service.getUnitEconomicsDefaults('cluster-1');

    expect(defaults.cambioUsd).toBe(DEFAULT_FX_USD_BRL);
    expect(defaults.premiseSources).toMatchObject({ cambioUsd: 'default' });
  });
});
