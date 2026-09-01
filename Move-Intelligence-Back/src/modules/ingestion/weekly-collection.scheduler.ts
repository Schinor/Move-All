import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RunWeeklyIntelligenceCollectionDto } from './dto/run-weekly-intelligence-collection.dto';
import { IntelligenceCollectionService } from './intelligence-collection.service';

@Injectable()
export class WeeklyCollectionScheduler {
  private readonly logger = new Logger(WeeklyCollectionScheduler.name);

  constructor(private readonly intelligence: IntelligenceCollectionService) {}

  @Cron(process.env.WEEKLY_COLLECTION_CRON ?? '0 3 * * 1', {
    name: 'weekly-intelligence-collection',
    timeZone: 'America/Sao_Paulo',
  })
  async collect() {
    const enabled =
      process.env.WEEKLY_COLLECTION_CRON_ENABLED === 'true' ||
      (process.env.NODE_ENV === 'production' &&
        process.env.WEEKLY_COLLECTION_CRON_ENABLED !== 'false');
    if (!enabled) return;
    try {
      const job = await this.intelligence.startWeekly(new RunWeeklyIntelligenceCollectionDto());
      this.logger.log(`Coleta semanal agendada iniciada: ${job.id}`);
    } catch (error) {
      this.logger.warn(`Coleta semanal não iniciada: ${error instanceof Error ? error.message : error}`);
    }
  }
}
