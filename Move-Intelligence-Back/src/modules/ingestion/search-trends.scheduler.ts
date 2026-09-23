import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DiscoveryTermsService } from '../radar-discovery/discovery-terms.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';

/** Radar semanal (spec §5.1). Só com SEARCH_TRENDS_CRON_ENABLED=true — nunca liga sozinho em produção (custo). */
@Injectable()
export class SearchTrendsScheduler {
  private readonly logger = new Logger(SearchTrendsScheduler.name);

  constructor(
    private readonly intelligence: IntelligenceCollectionService,
    private readonly terms: DiscoveryTermsService,
  ) {}

  @Cron(process.env.SEARCH_TRENDS_CRON || '0 20 * * 0', { name: 'search-trends', timeZone: 'America/Sao_Paulo' })
  async run() {
    if (process.env.SEARCH_TRENDS_CRON_ENABLED !== 'true') return;
    try {
      const summary = await this.intelligence.runSearchTrends();
      this.logger.log(`Radar: ${JSON.stringify(summary)}`);
      const refreshed = await this.terms.refresh();
      this.logger.log(`Termos em alta atualizados: ${refreshed.created} novos`);
    } catch (error) {
      this.logger.warn(`Radar não concluído: ${error instanceof Error ? error.message : error}`);
    }
  }
}
