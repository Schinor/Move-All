import {
  includeSyntheticData,
  syntheticProductWhere,
  syntheticSnapshotFilterSql,
  syntheticSnapshotWhere,
} from './synthetic-data.filter';

describe('synthetic-data.filter', () => {
  const ORIGINAL_ENV = process.env.INCLUDE_SYNTHETIC_DATA;

  afterEach(() => {
    // Restaura a env para não vazar estado entre testes.
    if (ORIGINAL_ENV === undefined) {
      delete process.env.INCLUDE_SYNTHETIC_DATA;
    } else {
      process.env.INCLUDE_SYNTHETIC_DATA = ORIGINAL_ENV;
    }
  });

  it('com env ausente, o filtro fica ativo (exclui sintéticos)', () => {
    delete process.env.INCLUDE_SYNTHETIC_DATA;
    expect(includeSyntheticData()).toBe(false);
    expect(syntheticSnapshotWhere()).toEqual({ isSynthetic: false });
    expect(syntheticProductWhere()).toEqual({ isSynthetic: false });
  });

  it("com env 'true', o filtro fica vazio (inclui sintéticos)", () => {
    process.env.INCLUDE_SYNTHETIC_DATA = 'true';
    expect(includeSyntheticData()).toBe(true);
    expect(syntheticSnapshotWhere()).toEqual({});
    expect(syntheticProductWhere()).toEqual({});
  });

  it("com env 'false', o filtro fica ativo (exclui sintéticos)", () => {
    process.env.INCLUDE_SYNTHETIC_DATA = 'false';
    expect(includeSyntheticData()).toBe(false);
    expect(syntheticSnapshotWhere()).toEqual({ isSynthetic: false });
    expect(syntheticProductWhere()).toEqual({ isSynthetic: false });
  });

  it('o fragmento SQL embute is_synthetic quando o filtro está ativo', () => {
    delete process.env.INCLUDE_SYNTHETIC_DATA;
    const fragment = syntheticSnapshotFilterSql('s');
    // Prisma.Sql expõe strings/values; o texto precisa citar a coluna.
    const text = JSON.stringify(fragment);
    expect(text).toContain('is_synthetic');
  });
});
