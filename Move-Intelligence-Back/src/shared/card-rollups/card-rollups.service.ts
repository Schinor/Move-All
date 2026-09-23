import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { includeSyntheticData } from '../synthetic-data/synthetic-data.filter';
import { ClusterRollupRow, queryCardRollupRows } from './card-rollup.sql';

const WRITE_CHUNK = 500;
const MARK_STALE_THROTTLE_MS = 2000;
const BACKGROUND_DELAY_MS = 5000;

function numbersAsText(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'number') out[key] = String(value);
    else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      out[key] = value.map((item) => String(item));
    } else out[key] = value;
  }
  return out;
}

function maxAgeMs(): number {
  const seconds = Number.parseInt(process.env.CARD_ROLLUPS_MAX_AGE_SECONDS ?? '', 10);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000;
}

/** Pré-cálculo de loadClusterRollups (spec §6.3): mesmo SQL, resultado guardado por modo de sintéticos. */
@Injectable()
export class CardRollupsService {
  private readonly logger = new Logger(CardRollupsService.name);
  private refreshing: Promise<number> | null = null;
  private lastMarkAt = 0;
  private backgroundTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getRows(category?: string): Promise<ClusterRollupRow[]> {
    const mode = includeSyntheticData();
    const state = await this.prisma.cardRollupState.findUnique({ where: { includeSynthetic: mode } });
    if (!state || state.stale || Date.now() - state.computedAt.getTime() > maxAgeMs()) await this.refresh();
    const rows = await this.prisma.cardRollup.findMany({
      where: category ? { includeSynthetic: mode, category } : { includeSynthetic: mode },
      orderBy: { sortOrder: 'asc' },
      select: { row: true },
    });
    return rows.map((r) => r.row as unknown as ClusterRollupRow);
  }

  refresh(): Promise<number> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const mode = includeSyntheticData();
      const startedAt = new Date();
      const rows = await queryCardRollupRows(this.prisma);
      const data = rows.map((row, index) => ({
        includeSynthetic: mode,
        productClusterId: row.id,
        category: row.category,
        sortOrder: index,
        row: JSON.parse(JSON.stringify(numbersAsText(row as unknown as Record<string, unknown>))) as Prisma.InputJsonValue,
      }));
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('card_rollups_refresh'))`;
        await tx.cardRollup.deleteMany({ where: { includeSynthetic: mode } });
        for (let i = 0; i < data.length; i += WRITE_CHUNK) {
          await tx.cardRollup.createMany({ data: data.slice(i, i + WRITE_CHUNK) });
        }
        // markStale chegou durante o cálculo? Continua desatualizado (o próximo recálculo pega a mudança).
        const stillStale = this.lastMarkAt > startedAt.getTime();
        await tx.cardRollupState.upsert({
          where: { includeSynthetic: mode },
          create: { includeSynthetic: mode, computedAt: startedAt, stale: stillStale },
          update: { computedAt: startedAt, stale: stillStale },
        });
      }, { timeout: 120_000 });
      return rows.length;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Recalcula se stale ou mais velho que `ageMs`; devolve o nº de cards ou null se não precisou. */
  async refreshIfOlderThan(ageMs: number): Promise<number | null> {
    const state = await this.prisma.cardRollupState.findUnique({ where: { includeSynthetic: includeSyntheticData() } });
    if (state && !state.stale && Date.now() - state.computedAt.getTime() <= ageMs) return null;
    return this.refresh();
  }

  /** Dados mudaram: marca desatualizado (throttle por processo) e agenda recálculo em segundo plano. */
  markStale(): void {
    const now = Date.now();
    if (now - this.lastMarkAt >= MARK_STALE_THROTTLE_MS) {
      this.lastMarkAt = now;
      void this.prisma.cardRollupState
        .updateMany({ where: { includeSynthetic: includeSyntheticData() }, data: { stale: true } })
        .catch((error) => this.logger.warn(`markStale falhou: ${error instanceof Error ? error.message : error}`));
    }
    if (this.backgroundTimer) return;
    this.backgroundTimer = setTimeout(() => {
      this.backgroundTimer = null;
      void this.refresh().catch((error) => this.logger.warn(`Pré-cálculo falhou: ${error instanceof Error ? error.message : error}`));
    }, BACKGROUND_DELAY_MS);
    this.backgroundTimer.unref?.();
  }
}
