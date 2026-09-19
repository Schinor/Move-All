import { runAutoResolve } from './catalog-auto-resolve';
import { CardAssignerService } from '../src/modules/catalog/card-assigner.service';
import { FichaService } from '../src/modules/catalog/ficha.service';
import { PrismaService } from '../src/shared/database/prisma.service';

describe('catalog:auto-resolve', () => {
  it('dry-run não chama nenhuma escrita do Prisma nem os caminhos de aplicação', async () => {
    const prisma = {
      catalogReviewItem: {
        findMany: jest.fn().mockResolvedValue([{ marketplace: 'ml', externalProductId: 'X' }]),
      },
      listingFicha: {
        findUnique: jest.fn().mockResolvedValue({
          title: 'Bike magnética', marketplace: 'ml', externalProductId: 'X', status: 'done',
        }),
      },
      catalogDecision: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const assigner = {
      previewAutoResolution: jest.fn().mockResolvedValue({ kind: 'single_candidate', clusterId: 'c1', similarity: 0.8 }),
      assign: jest.fn(), refreshMany: jest.fn(),
    };
    const fichas = { autoResolveError: jest.fn() };

    const result = await runAutoResolve({
      prisma: prisma as unknown as PrismaService,
      assigner: assigner as unknown as CardAssignerService,
      fichas: fichas as unknown as FichaService,
    }, { apply: false });

    expect(result).toMatchObject({ mode: 'dry-run', pendingReviews: 1, inspected: 1, singleCandidate: 1 });
    expect(assigner.previewAutoResolution).toHaveBeenCalledTimes(1);
    expect(assigner.assign).not.toHaveBeenCalled();
    expect(assigner.refreshMany).not.toHaveBeenCalled();
    expect(fichas.autoResolveError).not.toHaveBeenCalled();
  });
});
