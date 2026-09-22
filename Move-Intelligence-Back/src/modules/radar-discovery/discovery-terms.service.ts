import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { buildDiscoveryCandidates, RisingItem, TypeTerms } from './discovery-candidates';

export interface DiscoveryTermsQuery { status?: string; geo?: string; family?: string }
export interface DiscoveryRefreshSummary {
  dry_run: boolean;
  snapshots: number;
  candidates: number;
  created: number;
  updated: number;
  created_by_geo: Record<string, number>;
  sample: string[];
}
export interface DiscoveryTermView {
  id: string; term: string; geo: string; type_key: string; type_name: string | null; family_key: string | null;
  rising_label: string; breakout: boolean; first_seen_at: string; last_seen_at: string; status: string;
  searched_at: string | null; new_listings: number | null; search_error: string | null;
}

const STATUSES = ['new', 'approved', 'searched', 'ignored'] as const;

@Injectable()
export class DiscoveryTermsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Spec §5.2: gera/atualiza a lista a partir da coleta mais recente (status ok) de cada tipo/país. */
  async refresh(opts: { dryRun?: boolean; now?: Date } = {}): Promise<DiscoveryRefreshSummary> {
    const dryRun = opts.dryRun === true;
    const now = opts.now ?? new Date();
    const snapshots = await this.prisma.searchTrendSnapshot.findMany({
      where: { status: 'ok' },
      orderBy: { capturedAt: 'desc' },
      distinct: ['typeKey', 'geo'],
      select: { typeKey: true, geo: true, relatedRising: true },
    });
    const keywordRows = await this.prisma.keywordTerm.findMany({
      where: { active: true, category: { not: null }, language: { in: ['pt', 'en'] } },
      select: { term: true, language: true, category: true },
    });
    const byType = new Map<string, TypeTerms>();
    for (const row of keywordRows) {
      const key = row.category as string;
      const entry = byType.get(key) ?? { typeKey: key, pt: null, en: null };
      if (row.language === 'pt') entry.pt = row.term;
      if (row.language === 'en') entry.en = row.term;
      byType.set(key, entry);
    }
    const candidates = buildDiscoveryCandidates(
      snapshots.map((snapshot) => ({
        typeKey: snapshot.typeKey,
        geo: snapshot.geo,
        relatedRising: Array.isArray(snapshot.relatedRising) ? (snapshot.relatedRising as unknown as RisingItem[]) : [],
      })),
      [...byType.values()],
    );
    const existing = await this.prisma.discoveryTerm.findMany({ select: { geo: true, termNorm: true } });
    const existingKeys = new Set(existing.map((row) => `${row.geo}::${row.termNorm}`));
    const created = candidates.filter((candidate) => !existingKeys.has(`${candidate.geo}::${candidate.termNorm}`));
    const createdByGeo: Record<string, number> = {};
    for (const candidate of created) createdByGeo[candidate.geo] = (createdByGeo[candidate.geo] ?? 0) + 1;

    if (!dryRun) {
      for (const candidate of candidates) {
        await this.prisma.discoveryTerm.upsert({
          where: { geo_termNorm: { geo: candidate.geo, termNorm: candidate.termNorm } },
          create: { ...candidate, firstSeenAt: now, lastSeenAt: now },
          // O status nunca muda aqui: ignorado continua ignorado.
          update: { lastSeenAt: now, risingValue: candidate.risingValue, risingLabel: candidate.risingLabel, breakout: candidate.breakout },
        });
      }
    }
    return {
      dry_run: dryRun,
      snapshots: snapshots.length,
      candidates: candidates.length,
      created: created.length,
      updated: candidates.length - created.length,
      created_by_geo: createdByGeo,
      sample: created.slice(0, 15).map((candidate) => `${candidate.geo} · ${candidate.term} (${candidate.typeKey}, ${candidate.risingLabel})`),
    };
  }

  async list(query: DiscoveryTermsQuery): Promise<DiscoveryTermView[]> {
    const statuses = (query.status ?? 'new').split(',').filter((status) => (STATUSES as readonly string[]).includes(status));
    const types = await this.prisma.catalogType.findMany({
      select: { key: true, namePt: true, family: { select: { key: true } } },
    });
    const typeBy = new Map(types.map((type) => [type.key, type]));
    const where: Prisma.DiscoveryTermWhereInput = { status: { in: statuses } };
    if (query.geo) where.geo = query.geo;
    if (query.family) where.typeKey = { in: types.filter((type) => type.family?.key === query.family).map((type) => type.key) };
    const onlyNew = statuses.length === 1 && statuses[0] === 'new';
    const rows = await this.prisma.discoveryTerm.findMany({
      where,
      orderBy: onlyNew ? [{ breakout: 'desc' }, { risingValue: 'desc' }] : [{ decidedAt: 'desc' }],
      take: 500,
    });
    return rows.map((row) => {
      const type = typeBy.get(row.typeKey);
      return {
        id: row.id,
        term: row.term,
        geo: row.geo,
        type_key: row.typeKey,
        type_name: type?.namePt ?? null,
        family_key: type?.family?.key ?? null,
        rising_label: row.risingLabel,
        breakout: row.breakout,
        first_seen_at: row.firstSeenAt.toISOString(),
        last_seen_at: row.lastSeenAt.toISOString(),
        status: row.status,
        searched_at: row.searchedAt ? row.searchedAt.toISOString() : null,
        new_listings: row.newListings ?? null,
        search_error: row.searchError ?? null,
      };
    });
  }

  async counts(): Promise<Record<(typeof STATUSES)[number], number>> {
    const rows = await this.prisma.discoveryTerm.groupBy({ by: ['status'], _count: { _all: true } });
    const out = { new: 0, approved: 0, searched: 0, ignored: 0 };
    for (const row of rows) {
      if (row.status in out) out[row.status as keyof typeof out] = row._count._all;
    }
    return out;
  }

  approve(id: string, userId: string) { return this.transition(id, ['new'], 'approved', userId); }
  ignore(id: string, userId: string) { return this.transition(id, ['new', 'approved'], 'ignored', userId); }
  restore(id: string, userId: string) { return this.transition(id, ['ignored'], 'new', userId); }

  private async transition(id: string, from: string[], to: string, userId: string) {
    const result = await this.prisma.discoveryTerm.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, decidedBy: userId, decidedAt: new Date() },
    });
    if (result.count === 0) {
      const current = await this.prisma.discoveryTerm.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException('Termo não encontrado.');
      throw new ConflictException(`O termo está em "${current.status}" e não pode ir para "${to}".`);
    }
    return { id, status: to };
  }
}
