import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { CardRollupsService } from '../../shared/card-rollups/card-rollups.service';
import {
  CardKeyAttr,
  CatalogTypeDef,
  ComparisonAttr,
  TaxonomySeedFile,
} from './taxonomy.types';

type SeedType = TaxonomySeedFile['types'][number];

/** Converte o formato compacto do arquivo semente para o JSON gravado no banco. */
export function seedTypeToDb(t: SeedType): {
  cardKeyAttrs: CardKeyAttr[];
  comparisonAttrs: ComparisonAttr[];
  variationAttrs: string[];
} {
  return {
    cardKeyAttrs: t.card_key_attrs.map((a) => ({
      attr: a.attr,
      label_pt: a.label_pt,
      values: a.values.map(([value, label_pt, aliases]) => ({ ...(aliases?.length ? { aliases } : {}), value, label_pt })),
    })),
    comparisonAttrs: t.comparison_attrs.map(([attr, label_pt, kind, unit]) =>
      unit ? { attr, label_pt, kind, unit } : { attr, label_pt, kind },
    ),
    variationAttrs: [...t.variation_attrs],
  };
}

function mergeCardKeyAttrs(existing: unknown, incoming: CardKeyAttr[]): CardKeyAttr[] {
  const result: CardKeyAttr[] = Array.isArray(existing)
    ? (existing as CardKeyAttr[]).map((attr) => ({
        ...attr,
        values: (attr.values ?? []).map((value) => ({ ...value, ...(value.aliases?.length ? { aliases: [...value.aliases] } : {}) })),
      }))
    : [];
  for (const attr of incoming) {
    const current = result.find((candidate) => candidate.attr === attr.attr);
    if (!current) {
      result.push({ ...attr, values: attr.values.map((value) => ({ ...value, ...(value.aliases?.length ? { aliases: [...value.aliases] } : {}) })) });
      continue;
    }
    current.label_pt = attr.label_pt || current.label_pt;
    for (const value of attr.values) {
      const old = current.values.find((candidate) => candidate.value === value.value);
      if (!old) {
        current.values.push({ ...value, ...(value.aliases?.length ? { aliases: [...value.aliases] } : {}) });
        continue;
      }
      const aliases = [...new Set([...(old.aliases ?? []), ...(value.aliases ?? [])])];
      Object.assign(old, { label_pt: value.label_pt || old.label_pt, ...(aliases.length ? { aliases } : {}) });
    }
  }
  return result;
}

function mergeComparisonAttrs(existing: unknown, incoming: ComparisonAttr[]): ComparisonAttr[] {
  const result: ComparisonAttr[] = Array.isArray(existing) ? [...(existing as ComparisonAttr[])] : [];
  for (const attr of incoming) {
    const current = result.find((candidate) => candidate.attr === attr.attr);
    if (!current) result.push({ ...attr });
    else Object.assign(current, { label_pt: attr.label_pt || current.label_pt, kind: current.kind || attr.kind, unit: current.unit ?? attr.unit });
  }
  return result;
}

function mergeStringValues(existing: unknown, incoming: string[]): string[] {
  return [...new Set([...(Array.isArray(existing) ? existing as string[] : []), ...incoming])];
}

@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cardRollups?: CardRollupsService,
  ) {}

  async listActiveTypes(): Promise<CatalogTypeDef[]> {
    const rows = await this.prisma.catalogType.findMany({
      where: { active: true },
      include: { family: true },
      orderBy: { key: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      familyKey: row.family.key,
      familyNamePt: row.family.namePt,
      namePt: row.namePt,
      descriptionEn: row.descriptionEn,
      ncm: row.ncm ?? null,
      cardKeyAttrs: (row.cardKeyAttrs as unknown as CardKeyAttr[]) ?? [],
      comparisonAttrs: (row.comparisonAttrs as unknown as ComparisonAttr[]) ?? [],
      variationAttrs: (row.variationAttrs as unknown as string[]) ?? [],
    }));
  }

  async getTypeMap(): Promise<Map<string, CatalogTypeDef>> {
    return new Map((await this.listActiveTypes()).map((t) => [t.key, t]));
  }

  /** Subprojeto C: termos do radar por tipo → keyword_terms (pt = BR, en = US). Nunca apaga. */
  async seedTrendTerms(file: TaxonomySeedFile): Promise<{ activated: number; deactivated: number }> {
    const wanted: Array<{ term: string; language: 'pt' | 'en'; category: string }> = [];
    for (const type of file.types) {
      const terms = type.trend_terms;
      if (!terms) continue;
      for (const language of ['pt', 'en'] as const) {
        const term = terms[language]?.trim().toLowerCase();
        if (term) wanted.push({ term, language, category: type.key });
      }
    }
    if (wanted.length === 0) return { activated: 0, deactivated: 0 };

    const categories = [...new Set(wanted.map((term) => term.category))];
    const existing = await this.prisma.keywordTerm.findMany({
      where: { category: { in: categories }, active: true },
    });
    const wantedKeys = new Set(wanted.map((term) => `${term.term}|${term.language}|${term.category}`));
    const stale = existing
      .filter((term) => !wantedKeys.has(`${term.term}|${term.language}|${term.category}`))
      .map((term) => term.id);
    if (stale.length > 0) {
      await this.prisma.keywordTerm.updateMany({ where: { id: { in: stale } }, data: { active: false } });
    }
    for (const term of wanted) {
      await this.prisma.keywordTerm.upsert({
        where: { term_language_category: term },
        create: { ...term, active: true, priority: 100 },
        update: { active: true },
      });
    }
    this.cardRollups?.markStale();
    return { activated: wanted.length, deactivated: stale.length };
  }

  /** Idempotente: upsert por `key`. Tipos com source='approved' (criados na revisão) não são tocados. */
  async seedFromFile(file: TaxonomySeedFile): Promise<{ families: number; types: number }> {
    const familyIds = new Map<string, string>();
    for (const f of file.families) {
      const row = await this.prisma.catalogFamily.upsert({
        where: { key: f.key },
        update: { namePt: f.name_pt, sortOrder: f.sort },
        create: { key: f.key, namePt: f.name_pt, sortOrder: f.sort },
      });
      familyIds.set(f.key, row.id);
    }
    let types = 0;
    for (const t of file.types) {
      const existing = await this.prisma.catalogType.findUnique({ where: { key: t.key } });
      if (existing?.source === 'approved') continue;
      const familyId = familyIds.get(t.family);
      if (!familyId) throw new Error(`Família inexistente no arquivo: ${t.family} (tipo ${t.key})`);
      const json = seedTypeToDb(t);
      const cardKeyAttrs = mergeCardKeyAttrs(existing?.cardKeyAttrs, json.cardKeyAttrs);
      const comparisonAttrs = mergeComparisonAttrs(existing?.comparisonAttrs, json.comparisonAttrs);
      const variationAttrs = mergeStringValues(existing?.variationAttrs, json.variationAttrs);
      const data = {
        familyId,
        namePt: t.name_pt,
        descriptionEn: t.description_en,
        ncm: t.ncm ?? existing?.ncm ?? null,
        cardKeyAttrs: cardKeyAttrs as unknown as Prisma.InputJsonValue,
        comparisonAttrs: comparisonAttrs as unknown as Prisma.InputJsonValue,
        variationAttrs: variationAttrs as unknown as Prisma.InputJsonValue,
        source: 'seed',
      };
      await this.prisma.catalogType.upsert({
        where: { key: t.key },
        update: data,
        create: { key: t.key, ...data },
      });
      types += 1;
    }
    await this.seedTrendTerms(file);
    this.cardRollups?.markStale();
    return { families: file.families.length, types };
  }
}
