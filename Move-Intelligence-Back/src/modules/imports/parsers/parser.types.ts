import { ImportSourceType } from '@prisma/client';

/** Erro associado a uma linha específica do arquivo de origem. */
export interface RowError {
  /** Número da linha no arquivo bruto (1-based), para o usuário localizar. */
  line: number;
  reason: string;
  /** Trecho bruto da linha (truncado) para diagnóstico. */
  raw?: string;
}

/** Registro Comex normalizado (mapeia para o modelo Prisma `TradeExport`). */
export interface ParsedTradeExport {
  naturalKey: string;
  ncmCode: string;
  ncmDescription: string | null;
  year: number;
  month: number | null;
  country: string;
  state: string | null;
  /** Decimais representados como string para preservar precisão no Prisma. */
  fobUsd: string;
  netKg: string;
}

/** Registro TradeAtlas normalizado (mapeia para o modelo Prisma `Shipment`). */
export interface ParsedShipment {
  naturalKey: string;
  arrivalDate: Date | null;
  importerName: string | null;
  importerCountry: string | null;
  exporterName: string | null;
  exporterCountry: string | null;
  originCountry: string | null;
  hsCode: string | null;
  productDetails: string | null;
  fobUsd: string | null;
  cifUsd: string | null;
  grossWeightKg: string | null;
  netWeightKg: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  portOfArrival: string | null;
  portOfDeparture: string | null;
  declarationNumber: string | null;
  itemNo: number | null;
}

export interface ComexParseResult {
  sourceType: ImportSourceType; // COMEX_ANUAL | COMEX_MENSAL
  rows: ParsedTradeExport[];
  errors: RowError[];
  rowsTotal: number;
}

export interface TradeAtlasParseResult {
  sourceType: ImportSourceType; // TRADE_ATLAS
  rows: ParsedShipment[];
  errors: RowError[];
  rowsTotal: number;
}

/**
 * Anúncio de marketplace normalizado (CSVs Bright Data). Mapeia para o modelo
 * Prisma `ProductListingSnapshot` + cluster trivial em `ProductCluster`.
 */
export interface ParsedMarketplaceListing {
  /** Chave natural do anúncio: `marketplace|externalProductId`. */
  naturalKey: string;
  marketplace: string;
  externalProductId: string;
  title: string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Sinal de vendas bruto (ex.: `sold`, `bought_past_month`). */
  salesSignalRaw: number | null;
  /** Tipo do sinal (ver `SalesSignalType` em shared/types/marketplace.types). */
  salesSignalType: string | null;
  sellerId: string | null;
  sellerName: string | null;
  stock: number | null;
  moq: number | null;
  brand: string | null;
  /** Categoria folha (último nível do `category_tree`). */
  category: string | null;
  productUrl: string | null;
  imageCount: number | null;
}

/** Vendedor de marketplace normalizado (mapeia para `MarketplaceSeller`). */
export interface ParsedMarketplaceSeller {
  marketplace: string;
  externalSellerId: string;
  name: string | null;
  businessName: string | null;
  country: string | null;
  rating: number | null;
  ratingCount: number | null;
  positivePct: number | null;
  productsCount: number | null;
  sellerUrl: string | null;
}

/** Resultado comum dos parsers de marketplace (Bright Data). */
export interface MarketplaceParseResult {
  sourceType: ImportSourceType; // TIKTOK_SHOP | SHEIN | GOOGLE_SHOPPING | AMAZON_* | ALIBABA
  rows: ParsedMarketplaceListing[];
  sellers: ParsedMarketplaceSeller[];
  errors: RowError[];
  rowsTotal: number;
}
