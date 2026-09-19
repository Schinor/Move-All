import { describe, expect, it } from 'vitest';
import { offerLabel, offerStateLabel, offerStoreCount } from './offer-format';
import { CardOffer } from '../../core/models/contract.models';

const offer = (over: Partial<CardOffer> = {}): CardOffer => ({
  key: 'alibaba:1', marketplace: 'alibaba', externalProductId: '1', title: 'Bike Spinning Magnetic Flywheel 13kg Home Gym Equipment',
  sellerName: 'Loja Y', url: null, unitCostUsd: 96, currency: 'USD', moq: 50, rating: 4.4, salesSignal: 10,
  itemStatus: 'confirmed', state: 'com_score', score: 81, pVplPositivo: 0.78, capitalPrimeiroPedido: 31000, computedAt: null, ...over,
});

describe('offer-format', () => {
  it('rótulos dos estados sem score', () => {
    expect(offerStateLabel('sem_preco')).toBe('sem preço');
    expect(offerStateLabel('suspeito')).toBe('preço suspeito');
    expect(offerStateLabel('aguardando_lote')).toBe('aguardando cálculo');
    expect(offerStateLabel('sem_score_card')).toBe('card sem dados');
    expect(offerStateLabel('com_score')).toBe('');
  });
  it('rótulo da oferta: vendedor + título curto (até 40 caracteres)', () => {
    expect(offerLabel(offer())).toBe('Loja Y · Bike Spinning Magnetic Flywheel 13kg Hom…');
    expect(offerLabel(offer({ sellerName: null, title: 'Curto' }))).toBe('Curto');
    expect(offerLabel(offer({ sellerName: null, title: null }))).toBe('alibaba:1');
  });
  it('conta lojas distintas por vendedor', () => {
    expect(offerStoreCount([offer(), offer({ key: 'alibaba:2' }), offer({ key: '1688:3', sellerName: 'Loja X' })])).toBe(2);
  });
});
