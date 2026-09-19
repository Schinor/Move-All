import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { CardAssignerService } from './card-assigner.service';
import { FichaService } from './ficha.service';
import { buildFichaInput, inputHash } from './ficha-input';
import { TaxonomyService } from './taxonomy.service';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 'type-spin', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'B', namePt: 'Bike spinning', descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
  comparisonAttrs: [], variationAttrs: [],
};

function build() {
  const prisma = {
    listingFicha: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'f-new', status: 'pending', priority: 100, attempts: 0, ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => ({ id: where.id, marketplace: 'ml', externalProductId: 'X', ...data })),
    },
    productClusterItem: { findUnique: jest.fn().mockResolvedValue(null) },
    intelligenceProduct: { findFirst: jest.fn().mockResolvedValue(null) },
    catalogDecision: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
    },
    aiCallLog: { count: jest.fn().mockResolvedValue(0) },
  };
  const taxonomy = { getTypeMap: jest.fn().mockResolvedValue(new Map([[SPIN.key, SPIN]])) };
  const assigner = {
    assign: jest.fn().mockResolvedValue({ outcome: 'confirmed', clusterId: 'c1', touched: ['c1'] }),
    ensureListingReview: jest.fn(),
    refreshMany: jest.fn(),
  };
  const llm = { chatCompletion: jest.fn() };
  const service = new FichaService(
    prisma as unknown as PrismaService,
    taxonomy as unknown as TaxonomyService,
    assigner as unknown as CardAssignerService,
    llm as unknown as OpenRouterService,
  );
  return { service, prisma, assigner, llm };
}

describe('FichaService.registerListing', () => {
  it('cria ficha pendente com hash do título normalizado', async () => {
    const { service, prisma } = build();
    const result = await service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike 13kg (AMAZON)' });
    expect(result).toBe('created');
    expect(prisma.listingFicha.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      marketplace: 'ml', externalProductId: 'X', inputHash: inputHash(buildFichaInput('Bike 13kg')), priority: 100 }) });
  });

  it('mesmo hash e ficha pronta: não faz nada se o anúncio já tem card', async () => {
    const { service, prisma, assigner } = build();
    prisma.listingFicha.findUnique.mockResolvedValue({ id: 'f1', inputHash: inputHash('Bike'), status: 'done', typeKey: 'spin_bike', inScope: true });
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1' });
    await expect(service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike' })).resolves.toBe('unchanged');
    expect(assigner.assign).not.toHaveBeenCalled();
  });

  it('copia de ficha gêmea (mesmo hash) e monta o card sem LLM', async () => {
    const { service, prisma, assigner } = build();
    prisma.listingFicha.findFirst.mockResolvedValue({ id: 'twin', status: 'done', typeKey: 'spin_bike', inScope: true,
      cardKeyValues: { resistencia: 'magnetica' }, missingKeyAttrs: [], copiedFromFichaId: null });
    await expect(service.registerListing({ marketplace: 'ml', externalProductId: 'X', title: 'Bike' })).resolves.toBe('assigned');
    expect(prisma.listingFicha.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'done', typeKey: 'spin_bike', copiedFromFichaId: 'twin' }) }));
    expect(assigner.assign).toHaveBeenCalled();
  });
});

describe('FichaService.runOnce', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, FICHA_ENABLED: 'true', FICHA_BATCH_SIZE: '2', FICHA_DAILY_CALL_LIMIT: '35' }; });
  afterEach(() => { process.env = env; });

  it('desligado não faz nada', async () => {
    process.env.FICHA_ENABLED = 'false';
    const { service, llm } = build();
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'disabled' });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('sem saldo no dia não chama a LLM', async () => {
    const { service, prisma, llm } = build();
    prisma.aiCallLog.count.mockResolvedValue(40);
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 }]);
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'budget', calls: 0 });
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });

  it('gera fichas do lote, reenfileira quem não voltou e recalcula os cards uma vez', async () => {
    const { service, prisma, llm, assigner } = build();
    prisma.listingFicha.findMany
      .mockResolvedValueOnce([
        { id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 },
        { id: 'b', marketplace: 'ml', externalProductId: 'B', title: 'Bike B', inputHash: 'h2', attempts: 2 },
      ])
      .mockResolvedValueOnce([]);
    llm.chatCompletion.mockResolvedValue({
      content: '{"ref":"L1","type_key":"spin_bike","in_scope":true,"card_key_values":{"resistencia":"magnetica"}}',
      model: 'm',
    });
    const summary = await service.runOnce();
    expect(summary).toMatchObject({ calls: 1, done: 1, failed: 1, stoppedBy: 'empty' });
    expect(llm.chatCompletion).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      endpointName: 'catalog-ficha', maxTokens: 20000, timeoutMs: 120000 }));
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: expect.objectContaining({
      status: 'done', typeKey: 'spin_bike', cardKeyValues: { resistencia: 'magnetica' }, promptVersion: 'ficha-v1', llmModel: 'm' }) });
    // "b" já tinha 2 tentativas: a 3ª falha volta para a fila com prioridade de reprocessamento.
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: expect.objectContaining({
      status: 'error', attempts: 3, lastError: 'sem resposta no lote' }) });
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: {
      status: 'pending', attempts: 0, priority: 10, lastError: 'sem resposta no lote',
    } });
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'auto_requeue', actorUserId: null,
    }) });
    expect(assigner.ensureListingReview).not.toHaveBeenCalled();
    expect(assigner.refreshMany).toHaveBeenCalledTimes(1);
  });

  it('T6: primeira e segunda falha voltam à fila; a terceira cria revisão', async () => {
    const previous = process.env.CATALOG_AUTO_MAX_REQUEUES;
    process.env.CATALOG_AUTO_MAX_REQUEUES = '2';
    try {
      const { service, prisma, assigner } = build();
      const ficha = { id: 'f1', marketplace: 'ml', externalProductId: 'X', attempts: 2 };
      prisma.listingFicha.update.mockImplementation(({ where, data }) => ({ ...ficha, id: where.id, ...data }));
      prisma.catalogDecision.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ before: { listing: { marketplace: 'ml', externalProductId: 'X' } }, after: {} }])
        .mockResolvedValueOnce([
          { before: { listing: { marketplace: 'ml', externalProductId: 'X' } }, after: {} },
          { before: { listing: { marketplace: 'ml', externalProductId: 'X' } }, after: {} },
        ]);
      prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'card-x' });
      const internal = service as unknown as {
        bumpAttempts: (fichas: typeof ficha[], error: string, refresh: unknown[]) => Promise<number>;
      };

      await internal.bumpAttempts([ficha], 'falha 1', []);
      await internal.bumpAttempts([ficha], 'falha 2', []);
      await internal.bumpAttempts([ficha], 'falha 3', []);

      expect(prisma.catalogDecision.create).toHaveBeenCalledTimes(2);
      expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'auto_requeue' }) });
      expect(assigner.ensureListingReview).toHaveBeenCalledWith(
        { marketplace: 'ml', externalProductId: 'X' }, 'card-x', 'ficha falhou 3 vezes',
      );
    } finally {
      if (previous === undefined) delete process.env.CATALOG_AUTO_MAX_REQUEUES;
      else process.env.CATALOG_AUTO_MAX_REQUEUES = previous;
    }
  });

  it('reenvia uma vez pela metade quando o lote não traz nenhuma linha válida', async () => {
    const { service, prisma, llm } = build();
    prisma.listingFicha.findMany
      .mockResolvedValueOnce([
        { id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 },
        { id: 'b', marketplace: 'ml', externalProductId: 'B', title: 'Bike B', inputHash: 'h2', attempts: 0 },
      ])
      .mockResolvedValueOnce([]);
    llm.chatCompletion
      .mockResolvedValueOnce({ content: 'resposta sem JSON', model: 'm' })
      .mockResolvedValueOnce({
        content: '{"ref":"L1","type_key":"spin_bike","in_scope":true,"card_key_values":{"resistencia":"magnetica"}}',
        model: 'm',
      });

    const summary = await service.runOnce();

    expect(summary).toMatchObject({ calls: 2, done: 1, failed: 1, stoppedBy: 'empty' });
    expect(llm.chatCompletion).toHaveBeenCalledTimes(2);
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: expect.objectContaining({ status: 'done' }) });
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: expect.objectContaining({ attempts: 1, lastError: 'sem resposta no lote' }) });
  });

  it('para no limite diário do provedor', async () => {
    const { service, prisma, llm } = build();
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'a', marketplace: 'ml', externalProductId: 'A', title: 'Bike A', inputHash: 'h1', attempts: 0 }]);
    llm.chatCompletion.mockRejectedValue(new ServiceUnavailableException('Falha na API do OpenRouter: OpenRouter API HTTP 429: {"error":{"message":"Rate limit exceeded: free-models-per-day"}}'));
    await expect(service.runOnce()).resolves.toMatchObject({ stoppedBy: 'daily_limit' });
    expect(prisma.listingFicha.update).not.toHaveBeenCalled();
  });
});

describe('FichaService.currentCardId', () => {
  it('devolve o cluster do item ou null', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValueOnce({ clusterId: 'c9' }).mockResolvedValueOnce(null);
    await expect(service.currentCardId({ marketplace: 'ml', externalProductId: 'X' })).resolves.toBe('c9');
    await expect(service.currentCardId({ marketplace: 'ml', externalProductId: 'Y' })).resolves.toBeNull();
  });
});
