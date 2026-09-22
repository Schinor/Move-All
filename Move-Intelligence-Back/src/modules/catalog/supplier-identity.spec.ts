import { supplierIdentity } from './supplier-identity';

describe('supplierIdentity', () => {
  it('usa seller_id quando existe', () => {
    expect(supplierIdentity({ marketplace: 'alibaba', sellerId: 'S-9', sellerName: 'Xiamen FitSphere Co.' }))
      .toEqual({ source: 'alibaba', nativeSupplierId: 'S-9', name: 'Xiamen FitSphere Co.' });
  });

  it('sem seller_id usa o nome normalizado como id', () => {
    expect(supplierIdentity({ marketplace: '1688', sellerId: null, sellerName: '  Ningbo   Ação Fitness ' }))
      .toEqual({ source: '1688', nativeSupplierId: 'ningbo acao fitness', name: 'Ningbo Ação Fitness' });
  });

  it('varejo não é fornecedor', () => {
    expect(supplierIdentity({ marketplace: 'amazon_br', sellerId: 'X', sellerName: 'Loja' })).toBeNull();
  });

  it('sem vendedor é ignorado', () => {
    expect(supplierIdentity({ marketplace: 'aliexpress', sellerId: null, sellerName: '  ' })).toBeNull();
  });
});
