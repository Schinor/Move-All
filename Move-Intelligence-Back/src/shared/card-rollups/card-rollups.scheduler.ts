import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CardRollupsService } from './card-rollups.service';

/** Mantém o pré-cálculo quente (só banco; sempre ligado). */
@Injectable()
export class CardRollupsScheduler {
  private readonly logger = new Logger(CardRollupsScheduler.name);
  constructor(private readonly rollups: CardRollupsService) {}

  @Cron(process.env.CARD_ROLLUPS_CRON || '*/30 * * * *', { name: 'card-rollups', timeZone: 'America/Sao_Paulo' })
  async tick() {
    try {
      const count = await this.rollups.refreshIfOlderThan(45 * 60 * 1000);
      if (count !== null) this.logger.log(`Pré-cálculo dos cards: ${count} cards`);
    } catch (error) {
      this.logger.warn(`Pré-cálculo não atualizado: ${error instanceof Error ? error.message : error}`);
    }
  }
}
