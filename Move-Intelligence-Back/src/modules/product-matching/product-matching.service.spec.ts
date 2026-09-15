import { IntelligenceProduct, Prisma } from '@prisma/client';
import { ProductMatchingService } from './product-matching.service';

type CandidateInput = {
  id: string;
  source: string;
  recordId: string;
  canonicalTitle: string;
  gtin: string | null;
  brand: string | null;
  attrs: Prisma.JsonValue;
  priceValue: Prisma.Decimal | null;
  priceCurrency: string | null;
  clusterId: string;
  similarity: number;
};

type Decision = {
  match: boolean;
  review: boolean;
  score: number;
  method: string;
  reason: string;
};

describe('ProductMatchingService decision rules', () => {
  const service = new ProductMatchingService({} as never);
  const decide = (
    service as unknown as {
      decide(product: IntelligenceProduct, candidate: CandidateInput): Decision;
    }
  ).decide.bind(service);

  const product = (overrides: Partial<IntelligenceProduct> = {}): IntelligenceProduct => ({
    id: '00000000-0000-0000-0000-000000000001',
    source: 'amazon_br',
    recordId: 'source-1',
    capturedAt: new Date('2026-08-19'),
    title: 'Halter ajustável 20kg',
    canonicalTitle: 'ajustavel halter',
    gtin: null,
    brand: null,
    attrs: { kg: '20' },
    cluster: 'adjustable_dumbbells',
    priceValue: null,
    priceCurrency: null,
    rating: null,
    reviewsCount: null,
    monthlySales: null,
    moq: null,
    supplier: null,
    dataQuality: 'complete',
    sourceSpecific: {},
    isSynthetic: false,
    ...overrides,
  });

  const candidate = (overrides: Partial<CandidateInput> = {}): CandidateInput => ({
    id: '00000000-0000-0000-0000-000000000002',
    source: 'mercado_livre',
    recordId: 'source-2',
    canonicalTitle: 'ajustavel halter',
    gtin: null,
    brand: null,
    attrs: { kg: '20' },
    priceValue: null,
    priceCurrency: null,
    clusterId: '00000000-0000-0000-0000-000000000003',
    similarity: 0.72,
    ...overrides,
  });

  it('prioritizes an identical GTIN', () => {
    expect(
      decide(product({ gtin: '7891234567890' }), candidate({ gtin: '7891234567890' })),
    ).toMatchObject({ match: true, method: 'identifier', score: 1 });
  });

  it('vetoes divergent numeric attributes despite similar text', () => {
    expect(decide(product(), candidate({ attrs: { kg: '10' }, similarity: 0.95 }))).toMatchObject({
      match: false,
      review: false,
      method: 'veto',
    });
  });

  it('sends an ambiguous textual pair to review', () => {
    expect(decide(product(), candidate({ similarity: 0.48 }))).toMatchObject({
      match: false,
      review: true,
      method: 'review',
    });
  });
});

// A4 (RELATORIO_ANALISE_DADOS_E_SCORES.md seção 2.1): o fallback antigo
// `findFirst({ OR: [{ canonicalName }, { category: product.cluster }] })`
// anexava o produto ao primeiro cluster da mesma categoria mesmo quando o
// único candidato tinha sido vetado (kg/marca/preço). Isso transformava
// "cluster" em "categoria" e misturava produtos diferentes no mesmo
// histórico. Estes testes cobrem o `findOrCreateClusterForProduct` real.
describe('ProductMatchingService.findOrCreateClusterForProduct — sem fallback por categoria', () => {
  const baseProduct = (overrides: Partial<IntelligenceProduct> = {}): IntelligenceProduct => ({
    id: '00000000-0000-0000-0000-000000000001',
    source: 'amazon_br',
    recordId: 'source-1',
    capturedAt: new Date('2026-08-19'),
    title: 'Halter ajustável 20kg',
    canonicalTitle: 'ajustavel halter 20kg',
    gtin: null,
    brand: null,
    attrs: { kg: '20' },
    cluster: 'adjustable_dumbbells',
    priceValue: null,
    priceCurrency: null,
    rating: null,
    reviewsCount: null,
    monthlySales: null,
    moq: null,
    supplier: null,
    dataQuality: 'complete',
    sourceSpecific: {},
    isSynthetic: false,
    ...overrides,
  });

  function buildPrismaMock(overrides: Record<string, unknown> = {}) {
    return {
      productClusterItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      productMatchReview: { upsert: jest.fn().mockResolvedValue({}) },
      productCluster: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'new-cluster-id' }),
      },
      ...overrides,
    };
  }

  it('cria um cluster novo (createStandaloneCluster) quando não há candidato e nenhum cluster com o mesmo canonicalName', async () => {
    const prisma = buildPrismaMock();
    const service = new ProductMatchingService(prisma as never);

    const clusterId = await service.findOrCreateClusterForProduct(baseProduct());

    expect(clusterId).toBe('new-cluster-id');
    expect(prisma.productCluster.create).toHaveBeenCalledTimes(1);
    // O findFirst de reaproveitamento só pode filtrar por canonicalName —
    // nunca por category.
    expect(prisma.productCluster.findFirst).toHaveBeenCalledWith({
      where: { canonicalName: 'ajustavel halter 20kg' },
    });
  });

  it('nunca anexa um candidato vetado (kg divergente) — mesmo que exista cluster da mesma categoria', async () => {
    const vetoedCandidate = {
      id: '00000000-0000-0000-0000-000000000002',
      source: 'mercado_livre',
      recordId: 'source-2',
      canonicalTitle: 'ajustavel halter 20kg',
      gtin: null,
      brand: null,
      attrs: { kg: '10' }, // diverge do produto (20kg) → veto
      priceValue: null,
      priceCurrency: null,
      clusterId: 'synthetic-cluster-24kg',
      similarity: 0.95,
    };
    const prisma = buildPrismaMock({
      $queryRaw: jest.fn().mockResolvedValue([vetoedCandidate]),
    });
    const service = new ProductMatchingService(prisma as never);

    const clusterId = await service.findOrCreateClusterForProduct(baseProduct());

    // O único cluster "existente" no cenário é o do candidato vetado — como
    // não reaproveitamos por categoria, e não há canonicalName igual, o
    // resultado tem que ser um cluster novo, nunca o do candidato vetado.
    expect(clusterId).toBe('new-cluster-id');
    expect(clusterId).not.toBe(vetoedCandidate.clusterId);
    expect(prisma.productClusterItem.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ clusterId: vetoedCandidate.clusterId }),
      }),
    );
    expect(prisma.productCluster.create).toHaveBeenCalledTimes(1);
  });

  it('reaproveita um cluster existente só quando o canonicalName bate exatamente (canonical_name_match)', async () => {
    const prisma = buildPrismaMock({
      productCluster: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-cluster-id' }),
        create: jest.fn(),
      },
    });
    const service = new ProductMatchingService(prisma as never);

    const clusterId = await service.findOrCreateClusterForProduct(baseProduct());

    expect(clusterId).toBe('existing-cluster-id');
    expect(prisma.productCluster.create).not.toHaveBeenCalled();
    expect(prisma.productClusterItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ clusterId: 'existing-cluster-id', matchedBy: 'canonical_name_match' }),
      }),
    );
  });
});
