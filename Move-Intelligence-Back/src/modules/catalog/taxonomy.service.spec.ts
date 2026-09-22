import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../shared/database/prisma.service';
import { TaxonomyService, seedTypeToDb } from './taxonomy.service';
import { TaxonomySeedFile } from './taxonomy.types';

const SEED: TaxonomySeedFile = JSON.parse(
  readFileSync(join(__dirname, '../../../prisma/seed/catalog-taxonomy.json'), 'utf-8'),
);

describe('catalog-taxonomy.json', () => {
  it('tem 27 famílias e 94 tipos após a ampliação', () => {
    expect(SEED.families).toHaveLength(27);
    expect(SEED.types).toHaveLength(94);
  });

  it('tem chaves de família e de tipo únicas', () => {
    const fam = SEED.families.map((f) => f.key);
    const types = SEED.types.map((t) => t.key);
    expect(new Set(fam).size).toBe(fam.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it('todo tipo aponta para família existente e tem descrição', () => {
    const fam = new Set(SEED.families.map((f) => f.key));
    for (const t of SEED.types) {
      expect(fam.has(t.family)).toBe(true);
      expect(t.description_en.length).toBeGreaterThan(5);
    }
  });

  it('cobre as 20 famílias que já existem em product_clusters.category', () => {
    const fam = new Set(SEED.families.map((f) => f.key));
    for (const key of [
      'jump_rope', 'yoga_mat', 'commercial_gym_equipment', 'compact_cardio', 'weight_bench',
      'recovery_massage', 'push_up_equipment', 'resistance_bands', 'spinning_bike', 'ab_wheel',
      'functional_training', 'kettlebells', 'dumbbells', 'yoga_pilates', 'rowing_machine',
      'vibration_plate', 'pull_up_equipment', 'smart_fitness', 'protective_gear', 'ankle_weights',
    ]) {
      expect(fam.has(key)).toBe(true);
    }
  });

  it('atributos-chave têm valores não vazios e sem repetição', () => {
    for (const t of SEED.types) {
      for (const a of t.card_key_attrs) {
        const values = a.values.map(([v]) => v);
        expect(values.length).toBeGreaterThan(0);
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });
});

describe('seedTypeToDb', () => {
  it('converte o formato compacto para o JSON do banco', () => {
    const t = SEED.types.find((x) => x.key === 'spin_bike')!;
    const db = seedTypeToDb(t);
    expect(db.cardKeyAttrs).toEqual([
      { attr: 'resistencia', label_pt: 'resistência', values: [
        { value: 'magnetica', label_pt: 'magnética' },
        { value: 'friccao', label_pt: 'por fricção' },
      ] },
    ]);
    expect(db.comparisonAttrs[0]).toEqual({ attr: 'roda_inercia_kg', label_pt: 'roda de inércia', kind: 'number', unit: 'kg' });
    expect(db.comparisonAttrs[2]).toEqual({ attr: 'com_app', label_pt: 'com app', kind: 'boolean' });
  });

  it('preserva aliases no formato gravado', () => {
    const t = SEED.types.find((x) => x.key === 'jump_rope')!;
    expect(seedTypeToDb(t).cardKeyAttrs[0].values.find((value) => value.value === 'smart_app')).toEqual({
      value: 'smart_app', label_pt: 'smart com app', aliases: ['smart'],
    });
  });
});

describe('TaxonomyService', () => {
  it('seedFromFile faz upsert de famílias e tipos e não mexe em tipos aprovados', async () => {
    const prisma = {
      catalogFamily: { upsert: jest.fn().mockImplementation(({ create }) => ({ id: `f-${create.key}`, ...create })) },
      catalogType: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          where.key === 'spin_bike' ? { id: 't1', source: 'approved' } : null),
        upsert: jest.fn(),
      },
      keywordTerm: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const service = new TaxonomyService(prisma as unknown as PrismaService);
    const result = await service.seedFromFile(SEED);
    expect(result.families).toBe(SEED.families.length);
    expect(prisma.catalogType.upsert).toHaveBeenCalledTimes(SEED.types.length - 1);
    expect(prisma.catalogType.upsert.mock.calls.some(([arg]) => arg.where.key === 'spin_bike')).toBe(false);
  });

  it('listActiveTypes converte linhas do banco em CatalogTypeDef', async () => {
    const prisma = {
      catalogType: {
        findMany: jest.fn().mockResolvedValue([{
          id: 't1', key: 'kettlebell', namePt: 'Kettlebell', descriptionEn: 'kettlebell', ncm: '9506.91.00',
          cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: ['peso_kg'],
          family: { key: 'kettlebells', namePt: 'Kettlebells' },
        }]),
      },
    };
    const service = new TaxonomyService(prisma as unknown as PrismaService);
    const [def] = await service.listActiveTypes();
    expect(def).toEqual({
      id: 't1', key: 'kettlebell', familyKey: 'kettlebells', familyNamePt: 'Kettlebells', namePt: 'Kettlebell',
      descriptionEn: 'kettlebell', ncm: '9506.91.00', cardKeyAttrs: [], comparisonAttrs: [], variationAttrs: ['peso_kg'],
    });
    expect(prisma.catalogType.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
  });

  it('seedFromFile faz merge aditivo de atributos e valores existentes', async () => {
    const file: TaxonomySeedFile = {
      families: [{ key: 'vibration_plate', name_pt: 'Plataformas vibratórias', sort: 7 }],
      types: [{
        key: 'vibration_plate', family: 'vibration_plate', name_pt: 'Plataforma', ncm: '9506.91.00', description_en: 'platform',
        card_key_attrs: [{ attr: 'diferencial', label_pt: 'diferencial', values: [['nenhum', 'sem diferencial'], ['bluetooth', 'bluetooth']] }],
        comparison_attrs: [], variation_attrs: [],
      }],
    };
    const prisma = {
      catalogFamily: { upsert: jest.fn().mockResolvedValue({ id: 'fam-1' }) },
      catalogType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'type-1', source: 'seed', ncm: '9506.91.00',
          cardKeyAttrs: [{ attr: 'diferencial', label_pt: 'diferencial', values: [
            { value: 'nenhum', label_pt: 'sem diferencial' }, { value: 'com_elasticos', label_pt: '', aliases: ['com_cordas'] },
          ] }],
          comparisonAttrs: [{ attr: 'carga_max_kg', label_pt: 'carga máx.', kind: 'number', unit: 'kg' }],
          variationAttrs: ['cor'],
        }),
        upsert: jest.fn(),
      },
    };
    const service = new TaxonomyService(prisma as unknown as PrismaService);
    await service.seedFromFile(file);
    expect(prisma.catalogType.upsert).toHaveBeenCalledWith({ where: { key: 'vibration_plate' }, update: expect.objectContaining({
      cardKeyAttrs: [expect.objectContaining({ values: expect.arrayContaining([
        { value: 'com_elasticos', label_pt: '', aliases: ['com_cordas'] },
        { value: 'bluetooth', label_pt: 'bluetooth' },
      ]) })],
      comparisonAttrs: [{ attr: 'carga_max_kg', label_pt: 'carga máx.', kind: 'number', unit: 'kg' }],
      variationAttrs: ['cor'],
    }), create: expect.anything() });
  });
});

describe('TaxonomyService.seedTrendTerms', () => {
  function build(existing: Array<{ id: string; term: string; language: string; category: string; active: boolean }>) {
    const prisma = {
      keywordTerm: {
        findMany: jest.fn().mockResolvedValue(existing),
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    return { service: new TaxonomyService(prisma as never), prisma };
  }

  const file = {
    families: [],
    types: [{ key: 'spin_bike', trend_terms: { pt: 'bike spinning', en: 'spin bike' } }],
  } as never;

  it('cria/ativa os termos pt e en do tipo', async () => {
    const { service, prisma } = build([]);
    const out = await service.seedTrendTerms(file);
    expect(prisma.keywordTerm.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { term_language_category: { term: 'bike spinning', language: 'pt', category: 'spin_bike' } },
      create: expect.objectContaining({ term: 'bike spinning', language: 'pt', category: 'spin_bike', active: true }),
      update: { active: true },
    }));
    expect(prisma.keywordTerm.upsert).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ activated: 2, deactivated: 0 });
  });

  it('termo trocado desativa o antigo (não apaga)', async () => {
    const { service, prisma } = build([{ id: 'k1', term: 'bicicleta spinning', language: 'pt', category: 'spin_bike', active: true }]);
    const out = await service.seedTrendTerms(file);
    expect(prisma.keywordTerm.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['k1'] } }, data: { active: false } });
    expect(out.deactivated).toBe(1);
  });

  it('tipo sem trend_terms é ignorado', async () => {
    const { service, prisma } = build([]);
    await service.seedTrendTerms({ families: [], types: [{ key: 'x' }] } as never);
    expect(prisma.keywordTerm.upsert).not.toHaveBeenCalled();
  });
});
