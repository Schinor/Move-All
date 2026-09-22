import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardAssignerService } from './card-assigner.service';
import { CatalogReviewService } from './catalog-review.service';

function build() {
  const prisma = {
    catalogReviewItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogDecision: {
      create: jest.fn().mockImplementation(({ data }) => ({ id: 'd1', ...data })),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    productClusterItem: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    productCluster: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    listingFicha: {
      findUnique: jest.fn().mockResolvedValue({ inScope: true }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    catalogFamily: { findUnique: jest.fn() },
    catalogType: { create: jest.fn().mockResolvedValue({ id: 'type-new' }), findUnique: jest.fn() },
    productListingSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    trackedListing: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const assigner = {
    moveListing: jest.fn().mockResolvedValue({ fromClusterId: 'c1', touched: [] }),
    createCardForType: jest.fn().mockResolvedValue('c-new'),
    assign: jest.fn(),
    resolveListingReviews: jest.fn(),
    invalidateTypeCache: jest.fn(),
  };
  const service = new CatalogReviewService(prisma as unknown as PrismaService, assigner as unknown as CardAssignerService);
  return { service, prisma, assigner };
}

const LISTING_REVIEW = { id: 'r1', kind: 'provisional_listing', status: 'pending', marketplace: 'ml', externalProductId: 'X', suggestedClusterId: 'c1' };

describe('CatalogReviewService', () => {
  it('confirm confirma no card sugerido, resolve o item e grava a decisão', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c1', status: 'provisional' });
    const r = await service.confirm('r1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'c1', 'confirmed');
    expect(assigner.resolveListingReviews).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'confirm', 'admin-1');
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'confirm', actorUserId: 'admin-1', reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'confirmed', inScope: true } }) });
    expect(r.decisionId).toBe('d1');
  });

  it('move exige card de destino ativo', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'c2', cardStatus: 'merged' });
    await expect(service.move('r1', 'c2', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('outOfScope tira de qualquer card e marca a ficha', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue(LISTING_REVIEW);
    await service.outOfScope('r1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, null, 'confirmed');
    expect(prisma.listingFicha.update).toHaveBeenCalledWith({
      where: { marketplace_externalProductId: { marketplace: 'ml', externalProductId: 'X' } }, data: { inScope: false } });
  });

  it('item já resolvido não pode ser decidido de novo', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ ...LISTING_REVIEW, status: 'resolved' });
    await expect(service.confirm('r1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('undo recusa quando o estado mudou depois da decisão', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd1', action: 'move', undoneByDecisionId: null, reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c2', status: 'confirmed', inScope: true } });
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c3', status: 'confirmed' });
    await expect(service.undo('d1', 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('undo aplica o estado anterior e reabre o item', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd1', action: 'move', undoneByDecisionId: null, reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c2', status: 'confirmed', inScope: true } });
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c2', status: 'confirmed' });
    await service.undo('d1', 'admin-1');
    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'c1', 'provisional');
    expect(prisma.catalogReviewItem.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null } });
    expect(prisma.catalogDecision.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { undoneByDecisionId: 'd1' } });
  });

  it('undo de decisão automática aceita actor nulo e devolve o anúncio à revisão', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd-auto', action: 'auto_assign', actorUserId: null, undoneByDecisionId: null, reviewItemId: 'r1',
      before: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'provisional', inScope: true },
      after: { listing: { marketplace: 'ml', externalProductId: 'X' }, clusterId: 'c1', status: 'auto', inScope: true } });
    prisma.productClusterItem.findUnique.mockResolvedValue({ clusterId: 'c1', status: 'auto' });

    await service.undo('d-auto', 'admin-1');

    expect(assigner.moveListing).toHaveBeenCalledWith({ marketplace: 'ml', externalProductId: 'X' }, 'c1', 'provisional');
    expect(prisma.catalogReviewItem.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'pending', resolution: null, resolvedBy: null, resolvedAt: null } });
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'undo', actorUserId: 'admin-1' }) });
  });

  it('undo de ação de tipo é recusado', async () => {
    const { service, prisma } = build();
    prisma.catalogDecision.findUnique.mockResolvedValue({ id: 'd9', action: 'approve_type', undoneByDecisionId: null });
    await expect(service.undo('d9', 'admin-1')).rejects.toThrow('esta ação não pode ser desfeita');
  });

  it('approveType cria o tipo e monta os anúncios que o sugeriram, sem LLM', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ id: 'r2', kind: 'suggested_type', status: 'pending', suggestedTypeAliases: ['power_rack', 'squat_cage'] });
    prisma.catalogFamily.findUnique.mockResolvedValue({ id: 'fam-1', key: 'commercial_gym_equipment' });
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    const r = await service.approveType('r2', { familyKey: 'commercial_gym_equipment', key: 'squat_rack', namePt: 'Suporte' }, 'admin-1');
    expect(prisma.catalogType.create).toHaveBeenCalledWith({ data: expect.objectContaining({ key: 'squat_rack', familyId: 'fam-1', source: 'approved' }) });
    expect(assigner.invalidateTypeCache).toHaveBeenCalled();
    expect(prisma.listingFicha.updateMany).toHaveBeenCalledWith({
      where: { typeKey: 'unknown', suggestedType: { in: ['power_rack', 'squat_cage'] }, inScope: { not: false } },
      data: { typeKey: 'squat_rack', suggestedType: null } });
    expect(assigner.assign).toHaveBeenCalledTimes(2);
    expect(r.typeId).toBe('type-new');
  });

  it('mergeType devolve as fichas para a fila com prioridade 200', async () => {
    const { service, prisma } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({ id: 'r2', kind: 'suggested_type', status: 'pending', suggestedTypeAliases: ['squat_cage'] });
    prisma.catalogType.findUnique.mockResolvedValue({ id: 't', key: 'power_rack' });
    const r = await service.mergeType('r2', 'power_rack', 'admin-1');
    expect(prisma.listingFicha.updateMany).toHaveBeenCalledWith({
      where: { typeKey: 'unknown', suggestedType: { in: ['squat_cage'] }, inScope: { not: false } },
      data: { status: 'pending', priority: 200, attempts: 0, lastError: null } });
    expect(r.requeued).toBe(2);
  });

  it('mergeSuggestedTypeToExisting reatribui fichas sem LLM e audita com actor nulo', async () => {
    const { service, prisma, assigner } = build();
    prisma.catalogReviewItem.findUnique.mockResolvedValue({
      id: 'r2', kind: 'suggested_type', status: 'pending', suggestedTypeAliases: ['pilates_half_moon'],
    });
    prisma.catalogType.findUnique.mockResolvedValue({ id: 'type-barrel', key: 'pilates_barrel' });
    prisma.listingFicha.findMany.mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    prisma.listingFicha.findUnique.mockResolvedValue({ id: 'f1', status: 'done' });

    const result = await service.mergeSuggestedTypeToExisting('r2', 'pilates_barrel');

    expect(prisma.listingFicha.updateMany).toHaveBeenCalledWith({
      where: { typeKey: 'unknown', suggestedType: { in: ['pilates_half_moon'] }, inScope: { not: false } },
      data: { typeKey: 'pilates_barrel', suggestedType: null },
    });
    expect(assigner.assign).toHaveBeenCalledTimes(2);
    expect(prisma.catalogDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: 'merge_type', actorUserId: null, reviewItemId: 'r2',
    }) });
    expect(result.reattributed).toBe(2);
  });

  it('renameCard trava o nome e registra a decisão', async () => {
    const { service, prisma } = build();
    prisma.productCluster.findUnique.mockResolvedValue({ id: 'c1', canonicalName: 'Bike spinning magnética', nameLocked: false });
    await service.renameCard('c1', 'Bike spinning magnética 13 kg', 'admin-1');
    expect(prisma.productCluster.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { canonicalName: 'Bike spinning magnética 13 kg', nameLocked: true } });
  });

  it('listCardListings devolve o acompanhamento de cada anúncio', async () => {
    const { service, prisma } = build();
    prisma.productClusterItem.findMany.mockResolvedValue([
      { marketplace: 'amazon_br', externalProductId: 'A1', status: 'confirmed' },
      { marketplace: 'alibaba', externalProductId: 'B1', status: 'auto' },
    ]);
    prisma.listingFicha.findMany.mockResolvedValue([]);
    prisma.productListingSnapshot.findMany.mockResolvedValue([]);
    prisma.trackedListing.findMany.mockResolvedValue([
      { source: 'amazon_br', nativeId: 'A1', status: 'ACTIVE', tier: 1, tierReason: 'top50', lastSuccessAt: new Date('2026-09-20T00:00:00.000Z') },
    ]);

    const out = await service.listCardListings('c1');

    expect(out[0].tracking).toEqual({ status: 'ACTIVE', tier: 1, reason: 'top50', cadence_days: 3.5, last_success_at: '2026-09-20T00:00:00.000Z' });
    expect(out[1].tracking).toBeNull();
  });
});
