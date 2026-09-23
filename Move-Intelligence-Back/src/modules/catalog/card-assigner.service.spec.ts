import { ListingFicha } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardAssignerService } from './card-assigner.service';
import { TaxonomyService } from './taxonomy.service';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 'type-spin', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [
    { value: 'magnetica', label_pt: 'magnética' }, { value: 'friccao', label_pt: 'por fricção' }] }],
  comparisonAttrs: [], variationAttrs: [],
};

function ficha(partial: Partial<ListingFicha>): ListingFicha {
  return {
    id: 'f1', marketplace: 'mercado_livre', externalProductId: 'MLB1', title: 't', inputHash: 'h', status: 'done',
    priority: 100, attempts: 0, lastError: null, typeKey: 'spin_bike', suggestedType: null, inScope: true,
    isAccessoryOrPart: false, isKitOrBundle: false, hasVariations: false, cardKeyValues: { resistencia: 'magnetica' },
    newDifferential: null, missingKeyAttrs: [], comparisonValues: {}, variationValues: {}, specs: {}, brand: null,
    model: null, confidence: null, llmModel: null, promptVersion: null, copiedFromFichaId: null,
    createdAt: new Date(), updatedAt: new Date(), ...partial,
  } as ListingFicha;
}

function build() {
  const prisma = {
    productClusterItem: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(), update: jest.fn(), delete: jest.fn(),
    },
    productCluster: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'card-new' }),
      update: jest.fn(),
    },
    productListingSnapshot: { updateMany: jest.fn() },
    trackedListing: { updateMany: jest.fn() },
    catalogReviewItem: {
      findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'rev1', suggestedTypeAliases: ['squat_cage'] }),
      update: jest.fn().mockImplementation(({ data }) => ({ id: 'rev1', suggestedTypeAliases: data.suggestedTypeAliases ?? ['squat_cage'] })),
      updateMany: jest.fn(),
    },
    catalogDecision: {
      create: jest.fn().mockResolvedValue({ id: 'decision-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    listingFicha: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
    catalogType: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const taxonomy = { getTypeMap: jest.fn().mockResolvedValue(new Map([[SPIN.key, SPIN]])) };
  const service = new CardAssignerService(prisma as unknown as PrismaService, taxonomy as unknown as TaxonomyService);
  return { service, prisma, taxonomy };
}

describe('CardAssignerService.assign — regras R1–R7', () => {
  it('R1: fora do escopo remove o anúncio de qualquer card', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'old' });
    const r = await service.assign(ficha({ inScope: false }), { deferRefresh: true });
    expect(r.outcome).toBe('out_of_scope');
    expect(prisma.productClusterItem.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenCalledWith({
      where: { marketplace: 'mercado_livre', externalProductId: 'MLB1' }, data: { productClusterId: null } });
  });

  it('R2: tipo desconhecido registra tipo sugerido e não cria card', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ typeKey: 'unknown', suggestedType: 'squat_cage' }), { deferRefresh: true });
    expect(r.outcome).toBe('suggested_type');
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'suggested_type', suggestedTypeKey: 'squat_cage' }) }));
    expect(prisma.productCluster.create).not.toHaveBeenCalled();
  });

  it('R3: chave completa entra no card ativo existente como confirmed', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findFirst.mockResolvedValue({ id: 'card-1' });
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r).toEqual({ outcome: 'confirmed', clusterId: 'card-1', touched: ['card-1'] });
    expect(prisma.productCluster.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { cardKey: 'spin_bike|resistencia=magnetica', cardStatus: { in: ['provisional', 'confirmed'] } } }));
    expect(prisma.productClusterItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: 'card-1', status: 'confirmed' }) });
  });

  it('R4: chave completa sem card cria card confirmado com nome montado', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r.clusterId).toBe('card-new');
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      canonicalName: 'Bike spinning magnética', category: 'spinning_bike', typeId: 'type-spin',
      cardKey: 'spin_bike|resistencia=magnetica', cardStatus: 'confirmed' }) });
  });

  it('R4 + adoção: cluster legacy do anúncio vira o card', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'legacy-1' });
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'legacy-1', cardStatus: 'legacy', cardKey: null, nameLocked: false });
    const r = await service.assign(ficha({}), { deferRefresh: true });
    expect(r.clusterId).toBe('legacy-1');
    expect(prisma.productCluster.create).not.toHaveBeenCalled();
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'legacy-1' }, data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=magnetica', cardStatus: 'confirmed', canonicalName: 'Bike spinning magnética' }) });
  });

  it('R5: diferencial novo cria card provisional e item de revisão', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ newDifferential: 'water_tank' }), { deferRefresh: true });
    expect(r.outcome).toBe('provisional');
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=magnetica|diferencial=water_tank', cardStatus: 'provisional' }) });
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: 'provisional_listing', reason: 'diferencial novo: water_tank' }) });
  });

  it('R6: atributo faltando entra no card mais provável como provisional', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findMany.mockResolvedValue([
      { id: 'card-a', cardKeyValues: { resistencia: 'friccao' }, createdAt: new Date('2026-01-01'), items: [{ id: '1' }] },
      { id: 'card-b', cardKeyValues: { resistencia: 'magnetica' }, createdAt: new Date('2026-02-01'), items: [{ id: '1' }, { id: '2' }] },
    ]);
    const r = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });
    expect(r).toMatchObject({ outcome: 'provisional', clusterId: 'card-b' });
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: 'falta a especificação: resistência' }) });
  });

  it('R6 sem card do tipo: cria card provisional com "?" na chave', async () => {
    const { service, prisma } = build();
    await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });
    expect(prisma.productCluster.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      cardKey: 'spin_bike|resistencia=?', cardStatus: 'provisional' }) });
  });

  it('T4: um candidato confirmado contado vira auto e resolve a revisão', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findMany.mockResolvedValue([
      { id: 'card-a', cardStatus: 'confirmed', cardKeyValues: {}, items: [{ id: 'item-a' }] },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ cluster_id: 'card-a', similarity: 0.8 }]);
    prisma.catalogReviewItem.findFirst.mockResolvedValue({ id: 'review-a' });

    const result = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'auto', clusterId: 'card-a' });
    expect(prisma.productClusterItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: 'card-a', status: 'auto' }) });
    expect(prisma.catalogReviewItem.updateMany).toHaveBeenCalledWith({
      where: { kind: 'provisional_listing', status: 'pending', marketplace: 'mercado_livre', externalProductId: 'MLB1' },
      data: expect.objectContaining({ status: 'resolved', resolution: 'auto' }),
    });
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'auto_assign', actorUserId: null, reviewItemId: 'review-a',
      before: expect.objectContaining({ clusterId: null }),
      after: expect.objectContaining({ clusterId: 'card-a', status: 'auto', rule: 'single_candidate' }),
    }) });
  });

  it('T4: dois candidatos com vencedor claro viram auto pelo melhor score', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findMany.mockResolvedValue([
      { id: 'card-a', cardStatus: 'confirmed', cardKeyValues: {}, items: [{ id: 'item-a' }] },
      { id: 'card-b', cardStatus: 'confirmed', cardKeyValues: {}, items: [{ id: 'item-b' }] },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { cluster_id: 'card-a', similarity: 0.91 },
      { cluster_id: 'card-b', similarity: 0.55 },
    ]);

    const result = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'auto', clusterId: 'card-a' });
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'auto_assign', after: expect.objectContaining({ rule: 'best_similarity' }),
    }) });
  });

  it('T4: empate mantém o fluxo provisional e o motivo da revisão', async () => {
    const { service, prisma } = build();
    const cards = [
      { id: 'card-a', cardStatus: 'confirmed', cardKeyValues: {}, createdAt: new Date('2026-01-01'), items: [{ id: 'item-a' }] },
      { id: 'card-b', cardStatus: 'confirmed', cardKeyValues: {}, createdAt: new Date('2026-02-01'), items: [{ id: 'item-b' }] },
    ];
    prisma.productCluster.findMany.mockResolvedValue(cards);
    prisma.$queryRaw.mockResolvedValue([
      { cluster_id: 'card-a', similarity: 0.50 },
      { cluster_id: 'card-b', similarity: 0.45 },
    ]);

    const result = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'provisional', clusterId: 'card-a' });
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      reason: 'empate entre cards: card-a, card-b',
    }) });
    expect(prisma.catalogDecision.create).not.toHaveBeenCalled();
  });

  it('T4: com atribuição automática desabilitada mantém o comportamento provisional', async () => {
    const previous = process.env.CATALOG_AUTO_ASSIGN_ENABLED;
    process.env.CATALOG_AUTO_ASSIGN_ENABLED = 'false';
    try {
      const { service, prisma } = build();
      prisma.productCluster.findMany.mockResolvedValue([
        { id: 'card-a', cardStatus: 'confirmed', cardKeyValues: {}, items: [{ id: 'item-a' }] },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ cluster_id: 'card-a', similarity: 0.99 }]);

      const result = await service.assign(ficha({ cardKeyValues: {} }), { deferRefresh: true });

      expect(result).toMatchObject({ outcome: 'provisional', clusterId: 'card-a' });
      expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        reason: 'falta a especificação: resistência',
      }) });
      expect(prisma.catalogDecision.create).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.CATALOG_AUTO_ASSIGN_ENABLED;
      else process.env.CATALOG_AUTO_ASSIGN_ENABLED = previous;
    }
  });

  it('R7: ficha em erro vai para revisão sem mover o anúncio', async () => {
    const { service, prisma } = build();
    const r = await service.assign(ficha({ status: 'error' }), { deferRefresh: true });
    expect(r.outcome).toBe('error_review');
    expect(prisma.productClusterItem.create).not.toHaveBeenCalled();
    expect(prisma.catalogReviewItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reason: 'ficha falhou' }) });
  });

  it('T5: diferencial abaixo do limite entra no card-base como auto', async () => {
    const { service, prisma } = build();
    prisma.listingFicha.findMany.mockResolvedValue([
      { marketplace: 'mercado_livre', externalProductId: 'MLB1', newDifferential: 'water_tank' },
      { marketplace: 'mercado_livre', externalProductId: 'MLB2', newDifferential: 'water_tank' },
    ]);
    prisma.productCluster.findMany.mockResolvedValue([
      {
        id: 'card-base', cardStatus: 'confirmed', cardKeyValues: { resistencia: '?' },
        createdAt: new Date('2026-01-01'), items: [{ id: 'item-base' }],
      },
    ]);
    prisma.catalogReviewItem.findFirst.mockResolvedValue({ id: 'review-diff' });

    const result = await service.assign(ficha({ cardKeyValues: {}, newDifferential: 'water_tank' }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'auto', clusterId: 'card-base' });
    expect(prisma.productClusterItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      clusterId: 'card-base', status: 'auto',
    }) });
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'auto_assign', after: expect.objectContaining({ note: 'diferencial pendente: water_tank' }),
    }) });
  });

  it('T5: diferencial em 3 anúncios e 2 lojas promove o card e move todos', async () => {
    const { service, prisma } = build();
    prisma.listingFicha.findMany.mockResolvedValue([
      { marketplace: 'mercado_livre', externalProductId: 'MLB1', newDifferential: 'water_tank' },
      { marketplace: 'mercado_livre', externalProductId: 'MLB2', newDifferential: 'water_tank' },
      { marketplace: 'shopee_br', externalProductId: 'SHP1', newDifferential: 'water_tank' },
    ]);
    prisma.catalogType.findUnique.mockResolvedValue({ cardKeyAttrs: [] });
    prisma.productCluster.create.mockResolvedValue({ id: 'card-new' });

    const result = await service.assign(ficha({ cardKeyValues: {}, newDifferential: 'water_tank' }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'auto', clusterId: 'card-new' });
    expect(prisma.catalogType.update).toHaveBeenCalledWith({ where: { id: 'type-spin' }, data: {
      cardKeyAttrs: [{ attr: 'diferencial', label_pt: 'diferencial', values: [
        { value: 'nenhum', label_pt: 'sem diferencial' }, { value: 'water_tank', label_pt: '' },
      ] }],
    } });
    expect(prisma.productClusterItem.create).toHaveBeenCalledTimes(3);
    expect(prisma.productClusterItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ clusterId: 'card-new', status: 'auto' }) });
    expect(prisma.catalogDecision.create).toHaveBeenCalledTimes(3);
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'auto_promote_differential', actorUserId: null,
      after: expect.objectContaining({ note: 'diferencial promovido: water_tank', status: 'auto' }),
    }) });
  });

  it('T5: depois da promoção, o 4º anúncio com o diferencial permitido entra confirmado', async () => {
    const { service, prisma, taxonomy } = build();
    prisma.listingFicha.findMany.mockResolvedValue([
      { marketplace: 'mercado_livre', externalProductId: 'MLB1', newDifferential: 'water_tank' },
      { marketplace: 'mercado_livre', externalProductId: 'MLB2', newDifferential: 'water_tank' },
      { marketplace: 'shopee_br', externalProductId: 'SHP1', newDifferential: 'water_tank' },
    ]);
    prisma.catalogType.findUnique.mockResolvedValue({ cardKeyAttrs: [] });
    prisma.productCluster.create.mockResolvedValue({ id: 'card-new' });
    await service.assign(ficha({ cardKeyValues: {}, newDifferential: 'water_tank' }), { deferRefresh: true });

    const promotedType: CatalogTypeDef = {
      ...SPIN,
      cardKeyAttrs: [
        ...SPIN.cardKeyAttrs,
        { attr: 'diferencial', label_pt: 'diferencial', values: [
          { value: 'nenhum', label_pt: 'sem diferencial' },
          { value: 'water_tank', label_pt: '' },
        ] },
      ],
    };
    taxonomy.getTypeMap.mockResolvedValueOnce(new Map([[promotedType.key, promotedType]]));
    prisma.productCluster.findFirst.mockResolvedValue({ id: 'card-new' });

    const result = await service.assign(ficha({
      id: 'f4', marketplace: 'amazon_br', externalProductId: 'AMZ1',
      cardKeyValues: { resistencia: 'magnetica' }, newDifferential: 'water_tank',
    }), { deferRefresh: true });

    expect(result).toMatchObject({ outcome: 'confirmed', clusterId: 'card-new' });
    expect(prisma.productClusterItem.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({
      clusterId: 'card-new', status: 'confirmed', marketplace: 'amazon_br', externalProductId: 'AMZ1',
    }) });
  });
});

describe('CardAssignerService.refreshCard', () => {
  it('card legacy vazio vira merged apontando para o destino', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'legacy-1', cardStatus: 'legacy', cardKey: null, items: [] });
    await service.refreshCard('legacy-1', 'card-9');
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'legacy-1' }, data: { cardStatus: 'merged', mergedIntoId: 'card-9', simulatedAt: null } });
  });

  it('card com confirmado + provisório: exclui provisórios das análises e fica confirmed', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({
      id: 'c1', cardStatus: 'provisional', cardKey: 'spin_bike|resistencia=magnetica', typeId: 'type-spin', nameLocked: false,
      cardKeyValues: { resistencia: 'magnetica' },
      items: [
        { marketplace: 'ml', externalProductId: 'A', status: 'confirmed' },
        { marketplace: 'ml', externalProductId: 'B', status: 'provisional' },
      ],
    });
    await service.refreshCard('c1');
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenNthCalledWith(1, { where: { productClusterId: 'c1' }, data: { analyticsExcluded: false } });
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenNthCalledWith(2, {
      where: { productClusterId: 'c1', OR: [{ marketplace: 'ml', externalProductId: 'B' }] }, data: { analyticsExcluded: true } });
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: {
      cardStatus: 'confirmed', simulatedAt: null, canonicalName: 'Bike spinning magnética' } });
  });

  it('card só com provisórios: nada excluído das análises e fica provisional', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({
      id: 'c1', cardStatus: 'confirmed', cardKey: 'k', typeId: 'type-spin', nameLocked: true, cardKeyValues: {},
      items: [{ marketplace: 'ml', externalProductId: 'B', status: 'provisional' }],
    });
    await service.refreshCard('c1');
    expect(prisma.productListingSnapshot.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { cardStatus: 'provisional', simulatedAt: null } });
  });

  it('card só com itens auto fica confirmed', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({
      id: 'c1', cardStatus: 'provisional', cardKey: 'k', typeId: 'type-spin', nameLocked: true, cardKeyValues: {},
      items: [{ marketplace: 'ml', externalProductId: 'A', status: 'auto' }],
    });
    await service.refreshCard('c1');
    expect(prisma.productCluster.update).toHaveBeenCalledWith({
      where: { id: 'c1' }, data: { cardStatus: 'confirmed', simulatedAt: null },
    });
  });
});

describe('CardAssignerService.guardHuman', () => {
  it('guardHuman: anúncio posto no card por ADMIN não muda de card; abre revisão', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'card-admin', status: 'confirmed' });
    prisma.catalogDecision.findFirst.mockResolvedValue({ after: { clusterId: 'card-admin', listing: { marketplace: 'amazon', externalProductId: 'X' } } });
    const ensure = jest.spyOn(service, 'ensureListingReview').mockResolvedValue(undefined);
    const out = await service.moveListing({ marketplace: 'amazon', externalProductId: 'X' }, 'card-outro', 'confirmed', { guardHuman: true });
    expect(out.blocked).toBe(true);
    expect(prisma.productClusterItem.update).not.toHaveBeenCalled();
    expect(ensure).toHaveBeenCalledWith({ marketplace: 'amazon', externalProductId: 'X' }, 'card-admin', 'ficha refeita discorda da decisão do ADMIN');
  });

  it('guardHuman: sem decisão de ADMIN, move normalmente', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findUnique.mockResolvedValue({ id: 'i1', clusterId: 'card-a', status: 'auto' });
    prisma.catalogDecision.findFirst.mockResolvedValue(null);
    const out = await service.moveListing({ marketplace: 'amazon', externalProductId: 'X' }, 'card-b', 'confirmed', { guardHuman: true, deferRefresh: true });
    expect(out.blocked).toBeFalsy();
    expect(prisma.productClusterItem.update).toHaveBeenCalled();
  });

  it('humanDecisionCard consulta só decisões de ADMIN não desfeitas do anúncio', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findFirst.mockResolvedValue(null);
    await service.humanDecisionCard({ marketplace: 'amazon', externalProductId: 'X' });
    const where = prisma.catalogDecision.findFirst.mock.calls[0][0].where;
    expect(where).toEqual(expect.objectContaining({
      actorUserId: { not: null },
      undoneByDecisionId: null,
      AND: [
        { after: { path: ['listing', 'marketplace'], equals: 'amazon' } },
        { after: { path: ['listing', 'externalProductId'], equals: 'X' } },
      ],
    }));
  });
});
