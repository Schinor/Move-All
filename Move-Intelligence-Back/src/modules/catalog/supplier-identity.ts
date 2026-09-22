import { SUPPLIER_MARKETPLACES } from '../products/offers/offer-rules';

/** Vendedor de anúncio de fornecedor (1688/Alibaba/AliExpress) → registro de `suppliers`. */
export function supplierIdentity(s: {
  marketplace: string;
  sellerId: string | null;
  sellerName: string | null;
}): { source: string; nativeSupplierId: string; name: string } | null {
  if (!(SUPPLIER_MARKETPLACES as readonly string[]).includes(s.marketplace)) return null;
  const name = (s.sellerName ?? '').replace(/\s+/g, ' ').trim();
  const id = (s.sellerId ?? '').trim();
  if (!name && !id) return null;
  const nativeSupplierId = id || name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return { source: s.marketplace, nativeSupplierId, name: name || id };
}
