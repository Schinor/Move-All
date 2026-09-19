import { CardOffer, OfferState } from '../../core/models/contract.models';

const STATE_LABEL: Record<OfferState, string> = {
  com_score: '',
  sem_preco: 'sem preço',
  suspeito: 'preço suspeito',
  aguardando_lote: 'aguardando cálculo',
  sem_score_card: 'card sem dados',
};

export function offerStateLabel(state: OfferState): string {
  return STATE_LABEL[state] ?? state;
}

export function offerLabel(offer: CardOffer): string {
  const title = offer.title ? (offer.title.length > 40 ? `${offer.title.slice(0, 40).trimEnd()}…` : offer.title) : null;
  if (offer.sellerName && title) return `${offer.sellerName} · ${title}`;
  return title ?? offer.sellerName ?? offer.key;
}

export function offerStoreCount(offers: CardOffer[]): number {
  return new Set(offers.map((o) => o.sellerName ?? o.key)).size;
}
