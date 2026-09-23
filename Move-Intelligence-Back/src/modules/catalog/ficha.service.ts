import { Injectable, Logger } from '@nestjs/common';
import { ListingFicha, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { AssignResult, CardAssignerService } from './card-assigner.service';
import {
  FICHA_ENDPOINT_NAME,
  FICHA_PROMPT_VERSION,
  MAX_FICHA_ATTEMPTS,
  PRIORITY,
  UNKNOWN_TYPE,
  autoAssignConfig,
  fichaConfig,
} from './catalog.constants';
import { remainingFichaCalls } from './ficha-budget';
import { fichaDbFields } from './ficha-db-fields';
import { buildFichaInput, inputHash } from './ficha-input';
import { parseFichaJsonLines, validateFicha } from './ficha-parser';
import { buildFichaSystemPrompt, buildFichaUserMessage } from './ficha-prompt';
import { TaxonomyService } from './taxonomy.service';
import { evaluateCardKey } from './card-key';

export interface RegisterListingInput {
  marketplace: string;
  externalProductId: string;
  title: string;
  excerpt?: string | null;
  priority?: number;
}
export type RegisterResult = 'created' | 'updated' | 'unchanged' | 'assigned';
export interface FichaRunSummary {
  calls: number;
  done: number;
  copied: number;
  failed: number;
  stoppedBy: 'disabled' | 'running' | 'empty' | 'budget' | 'daily_limit' | 'error' | 'max_rounds' | 'max_calls';
}
export type HeldOutcome = 'fica' | 'muda' | 'fora_do_escopo' | 'tipo_sugerido' | 'revisao_admin' | 'novo';
export interface HeldReport {
  total: number;
  counts: Partial<Record<HeldOutcome, number>>;
  examples: Partial<Record<HeldOutcome, Array<{ title: string; from: string | null; typeKey: string | null }>>>;
}

const MAX_ROUNDS = 500;
const COPY_FIELDS = [
  'typeKey', 'suggestedType', 'inScope', 'isAccessoryOrPart', 'isKitOrBundle', 'hasVariations', 'cardKeyValues',
  'newDifferential', 'missingKeyAttrs', 'comparisonValues', 'variationValues', 'specs', 'brand', 'model',
  'confidence', 'llmModel', 'promptVersion',
] as const;

@Injectable()
export class FichaService {
  private readonly logger = new Logger(FichaService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
    private readonly assigner: CardAssignerService,
    private readonly llm: OpenRouterService,
  ) {}

  async currentCardId(listing: { marketplace: string; externalProductId: string }): Promise<string | null> {
    const item = await this.prisma.productClusterItem.findUnique({
      where: { marketplace_externalProductId: listing },
      select: { clusterId: true },
    });
    return item?.clusterId ?? null;
  }

  /** Processa uma ficha já em erro sem chamar a LLM; usado pelo auto-resolve. */
  async autoResolveError(ficha: ListingFicha): Promise<'requeued' | 'review'> {
    const error = ficha.lastError ?? 'ficha falhou';
    const requeue = await this.requeueFailedFicha(ficha, error);
    if (requeue.requeued) return 'requeued';
    const listing = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
    await this.assigner.ensureListingReview(listing, await this.currentCardId(listing), `ficha falhou ${requeue.count + 1} vezes`);
    return 'review';
  }

  /** Porta única: os 4 caminhos de entrada chamam isto (spec 6.4). Nunca cria cluster diretamente. */
  async registerListing(input: RegisterListingInput): Promise<RegisterResult> {
    const listing = { marketplace: input.marketplace, externalProductId: input.externalProductId };
    const hash = inputHash(buildFichaInput(input.title, input.excerpt));
    const priority = input.priority ?? PRIORITY.DISCOVERY;
    const existing = await this.prisma.listingFicha.findUnique({ where: { marketplace_externalProductId: listing } });

    if (existing && existing.inputHash === hash) {
      if (existing.status === 'done' && existing.inScope !== false && existing.typeKey !== UNKNOWN_TYPE) {
        const item = await this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } });
        if (!item) {
          await this.assigner.assign(existing);
          return 'assigned';
        }
      }
      return 'unchanged';
    }

    const row = existing
      ? await this.prisma.listingFicha.update({
          where: { id: existing.id },
          data: { title: input.title, inputHash: hash, status: 'pending', priority: Math.max(existing.priority, priority), attempts: 0, lastError: null },
        })
      : await this.prisma.listingFicha.create({ data: { ...listing, title: input.title, inputHash: hash, priority } });

    const copied = await this.copyFromTwin(row, false);
    if (copied) return 'assigned';
    return existing ? 'updated' : 'created';
  }

  async runOnce(now: () => Date = () => new Date(), opts: { maxCalls?: number; hold?: boolean } = {}): Promise<FichaRunSummary> {
    const cfg = fichaConfig();
    const summary: FichaRunSummary = { calls: 0, done: 0, copied: 0, failed: 0, stoppedBy: 'empty' };
    if (!cfg.enabled) return { ...summary, stoppedBy: 'disabled' };
    if (this.running) return { ...summary, stoppedBy: 'running' };
    this.running = true;
    try {
      const types = await this.taxonomy.getTypeMap();
      const system = buildFichaSystemPrompt([...types.values()]);
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const pending = await this.prisma.listingFicha.findMany({
          where: { status: 'pending' },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
          take: cfg.batchSize * 3,
        });
        if (pending.length === 0) return { ...summary, stoppedBy: 'empty' };

        const refresh: Array<{ clusterId: string; lastDestination: string | null }> = [];
        const batch: ListingFicha[] = [];
        const hashesInBatch = new Set<string>();
        for (const ficha of pending) {
          const copied = await this.copyFromTwin(ficha, true, opts.hold === true);
          if (copied) {
            summary.copied += 1;
            refresh.push(...this.refreshPairs(copied));
            continue;
          }
          if (opts.hold && ficha.status === 'held') {
            summary.copied += 1;
            continue;
          }
          if (hashesInBatch.has(ficha.inputHash)) continue; // a gêmea copia na próxima rodada
          hashesInBatch.add(ficha.inputHash);
          batch.push(ficha);
          if (batch.length >= cfg.batchSize) break;
        }
        if (batch.length === 0) {
          await this.assigner.refreshMany(refresh);
          continue;
        }
        if ((await remainingFichaCalls(this.prisma, cfg.dailyCallLimit, now())) <= 0) {
          await this.assigner.refreshMany(refresh);
          return { ...summary, stoppedBy: 'budget' };
        }

        const requestBatch = async (currentBatch: ListingFicha[]) => {
          const items = await Promise.all(
            currentBatch.map(async (ficha, index) => ({ ref: `L${index + 1}`, text: await this.inputText(ficha) })),
          );
          const response = await this.llm.chatCompletion(
            [
              { role: 'system', content: system },
              { role: 'user', content: buildFichaUserMessage(items) },
            ],
            {
              endpointName: FICHA_ENDPOINT_NAME,
              model: cfg.model,
              maxTokens: cfg.maxTokens,
              timeoutMs: cfg.timeoutMs,
              temperature: 0.2,
              metadata: { listings: currentBatch.length, promptVersion: FICHA_PROMPT_VERSION },
            },
          );
          summary.calls += 1;
          return response;
        };

        let content: string | null;
        let model: string;
        try {
          if (opts.maxCalls !== undefined && summary.calls >= opts.maxCalls) {
            await this.assigner.refreshMany(refresh);
            return { ...summary, stoppedBy: 'max_calls' };
          }
          const response = await requestBatch(batch);
          content = response.content;
          model = response.model;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.assigner.refreshMany(refresh);
          if (/429/.test(message) && /per-day|per day|daily/i.test(message)) {
            return { ...summary, stoppedBy: 'daily_limit' };
          }
          summary.failed += await this.bumpAttempts(batch, message.slice(0, 500), refresh);
          await this.assigner.refreshMany(refresh);
          this.logger.warn(`Lote de fichas falhou: ${message.slice(0, 200)}`);
          return { ...summary, stoppedBy: 'error' };
        }

        let parsed = parseFichaJsonLines(content);
        if (parsed.length === 0 && batch.length > 1 && (await remainingFichaCalls(this.prisma, cfg.dailyCallLimit, now())) > 0) {
          if (opts.maxCalls !== undefined && summary.calls >= opts.maxCalls) {
            await this.assigner.refreshMany(refresh);
            return { ...summary, stoppedBy: 'max_calls' };
          }
          const retryBatch = batch.slice(0, Math.ceil(batch.length / 2));
          try {
            const retryResponse = await requestBatch(retryBatch);
            content = retryResponse.content;
            model = retryResponse.model;
            parsed = parseFichaJsonLines(content);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.assigner.refreshMany(refresh);
            if (/429/.test(message) && /per-day|per day|daily/i.test(message)) {
              return { ...summary, stoppedBy: 'daily_limit' };
            }
            summary.failed += await this.bumpAttempts(batch, message.slice(0, 500), refresh);
            await this.assigner.refreshMany(refresh);
            this.logger.warn(`Lote de fichas falhou no retry: ${message.slice(0, 200)}`);
            return { ...summary, stoppedBy: 'error' };
          }
        }

        const byRef = new Map(parsed.map((line) => [line.ref, line]));
        for (const [index, ficha] of batch.entries()) {
          const line = byRef.get(`L${index + 1}`);
          if (!line) {
            summary.failed += await this.bumpAttempts([ficha], 'sem resposta no lote', refresh);
            continue;
          }
          const updated = await this.prisma.listingFicha.update({
            where: { id: ficha.id },
            data: { ...fichaDbFields(validateFicha(line, types)), status: opts.hold ? 'held' : 'done', lastError: null, llmModel: model, promptVersion: FICHA_PROMPT_VERSION },
          });
          if (!opts.hold) {
            const result = await this.assigner.assign(updated, { deferRefresh: true });
            refresh.push(...this.refreshPairs(result));
          }
          summary.done += 1;
        }
        await this.assigner.refreshMany(refresh);
      }
      return { ...summary, stoppedBy: 'max_rounds' };
    } finally {
      this.running = false;
    }
  }

  async previewHeld(): Promise<HeldReport> {
    const held = await this.prisma.listingFicha.findMany({ where: { status: 'held' } });
    const types = await this.taxonomy.getTypeMap();
    const report: HeldReport = { total: held.length, counts: {}, examples: {} };
    for (const ficha of held) {
      const listing = { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId };
      const item = await this.prisma.productClusterItem.findUnique({ where: { marketplace_externalProductId: listing } });
      const card = item ? await this.prisma.productCluster.findUnique({ where: { id: item.clusterId }, select: { cardKey: true, canonicalName: true } }) : null;
      let outcome: HeldOutcome;
      const type = ficha.typeKey ? types.get(ficha.typeKey) : undefined;
      if (ficha.inScope === false) outcome = 'fora_do_escopo';
      else if (!type) outcome = 'tipo_sugerido';
      else if (!item) outcome = 'novo';
      else {
        const key = evaluateCardKey(type, (ficha.cardKeyValues ?? {}) as Record<string, unknown>, ficha.newDifferential).cardKey;
        outcome = key === card?.cardKey ? 'fica' : 'muda';
      }
      if ((outcome === 'muda' || outcome === 'fora_do_escopo' || outcome === 'tipo_sugerido') && item
        && (await this.assigner.humanDecisionCard(listing)) === item.clusterId) outcome = 'revisao_admin';
      report.counts[outcome] = (report.counts[outcome] ?? 0) + 1;
      const list = (report.examples[outcome] ??= []);
      if (list.length < 20) list.push({ title: ficha.title, from: card?.canonicalName ?? null, typeKey: ficha.typeKey });
    }
    return report;
  }

  async applyHeld(): Promise<{ applied: number; blocked: number }> {
    const held = await this.prisma.listingFicha.findMany({ where: { status: 'held' }, orderBy: { updatedAt: 'asc' } });
    const refresh: Array<{ clusterId: string; lastDestination: string | null }> = [];
    let applied = 0;
    let blocked = 0;
    for (const ficha of held) {
      const updated = await this.prisma.listingFicha.update({ where: { id: ficha.id }, data: { status: 'done' } });
      const result = await this.assigner.assign(updated, { deferRefresh: true, guardHuman: true });
      if (result.outcome === 'error_review') blocked += 1;
      refresh.push(...this.refreshPairs(result));
      applied += 1;
    }
    await this.assigner.refreshMany(refresh);
    return { applied, blocked };
  }

  private refreshPairs(result: AssignResult): Array<{ clusterId: string; lastDestination: string | null }> {
    return result.touched.map((clusterId) => ({
      clusterId,
      lastDestination: clusterId === result.clusterId ? null : result.clusterId,
    }));
  }

  private async bumpAttempts(
    fichas: ListingFicha[],
    error: string,
    refresh: Array<{ clusterId: string; lastDestination: string | null }>,
  ): Promise<number> {
    for (const ficha of fichas) {
      const attempts = ficha.attempts + 1;
      const failed = attempts >= MAX_FICHA_ATTEMPTS;
      const updated = await this.prisma.listingFicha.update({
        where: { id: ficha.id },
        data: { attempts, lastError: error, ...(failed ? { status: 'error' } : {}) },
      });
      if (failed) {
        const requeue = await this.requeueFailedFicha(updated, error);
        if (!requeue.requeued) {
          const clusterId = await this.currentCardId({ marketplace: updated.marketplace, externalProductId: updated.externalProductId });
          await this.assigner.ensureListingReview(
            { marketplace: updated.marketplace, externalProductId: updated.externalProductId },
            clusterId,
            `ficha falhou ${requeue.count + 1} vezes`,
          );
        }
      }
    }
    return fichas.length;
  }

  private async requeueCount(ficha: Pick<ListingFicha, 'marketplace' | 'externalProductId'>): Promise<number> {
    const decisions = await this.prisma.catalogDecision.findMany({
      where: { action: 'auto_requeue' },
      select: { before: true, after: true },
    });
    const sameListing = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const listing = (value as { listing?: unknown }).listing;
      if (!listing || typeof listing !== 'object') return false;
      const ref = listing as { marketplace?: unknown; externalProductId?: unknown };
      return ref.marketplace === ficha.marketplace && ref.externalProductId === ficha.externalProductId;
    };
    return decisions.filter((decision) => sameListing(decision.before) || sameListing(decision.after)).length;
  }

  private async requeueFailedFicha(ficha: ListingFicha, error: string): Promise<{ requeued: boolean; count: number }> {
    const count = await this.requeueCount(ficha);
    if (count >= autoAssignConfig().maxRequeues) return { requeued: false, count };
    await this.prisma.listingFicha.update({
      where: { id: ficha.id },
      data: { status: 'pending', attempts: 0, priority: PRIORITY.REPROCESS, lastError: error },
    });
    await this.prisma.catalogDecision.create({
      data: {
        action: 'auto_requeue',
        actorUserId: null,
        reviewItemId: null,
        before: {
          listing: { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId },
          status: 'error', attempts: ficha.attempts,
        } as Prisma.InputJsonValue,
        after: {
          listing: { marketplace: ficha.marketplace, externalProductId: ficha.externalProductId },
          status: 'pending', attempts: 0, priority: PRIORITY.REPROCESS,
        } as Prisma.InputJsonValue,
      },
    });
    return { requeued: true, count };
  }

  private async copyFromTwin(ficha: ListingFicha, deferRefresh: boolean, hold = false): Promise<AssignResult | null> {
    const twin = await this.prisma.listingFicha.findFirst({
      where: { inputHash: ficha.inputHash, status: hold ? { in: ['done', 'held'] } : 'done', id: { not: ficha.id } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!twin) return null;
    const data: Record<string, unknown> = { status: hold ? 'held' : 'done', lastError: null, copiedFromFichaId: twin.copiedFromFichaId ?? twin.id };
    for (const field of COPY_FIELDS) data[field] = (twin as unknown as Record<string, unknown>)[field];
    const updated = await this.prisma.listingFicha.update({
      where: { id: ficha.id },
      data: data as Prisma.ListingFichaUpdateInput,
    });
    if (hold) {
      // Marca a cópia no objeto da fila para runOnce contabilizá-la sem atribuir card.
      ficha.status = 'held';
      return null;
    }
    return this.assigner.assign(updated, { deferRefresh });
  }

  private async inputText(ficha: ListingFicha): Promise<string> {
    const product = await this.prisma.intelligenceProduct.findFirst({
      where: { source: ficha.marketplace, recordId: ficha.externalProductId },
      orderBy: { capturedAt: 'desc' },
      select: { sourceSpecific: true },
    });
    const specific = (product?.sourceSpecific ?? {}) as Record<string, unknown>;
    const excerpt = typeof specific['page_excerpt'] === 'string' ? (specific['page_excerpt'] as string) : null;
    return buildFichaInput(ficha.title, excerpt);
  }

}
