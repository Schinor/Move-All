/**
 * Seed de SIMULAÇÃO a partir de um CSV de shipments (TradeAtlas).
 *
 * Objetivo: popular o banco com dados reais de importação para simular a coleta
 * e rodar as análises, ENQUANTO as APIs reais não estão integradas.
 *
 * Isolamento (não atrapalha a integração real):
 *   - Não importa nem altera conectores/ingestion; é um script standalone.
 *   - Todos os snapshots recebem marketplace = 'tradeatlas' (fonte de simulação),
 *     distinguível das fontes reais (aliexpress, 1688, amazon, ...).
 *   - Clusters de simulação têm nome com prefixo fixo, então o seed é
 *     idempotente e removível sem afetar dados reais.
 *
 * Uso:
 *   npm run seed:tradeatlas            # limpa a simulação e recarrega do CSV
 *   npm run seed:tradeatlas -- --clear # apenas remove os dados de simulação
 *   npm run seed:tradeatlas -- --file /caminho/arquivo.csv
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SIM_MARKETPLACE = 'tradeatlas';
const CLUSTER_PREFIX = 'Equipamento fitness —';
const CATEGORY = 'equipamento de musculação';

// ---- CSV parser (RFC4180: aspas + vírgulas/quebras dentro de aspas) --------
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = parseFloat(raw.replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
}

function parseDate(raw: string | undefined): Date {
  // formato dd-mm-yyyy
  const m = (raw ?? '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return new Date();
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function deterministicUuid(key: string): string {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'na';
}

async function clearSim(): Promise<void> {
  const deletedSnaps = await prisma.productListingSnapshot.deleteMany({
    where: { marketplace: SIM_MARKETPLACE },
  });
  const deletedClusters = await prisma.productCluster.deleteMany({
    where: { canonicalName: { startsWith: CLUSTER_PREFIX } },
  });
  console.log(`[clear] snapshots removidos: ${deletedSnaps.count}, clusters: ${deletedClusters.count}`);
}

async function seed(file: string): Promise<void> {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const header = rows[1]; // linha 0 = grupos; linha 1 = nomes reais
  const idx = (name: string) => header.indexOf(name);
  const col = {
    date: idx('ARRIVAL DATE'),
    exporter: idx('EXPORTER NAME'),
    exporterCountry: idx('EXPORTER COUNTRY'),
    origin: idx('COUNTRY OF ORIGIN'),
    hs: idx('HS CODE'),
    hsDesc: idx('HS CODE DESCRIPTION'),
    product: idx('PRODUCT DETAILS'),
    usdFob: idx('USD FOB'),
    unit: idx('UNIT PRICE'),
    qty: idx('QUANTITY'),
    netWeight: idx('NET WEIGHT'),
    packages: idx('NUMBER OF PACKAGES'),
    decl: idx('DECLARATION NUMBER'),
    no: idx('NO'),
  };

  const data = rows.slice(2).filter((r) => r.some((c) => c && c.trim()));

  // Mantém só linhas cujo HS primário é fitness (9506); descarta contêineres mistos.
  const fitness = data.filter((r) => {
    const primary = (r[col.hs] ?? '').split('|')[0].trim();
    return primary.startsWith('9506');
  });

  // Datas do CSV são de 2022; como é SIMULAÇÃO, remapeamos linearmente para os
  // últimos ~6 meses (preservando ordem/espaçamento) para que as janelas
  // temporais (price-history?window=..., "Sinais/24h") funcionem.
  const times = fitness.map((r) => parseDate(r[col.date]).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const now = Date.now();
  const targetSpan = 179 * 24 * 60 * 60 * 1000;
  const remapDate = (orig: Date): Date => {
    if (maxT === minT) return new Date(now);
    const frac = (orig.getTime() - minT) / (maxT - minT);
    return new Date(now - targetSpan + frac * targetSpan);
  };

  // Cluster por origem do exportador → "produto" comparável ao longo do tempo.
  const byCountry = new Map<string, string[][]>();
  for (const r of fitness) {
    const country = (r[col.exporterCountry] ?? r[col.origin] ?? 'Desconhecido').trim() || 'Desconhecido';
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push(r);
  }

  let clusters = 0;
  let snapshots = 0;

  for (const [country, shipments] of byCountry) {
    const canonicalName = `${CLUSTER_PREFIX} ${country}`;
    const clusterId = deterministicUuid(`tradeatlas:${country}`);

    await prisma.productCluster.upsert({
      where: { id: clusterId },
      update: { canonicalName, category: CATEGORY },
      create: { id: clusterId, canonicalName, category: CATEGORY, confidenceScore: 1 },
    });
    clusters++;

    for (let i = 0; i < shipments.length; i++) {
      const r = shipments[i];
      const qty = num(r[col.qty]);
      const fob = num(r[col.usdFob]);
      const unit = num(r[col.unit]);
      // preço unitário em USD, melhor esforço
      let price: number | null = null;
      if (unit && unit > 0) price = unit;
      else if (fob && fob > 0 && qty && qty > 0) price = fob / qty;
      else if (fob && fob > 0) price = fob;

      const volume = qty && qty > 0 ? qty : num(r[col.netWeight]);
      const exporter = (r[col.exporter] ?? '').trim() || 'Desconhecido';

      await prisma.productListingSnapshot.create({
        data: {
          marketplace: SIM_MARKETPLACE,
          externalProductId: (r[col.decl] || `${country}-${r[col.no] || i}`).trim(),
          productClusterId: clusterId,
          title: (r[col.product] ?? '').trim().slice(0, 180) || canonicalName,
          priceMin: price ?? undefined,
          currency: price ? 'USD' : undefined,
          salesSignalRaw: volume ?? undefined,
          salesSignalType: volume ? 'latest_volume' : undefined,
          moq: num(r[col.packages]) ? Math.round(num(r[col.packages])!) : undefined,
          sellerId: slug(exporter),
          sellerName: exporter,
          collectedAt: remapDate(parseDate(r[col.date])),
        },
      });
      snapshots++;
    }
  }

  console.log(`[seed] clusters (origens): ${clusters}, snapshots (embarques): ${snapshots}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const clearOnly = args.includes('--clear');
  const fileArg = args.indexOf('--file');
  const file =
    fileArg >= 0
      ? resolve(args[fileArg + 1])
      : process.env.TRADEATLAS_CSV
        ? resolve(process.env.TRADEATLAS_CSV)
        : resolve(__dirname, '..', '..', 'TradeAtlas-Shipment-Download-7-4-2026.csv');

  await clearSim();
  if (!clearOnly) {
    console.log(`[seed] lendo ${file}`);
    await seed(file);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
