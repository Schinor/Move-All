import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

/** Spec D-D3 + §4.3: termo BR → marketplaces BR; termo US → Amazon US + fornecedores (1688 não responde a inglês). */
export const DISCOVERY_SOURCES: Record<string, string[]> = {
  BR: ['amazon_br', 'mercado_livre', 'shopee_br'],
  US: ['amazon', 'alibaba', 'aliexpress'],
};
export const RADAR_DISCOVERY_CATEGORY = 'radar_discovery';

export interface DiscoveryTermRunRequest {
  term: string;
  sources: string[];
  limit: number;
  geos: string[];
  includeDemand: false;
  exactTerm: true;
  windowDays: number;
}
export interface FinishedJob { id: string; status: string; stats: unknown; errorMessage: string | null }
export type RunTermFn = (request: DiscoveryTermRunRequest, category: string) => Promise<FinishedJob>;
export interface RadarDiscoverySummary {
  skipped: 'disabled' | null;
  dry_run: boolean;
  searched: number;
  failed: number;
  terms: Array<{ id: string; term: string; geo: string; sources: string[] }>;
}

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function radarDiscoveryConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    enabled: env.RADAR_DISCOVERY_ENABLED === 'true' && env.FICHA_ENABLED === 'true',
    maxTerms: intEnv(env.RADAR_DISCOVERY_MAX_TERMS, 5, 1, 50),
    limitPerSource: intEnv(env.RADAR_DISCOVERY_LIMIT_PER_SOURCE, 10, 1, 10),
  };
}

@Injectable()
export class DiscoverySearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Spec §6: busca os termos aprovados, um por vez. `runTerm` vem de fora
   * (IntelligenceCollectionService.runTermAndWait) para não criar dependência circular.
   */
  async runApproved(opts: { runTerm: RunTermFn; dryRun?: boolean; maxTerms?: number; env?: NodeJS.ProcessEnv }): Promise<RadarDiscoverySummary> {
    const cfg = radarDiscoveryConfig(opts.env ?? process.env);
    const dryRun = opts.dryRun === true;
    if (!dryRun && !cfg.enabled) return { skipped: 'disabled', dry_run: false, searched: 0, failed: 0, terms: [] };

    const rows = await this.prisma.discoveryTerm.findMany({
      where: { status: 'approved' },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
      take: opts.maxTerms ?? cfg.maxTerms,
    });
    const terms = rows.map((row) => ({ id: row.id, term: row.term, geo: row.geo, sources: DISCOVERY_SOURCES[row.geo] ?? [] }));
    if (dryRun) return { skipped: null, dry_run: true, searched: 0, failed: 0, terms };

    let searched = 0;
    let failed = 0;
    for (const item of terms) {
      let jobId: string | null = null;
      try {
        if (item.sources.length === 0) throw new Error(`País sem fontes configuradas: ${item.geo}`);
        const job = await opts.runTerm({
          term: item.term,
          sources: item.sources,
          limit: cfg.limitPerSource,
          geos: [item.geo],
          includeDemand: false,
          exactTerm: true,
          windowDays: 7,
        }, RADAR_DISCOVERY_CATEGORY);
        jobId = job.id;
        if (job.status === 'FAILED') throw new Error(job.errorMessage ?? 'Busca falhou');
        const stats = (job.stats ?? {}) as Record<string, unknown>;
        await this.prisma.discoveryTerm.update({
          where: { id: item.id },
          data: {
            status: 'searched',
            searchedAt: new Date(),
            searchJobId: job.id,
            newListings: Number(stats['tracked_new'] ?? 0) || 0,
            searchError: null,
          },
        });
        searched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.prisma.discoveryTerm.update({
          where: { id: item.id },
          data: jobId ? { searchError: message.slice(0, 500), searchJobId: jobId } : { searchError: message.slice(0, 500) },
        });
        failed += 1;
      }
    }
    return { skipped: null, dry_run: false, searched, failed, terms };
  }
}
