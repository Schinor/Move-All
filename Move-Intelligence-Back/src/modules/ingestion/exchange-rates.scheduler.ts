import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntelligenceCollectionService } from './intelligence-collection.service';

/**
 * Cron diário do câmbio PTAX (F1.7, 01h30 SP). Mesmo padrão de habilitação
 * dos demais schedulers: ligado em produção, desligado em dev.
 */
@Injectable()
export class ExchangeRatesScheduler {
  private readonly logger = new Logger(ExchangeRatesScheduler.name);

  constructor(private readonly intelligence: IntelligenceCollectionService) {}

  @Cron(process.env.EXCHANGE_RATES_CRON ?? '30 1 * * *', {
    name: 'exchange-rates-refresh',
    timeZone: 'America/Sao_Paulo',
  })
  async collect() {
    const enabled =
      process.env.EXCHANGE_RATES_CRON_ENABLED === 'true' ||
      (process.env.NODE_ENV === 'production' &&
        process.env.EXCHANGE_RATES_CRON_ENABLED !== 'false');
    if (!enabled) return;
    try {
      const summary = await this.intelligence.refreshExchangeRates();
      this.logger.log(`Câmbio atualizado: ${JSON.stringify(summary.rates ?? summary)}`);
    } catch (error) {
      this.logger.warn(`Câmbio não atualizado: ${error instanceof Error ? error.message : error}`);
    }
  }
}
