import { Logger } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { HttpFetcher } from '../../shared/http/http-fetcher';
import {
  RawProduct,
  RawProductDetail,
  SearchParams,
  SourceType,
} from '../../shared/types/marketplace.types';
import { MarketplaceConnector } from './marketplace-connector.interface';

/**
 * Base para os conectores externos. Centraliza:
 *  - leitura da credencial (chave/URL de provedor) via config;
 *  - isEnabled() (liga automaticamente quando a env correspondente é preenchida);
 *  - o cliente HTTP com timeout + retry/backoff (HttpFetcher).
 *
 * COMO LIGAR UM PROVEDOR (quando DP5 for decidido):
 *  1. Preencher a env da credencial (ex.: DOUYIN_PROVIDER_URL) → isEnabled() = true.
 *  2. Implementar `searchProducts` usando `this.http.getJson(...)` e mapear a
 *     resposta para RawProduct[] (preserve o payload cru em `rawPayload`).
 *  A ingestion já persiste o raw, normaliza, faz matching e cria snapshots.
 */
export abstract class BaseHttpConnector implements MarketplaceConnector {
  protected readonly logger = new Logger(this.constructor.name);

  abstract sourceName: string;
  abstract sourceType: SourceType;

  /** Caminho no config da credencial que habilita o conector. */
  protected abstract readonly credentialConfigKey: string;

  constructor(
    protected readonly config: AppConfigService,
    protected readonly http: HttpFetcher,
  ) {}

  protected credential(): string | undefined {
    return this.config.get<string>(this.credentialConfigKey);
  }

  isEnabled(): boolean {
    return Boolean(this.credential());
  }

  /** Garante que só há chamada de rede quando o conector está configurado. */
  protected requireCredential(): string {
    const credential = this.credential();
    if (!credential) {
      throw new Error(`${this.sourceName}: conector não configurado (${this.credentialConfigKey})`);
    }
    return credential;
  }

  /** Seam pendente: implementar o mapeamento do provedor escolhido (DP5). */
  protected notWired(context: string): never {
    throw new Error(
      `${this.sourceName}: provedor não definido — mapear resposta em searchProducts (${context})`,
    );
  }

  abstract searchProducts(params: SearchParams): Promise<RawProduct[]>;
  abstract getProductDetails(productId: string): Promise<RawProductDetail>;
}
