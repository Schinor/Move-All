import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FichaService } from './ficha.service';

/** Rotina da ficha (spec 5.2). Só age com FICHA_ENABLED=true (checado dentro do runOnce). */
@Injectable()
export class FichaScheduler {
  private readonly logger = new Logger(FichaScheduler.name);

  constructor(private readonly fichas: FichaService) {}

  @Cron(process.env.FICHA_CRON || '*/30 * * * *', { name: 'catalog-ficha', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const summary = await this.fichas.runOnce();
      if (summary.stoppedBy !== 'disabled') {
        this.logger.log(`Fichas: ${JSON.stringify(summary)}`);
      }
    } catch (error) {
      this.logger.warn(`Rotina de fichas falhou: ${error instanceof Error ? error.message : error}`);
    }
  }
}
