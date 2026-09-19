import {
  normalizedMoq,
  offerKey,
  offerState,
  offerUnitCostUsd,
  parseOfferKey,
  sortOffers,
} from './offer-rules';
import { DEFAULT_BUSINESS_RULES } from '../../../shared/business-rules/business-rules.defaults';

describe('offer-rules', () => {
  describe('offerUnitCostUsd (preço no MOQ)', () => {
    it('usa price_max quando existe', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 120, currency: 'USD' }, 0.14)).toBe(120);
    });
    it('cai para price_min sem price_max', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: null, currency: 'USD' }, 0.14)).toBe(90);
    });
    it('ignora price_max zero', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 0, currency: null }, 0.14)).toBe(90);
    });
    it('converte CNY para USD', () => {
      expect(offerUnitCostUsd({ priceMin: 500, priceMax: 700, currency: 'CNY' }, 0.14)).toBeCloseTo(98, 6);
    });
    it('moeda desconhecida é sem preço', () => {
      expect(offerUnitCostUsd({ priceMin: 90, priceMax: 100, currency: 'BRL' }, 0.14)).toBeNull();
    });
    it('sem preço válido devolve null', () => {
      expect(offerUnitCostUsd({ priceMin: null, priceMax: null, currency: 'USD' }, 0.14)).toBeNull();
      expect(offerUnitCostUsd({ priceMin: -1, priceMax: undefined, currency: 'USD' }, 0.14)).toBeNull();
    });
  });

  describe('offerState', () => {
    const ratio = DEFAULT_BUSINESS_RULES.offers.suspiciousPriceRatio;
    it('limite padrão é 30%', () => expect(ratio).toBe(0.3));
    it('sem custo → sem_preco', () => {
      expect(offerState({ unitCostUsd: null, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('sem_preco');
    });
    it('abaixo de 30% da mediana → suspeito', () => {
      expect(offerState({ unitCostUsd: 29.9, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('suspeito');
    });
    it('exatamente 30% ainda tem score', () => {
      expect(offerState({ unitCostUsd: 30, cardUnitCostUsd: 100, suspiciousRatio: ratio })).toBe('com_score');
    });
    it('sem mediana do card não marca suspeito', () => {
      expect(offerState({ unitCostUsd: 5, cardUnitCostUsd: null, suspiciousRatio: ratio })).toBe('com_score');
    });
  });

  it('offerKey e parseOfferKey são inversos', () => {
    expect(offerKey('alibaba', '123')).toBe('alibaba:123');
    expect(parseOfferKey('alibaba:123')).toEqual({ marketplace: 'alibaba', externalProductId: '123' });
    expect(parseOfferKey('1688:a:b')).toEqual({ marketplace: '1688', externalProductId: 'a:b' });
    expect(parseOfferKey('semdoispontos')).toBeNull();
    expect(parseOfferKey('varejo:1')).toBeNull();
  });

  it('normalizedMoq trata nulo e não positivo como 1', () => {
    expect(normalizedMoq(null)).toBe(1);
    expect(normalizedMoq(0)).toBe(1);
    expect(normalizedMoq(50)).toBe(50);
  });

  it('sortOffers: score desc, nulos por último, desempate por custo asc', () => {
    const sorted = sortOffers([
      { id: 'a', score: null, unitCostUsd: 10 },
      { id: 'b', score: 70, unitCostUsd: 120 },
      { id: 'c', score: 70, unitCostUsd: 100 },
      { id: 'd', score: 90, unitCostUsd: 200 },
      { id: 'e', score: null, unitCostUsd: null },
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });
});
