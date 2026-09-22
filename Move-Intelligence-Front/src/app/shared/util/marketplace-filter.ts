export interface MarketplaceChip {
  marketplace: string | null;
  label: string;
  count: number;
}

export function marketplaceChips<T>(
  items: T[],
  getMarketplace: (item: T) => string,
  label: (marketplace: string) => string,
): MarketplaceChip[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const marketplace = getMarketplace(item);
    counts.set(marketplace, (counts.get(marketplace) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .map(([marketplace, count]) => ({ marketplace, label: label(marketplace), count }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return [{ marketplace: null, label: 'Todos', count: items.length }, ...chips];
}

export function filterByMarketplace<T>(
  items: T[],
  getMarketplace: (item: T) => string,
  selected: string | null,
): T[] {
  return selected === null ? items : items.filter((item) => getMarketplace(item) === selected);
}
