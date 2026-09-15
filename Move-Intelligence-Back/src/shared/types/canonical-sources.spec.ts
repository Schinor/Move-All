import { isCanonicalSource, normalizeSourceKey } from './canonical-sources';

describe('canonical-sources (F1.8)', () => {
  it('normaliza aliases históricos para a forma canônica', () => {
    expect(normalizeSourceKey('mercadolivre')).toBe('mercado_livre');
    expect(normalizeSourceKey('mercado_livre')).toBe('mercado_livre');
    expect(normalizeSourceKey('tiktok-shop')).toBe('tiktok_shop');
    expect(normalizeSourceKey('google-shopping')).toBe('google_shopping');
    expect(normalizeSourceKey('shopee')).toBe('shopee_br');
    expect(normalizeSourceKey('1688')).toBe('1688');
  });

  it('mantém desconhecidas em minúsculas (conectores legados)', () => {
    expect(normalizeSourceKey('TradeAtlas')).toBe('tradeatlas');
  });

  it('reconhece as fontes canônicas, incluindo aliexpress (A4)', () => {
    expect(isCanonicalSource('mercado_livre')).toBe(true);
    expect(isCanonicalSource('aliexpress')).toBe(true);
    expect(isCanonicalSource('mercadolivre')).toBe(false);
    expect(isCanonicalSource('tiktok-shop')).toBe(false);
  });
});
