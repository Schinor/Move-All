import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RunTrackListingsDto } from './dto/run-track-listings.dto';
import { IntelligenceCollectionService } from './intelligence-collection.service';

/**
 * Cron diário do acompanhamento (o próprio job filtra o que venceu por
 * `next_due_at`). Mesmo padrão de habilitação da coleta semanal: ligado em
 * produção, desligado em dev, com o lock de "job ativo" no service.
 */
@Injectable()
export class TrackListingsScheduler {
  private readonly logger = new Logger(TrackListingsScheduler.name);

  constructor(private readonly intelligence: IntelligenceCollectionService) {}

  @Cron(process.env.TRACK_LISTINGS_CRON ?? '0 2 * * *', {
    name: 'track-listings-collection',
    timeZone: 'America/Sao_Paulo',
  })
  async collect() {
    const enabled =
      process.env.TRACK_LISTINGS_CRON_ENABLED === 'true' ||
      (process.env.NODE_ENV === 'production' &&
        process.env.TRACK_LISTINGS_CRON_ENABLED !== 'false');
    if (!enabled) return;
    try {
      const dto = new RunTrackListingsDto();
      const maxCalls = Number(process.env.TRACK_LISTINGS_MAX_CALLS ?? '');
      if (Number.isFinite(maxCalls) && maxCalls > 0) {
        dto.maxCalls = Math.min(500, Math.floor(maxCalls));
      }
      const job = await this.intelligence.startTrackListings(dto);
      this.logger.log(`Acompanhamento agendado iniciado: ${job.id}`);
    } catch (error) {
      this.logger.warn(`Acompanhamento não iniciado: ${error instanceof Error ? error.message : error}`);
    }
  }
}
