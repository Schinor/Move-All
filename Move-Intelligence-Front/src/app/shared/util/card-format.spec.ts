import { comparisonCountText, familyTypeText, listingsText, priceMedianText, priceRangeText } from './card-format';
import { TrendProduct } from '../../core/models/contract.models';

const p = (extra: Partial<TrendProduct>) => ({ canonicalName: 'X', ...extra }) as TrendProduct;

describe('card-format', () => {
  it('família › tipo', () => {
    expect(familyTypeText(p({ familyName: 'Bikes spinning', typeName: 'Bike spinning' }))).toBe('Bikes spinning › Bike spinning');
    expect(familyTypeText(p({}))).toBeNull();
  });

  it('anúncios e lojas', () => {
    expect(listingsText(p({ listingCount: 9, storeCount: 4 }))).toBe('9 anúncios em 4 lojas');
    expect(listingsText(p({ listingCount: 1, storeCount: 1 }))).toBe('1 anúncio em 1 loja');
    expect(listingsText(p({}))).toBeNull();
  });

  it('preço de venda BR', () => {
    expect(priceMedianText(p({ priceMedianBr: 1460 }))).toBe('~R$ 1.460');
    expect(priceRangeText(p({ priceMinBr: 1390, priceMaxBr: 1520 }))).toBe('R$ 1.390–1.520');
    expect(priceRangeText(p({ priceMinBr: 1390, priceMaxBr: 1390 }))).toBeNull();
  });

  it('contagem da comparação', () => {
    expect(comparisonCountText({ attr: 'com_app', labelPt: 'com app', total: 9, values: [{ value: 'false', count: 5 }, { value: 'true', count: 4 }] }))
      .toBe('com app: 4 de 9');
    expect(comparisonCountText({ attr: 'revestimento', labelPt: 'revestimento', total: 3, values: [{ value: 'pvc', count: 2 }, { value: 'borracha', count: 1 }] }))
      .toBe('revestimento: pvc (2), borracha (1)');
  });
});
