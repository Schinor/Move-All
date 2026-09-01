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
