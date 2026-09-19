import { ListingFicha } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { ACTIVE_CARD_STATUSES, FICHA_PROMPT_VERSION } from './catalog.constants';
import { CardAssignerService, AssignResult, ListingRef } from './card-assigner.service';
import { fichaDbFields } from './ficha-db-fields';
import { inputHash } from './ficha-input';
import { parseFichaJsonLines, RawFichaLine, validateFicha } from './ficha-parser';
import { TaxonomyService } from './taxonomy.service';

const MANUAL_MODEL = 'codex-manual';

export interface ImportFichasSummary {
  imported: number;
  newCards: number;
  newConfirmedCards: number;
  newProvisionalCards: number;
  confirmedAssignments: number;
  provisionalAssignments: number;
  outOfScope: number;
  suggestedType: number;
}

interface ImportEntry {
  line: RawFichaLine;
  listing: ListingRef;
  ficha: ListingFicha;
  validated: ReturnType<typeof validateFicha>;
}

export interface FichaImporterDependencies {
  prisma: PrismaService;
  taxonomy: TaxonomyService;
  assigner: CardAssignerService;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveListing(line: RawFichaLine): ListingRef {
  const marketplace = text(line.marketplace);
  const externalProductId = text(line.external_product_id) ?? text(line.externalProductId);
  if (marketplace && externalProductId) return { marketplace, externalProductId };

  const ref = text(line.ref);
  const separator = ref?.indexOf('::') ?? -1;
  if (ref && separator > 0) {
    return { marketplace: ref.slice(0, separator), externalProductId: ref.slice(separator + 2) };
  }
  throw new Error(`Ficha ${String(line.ref ?? '<sem ref>')} sem marketplace/external_product_id`);
}

function refreshPairs(result: AssignResult): Array<{ clusterId: string; lastDestination: string | null }> {
  return result.touched.map((clusterId) => ({
    clusterId,
    lastDestination: clusterId === result.clusterId ? null : result.clusterId,
  }));
}

/** Importa fichas já geradas, usando a mesma validação e atribuição do worker. */
export async function importManualFichas(
  rawLines: RawFichaLine[],
  deps: FichaImporterDependencies,
): Promise<ImportFichasSummary> {
  const types = await deps.taxonomy.getTypeMap();
  const entries: ImportEntry[] = [];
  const seen = new Set<string>();

  for (const line of rawLines) {
    const listing = resolveListing(line);
    const key = `${listing.marketplace}::${listing.externalProductId}`;
    if (seen.has(key)) throw new Error(`Ficha duplicada no arquivo: ${key}`);
    seen.add(key);

    const ficha = await deps.prisma.listingFicha.findUnique({
      where: { marketplace_externalProductId: listing },
    });
    if (!ficha) throw new Error(`ListingFicha não encontrada: ${key}`);
    if (ficha.status !== 'pending' && ficha.status !== 'error') {
      throw new Error(`ListingFicha ${key} está com status ${ficha.status}; esperado pending ou error`);
    }

    const manualInput = text(line.input);
    if (manualInput && inputHash(manualInput) !== ficha.inputHash) {
      throw new Error(`Input divergente para ${key}; gere a ficha com buildFichaInput`);
    }
    entries.push({ line, listing, ficha, validated: validateFicha(line, types) });
  }

  const before = await deps.prisma.productCluster.findMany({
    where: { cardStatus: { in: [...ACTIVE_CARD_STATUSES] } },
    select: { id: true },
  });
  const beforeIds = new Set(before.map((card) => card.id));
  const touched = new Set<string>();
  const refresh: Array<{ clusterId: string; lastDestination: string | null }> = [];
  const summary: ImportFichasSummary = {
    imported: 0,
    newCards: 0,
    newConfirmedCards: 0,
    newProvisionalCards: 0,
    confirmedAssignments: 0,
    provisionalAssignments: 0,
    outOfScope: 0,
    suggestedType: 0,
  };

  for (const entry of entries) {
    const updated = await deps.prisma.listingFicha.update({
      where: { id: entry.ficha.id },
      data: {
        ...fichaDbFields(entry.validated),
        status: 'done',
        attempts: 0,
        lastError: null,
        llmModel: MANUAL_MODEL,
        promptVersion: FICHA_PROMPT_VERSION,
      },
    });
    const result = await deps.assigner.assign(updated, { deferRefresh: true });
    refresh.push(...refreshPairs(result));
    result.touched.forEach((id) => touched.add(id));
    if (result.clusterId) touched.add(result.clusterId);
    if (result.outcome === 'confirmed') summary.confirmedAssignments += 1;
    if (result.outcome === 'provisional') summary.provisionalAssignments += 1;
    if (result.outcome === 'out_of_scope') summary.outOfScope += 1;
    if (result.outcome === 'suggested_type') summary.suggestedType += 1;
    summary.imported += 1;
  }

  await deps.assigner.refreshMany(refresh);

  const after = await deps.prisma.productCluster.findMany({
    where: { id: { in: [...touched] }, cardStatus: { in: [...ACTIVE_CARD_STATUSES] } },
    select: { id: true, cardStatus: true },
  });
  const created = after.filter((card) => !beforeIds.has(card.id));
  summary.newCards = created.length;
  summary.newConfirmedCards = created.filter((card) => card.cardStatus === 'confirmed').length;
  summary.newProvisionalCards = created.filter((card) => card.cardStatus === 'provisional').length;
  return summary;
}

export { MANUAL_MODEL, parseFichaJsonLines };
