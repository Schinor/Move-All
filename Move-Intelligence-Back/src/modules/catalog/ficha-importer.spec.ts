import { buildFichaInput, inputHash } from './ficha-input';
import { importManualFichas } from './ficha-importer';
import { CatalogTypeDef } from './taxonomy.types';

const SPIN: CatalogTypeDef = {
  id: 't1', key: 'spin_bike', familyKey: 'spinning_bike', familyNamePt: 'Bikes spinning', namePt: 'Bike spinning',
  descriptionEn: 'x', ncm: null,
  cardKeyAttrs: [{ attr: 'resistencia', label_pt: 'resistência', values: [{ value: 'magnetica', label_pt: 'magnética' }] }],
  comparisonAttrs: [], variationAttrs: [],
};

describe('importManualFichas', () => {
  it('valida, grava a ficha manual e atribui pelo CardAssignerService', async () => {
    const input = buildFichaInput('Bike magnética (ML)');
    const ficha = {
      id: 'ficha-1', marketplace: 'ml', externalProductId: '123', title: 'Bike magnética (ML)',
      inputHash: inputHash(input), status: 'pending', attempts: 0,
    };
    const updated = { ...ficha, status: 'done', llmModel: 'codex-manual', promptVersion: 'ficha-v1' };
    const prisma = {
      listingFicha: {
        findUnique: jest.fn().mockResolvedValue(ficha),
        update: jest.fn().mockResolvedValue(updated),
      },
      productCluster: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'card-1', cardStatus: 'confirmed' }]),
      },
    };
    const taxonomy = { getTypeMap: jest.fn().mockResolvedValue(new Map([[SPIN.key, SPIN]])) };
    const assigner = {
      assign: jest.fn().mockResolvedValue({ outcome: 'confirmed', clusterId: 'card-1', touched: ['card-1'] }),
      refreshMany: jest.fn().mockResolvedValue(undefined),
    };

    const result = await importManualFichas([{
      ref: 'ml::123', marketplace: 'ml', external_product_id: '123', input,
      type_key: 'spin_bike', in_scope: true, card_key_values: { resistencia: 'magnetica' },
    }], {
      prisma: prisma as never,
      taxonomy: taxonomy as never,
      assigner: assigner as never,
    });

    expect(result).toEqual(expect.objectContaining({
      imported: 1, newCards: 1, newConfirmedCards: 1, newProvisionalCards: 0, confirmedAssignments: 1,
    }));
    expect(prisma.listingFicha.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ficha-1' },
      data: expect.objectContaining({ status: 'done', llmModel: 'codex-manual', promptVersion: 'ficha-v1' }),
    }));
    expect(assigner.assign).toHaveBeenCalledWith(updated, { deferRefresh: true });
    expect(assigner.refreshMany).toHaveBeenCalled();
  });
});
