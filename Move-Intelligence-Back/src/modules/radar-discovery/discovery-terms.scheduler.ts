import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscoveryTermsService } from './discovery-terms.service';

/** Spec §5.2: atualiza a lista de termos em alta todo dia. Só banco, idempotente: sempre ligado. */
@Injectable()
export class DiscoveryTermsScheduler {
  private readonly logger = new Logger(DiscoveryTermsScheduler.name);

  constructor(private readonly terms: DiscoveryTermsService) {}

  @Cron(process.env.DISCOVERY_TERMS_CRON || '0 6 * * *', { name: 'discovery-terms-refresh', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const summary = await this.terms.refresh();
      this.logger.log(`Termos em alta: ${summary.created} novos, ${summary.updated} atualizados`);
    } catch (error) {
      this.logger.warn(`Atualização dos termos em alta falhou: ${error instanceof Error ? error.message : error}`);
    }
  }
}
