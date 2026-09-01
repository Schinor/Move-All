#!/usr/bin/env node

/**
 * Demonstrador didático de uma coleta com Bright Data.
 *
 * Este arquivo mostra o fluxo usado na coleta anterior:
 *
 *   1. montar uma consulta para a SERP;
 *   2. descobrir URLs candidatas;
 *   3. buscar as páginas selecionadas pelo Web Unlocker;
 *   4. extrair sinais básicos do Markdown retornado;
 *   5. salvar candidatos, registros normalizados e erros.
 *
 * O script não faz chamadas externas por padrão. Isso permite compartilhá-lo
 * com segurança e demonstrá-lo sem consumir créditos.
 *
 * Requisitos: Node.js 18+ (fetch nativo).
 *
 * Dry-run, sem API key:
 *   node brightdata_scraper_demo.mjs --source amazon
 *
 * Execução real:
 *   BRIGHTDATA_API_KEY=... \
 *   BRIGHTDATA_SERP_ZONE=... \
 *   BRIGHTDATA_UNLOCKER_ZONE=... \
 *   node brightdata_scraper_demo.mjs --live --source amazon --limit 2
 *
 * Scraping de uma URL específica:
 *   BRIGHTDATA_API_KEY=... \
 *   BRIGHTDATA_UNLOCKER_ZONE=... \
 *   node brightdata_scraper_demo.mjs --live --url "https://example.com/item"
 *
 * Observação: o fluxo de produção deve adicionar parsers específicos por
 * fonte. Este exemplo extrai somente campos genéricos e preserva evidências.
 */

import fs from "node:fs";

const API_URL = "https://api.brightdata.com/request";
const DEFAULT_LIMIT = 3;
const DEFAULT_CONCURRENCY = 2;

class BrightDataError extends Error {
  constructor(status, body) {
    super(`Bright Data retornou HTTP ${status}: ${String(body).slice(0, 500)}`);
    this.name = "BrightDataError";
    this.status = status;
  }
}

const PROFILES = {
  amazon: {
    country: "us",
    query: 'site:amazon.com/dp "adjustable dumbbells" "home gym"',
    accepts: (url) => /amazon\.com\/dp\/[A-Z0-9]{10}/i.test(url),
  },
  alibaba: {
    country: "us",
    query: "site:alibaba.com/product-detail home gym fitness equipment supplier",
    accepts: (url) => /alibaba\.com\/product-detail\//i.test(url),
  },
  taobao: {
    country: "cn",
    query: "site:world.taobao.com/item 健身器材",
    accepts: (url) => /^https:\/\/world\.taobao\.com\/item\//i.test(url),
  },
  tiktok_shop: {
    country: "us",
    query: 'site:shop.tiktok.com/pdp "home gym" fitness',
    accepts: (url) => /shop\.tiktok\.com\/.*\/pdp\//i.test(url),
  },
  "1688": {
    country: "cn",
    query: "site:detail.1688.com/offer 健身器材",
    accepts: (url) => /detail\.1688\.com\/offer\//i.test(url),
  },
  generic: {
    country: "us",
    query: 'home gym fitness equipment product',
    accepts: (url) => /^https?:\/\//i.test(url),
  },
};

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--live") {
      args.live = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (!token.startsWith("--")) continue;

    const raw = token.slice(2);
    const equalIndex = raw.indexOf("=");
    const rawKey = equalIndex >= 0 ? raw.slice(0, equalIndex) : raw;
    const inlineValue = equalIndex >= 0 ? raw.slice(equalIndex + 1) : null;
    const value = inlineValue ?? argv[index + 1];

    if (inlineValue === null) index += 1;

    const key = rawKey.replace(/-([a-z])/g, (_, character) =>
      character.toUpperCase(),
    );

    args[key] = value;
  }

  return args;
}

function printHelp() {
  console.log(`
Demonstrador Bright Data

Uso sem custo de API:
  node brightdata_scraper_demo.mjs --source amazon

Uso real:
  BRIGHTDATA_API_KEY=... BRIGHTDATA_SERP_ZONE=... \\
  BRIGHTDATA_UNLOCKER_ZONE=... \\
  node brightdata_scraper_demo.mjs --live --source amazon --limit 2

Opções:
  --source amazon|alibaba|taobao|tiktok_shop|1688|generic
  --query "consulta personalizada"
  --country us|cn
  --limit 3
  --concurrency 2
  --url "https://..."       raspa uma URL sem fazer busca
  --output arquivo.json
  --live                     autoriza chamadas reais à Bright Data
`);
}

function env(name, required = true) {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }

  return value || null;
}

function buildSerpPayload(query, country) {
  const params = new URLSearchParams({
    q: query,
    hl: country === "cn" ? "zh" : "en",
    gl: country,
  });

  return {
    zone: process.env.BRIGHTDATA_SERP_ZONE || "YOUR_SERP_ZONE",
    url: `https://www.google.com/search?${params.toString()}`,
    format: "raw",
    method: "GET",
    data_format: "parsed_light",
  };
}

function buildUnlockerPayload(url, country) {
  return {
    zone: process.env.BRIGHTDATA_UNLOCKER_ZONE || "YOUR_UNLOCKER_ZONE",
    url,
    format: "raw",
    method: "GET",
    ...(country ? { country } : {}),
    data_format: "markdown",
  };
}

async function requestBrightData(payload) {
  const apiKey = env("BRIGHTDATA_API_KEY");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) throw new BrightDataError(response.status, text);

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isRetryable(error) {
  return error instanceof BrightDataError &&
    (error.status === 429 || error.status >= 500);
}

async function withRetry(label, operation, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error) || attempt === attempts) throw error;

      const waitMs = 500 * (2 ** (attempt - 1));
      console.warn(`${label}: nova tentativa em ${waitMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function searchGoogle(query, country) {
  return withRetry("SERP", () =>
    requestBrightData(buildSerpPayload(query, country)),
  );
}

async function scrapeMarkdown(url, country) {
  const response = await withRetry(`scrape ${url}`, () =>
    requestBrightData(buildUnlockerPayload(url, country)),
  );

  if (typeof response === "string") return response;

  return response.content || response.body || JSON.stringify(response);
}

function parsePossiblySerializedJson(value) {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractOrganic(response) {
  const parsed = parsePossiblySerializedJson(response);
  if (!parsed || typeof parsed !== "object") return [];

  return parsed.organic || parsed.results || parsed.data?.organic || [];
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return String(value || "").toLowerCase().replace(/\/$/, "");
  }
}

function discoverCandidates(response, profile, query) {
  const seen = new Set();
  const candidates = [];

  for (const item of extractOrganic(response)) {
    const url = item.link || item.url;
    if (!url || !profile.accepts(url)) continue;

    const key = canonicalUrl(url);
    if (seen.has(key)) continue;

    seen.add(key);
    candidates.push({
      title: item.title || null,
      description: item.description || item.snippet || null,
      url,
      query,
    });
  }

  return candidates;
}

function extractImages(markdown, source) {
  const urls = [...String(markdown).matchAll(
    /!\[[^\]]*\]\(([^)]+)\)/g,
  )].map((match) => match[1]);

  return [...new Set(urls)].filter((url) => {
    if (!/^https?:\/\//i.test(url)) return false;

    if (source === "amazon") {
      return /(?:media-amazon|ssl-images-amazon)\.com\/images\/I\//i.test(url) &&
        !/product_insurance|digital\/video|icon|sprite|logo|error|21TjrUkqQaL/i.test(url);
    }

    if (source === "alibaba") return /alicdn|alibaba/i.test(url);
    if (source === "taobao") return /taobao|alicdn|tmall/i.test(url);
    if (source === "1688") return /1688|alicdn|tbcdn/i.test(url);
    if (source === "tiktok_shop") return /tiktokcdn|byteimg|ibytedtos/i.test(url);

    return true;
  });
}

function extractPrice(text) {
  const match = String(text).match(
    /(?:US\$|\$|¥|￥)\s*([0-9]+(?:[.,][0-9]+)?)/,
  );

  if (!match) return null;

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function normalizeRecord(candidate, markdown, source) {
  const content = String(markdown || "");
  const imageUrls = extractImages(content, source);
  const price = extractPrice(content) ?? extractPrice(candidate.description || "");
  const detailStatus = content.length > 1000
    ? "detail_scraped"
    : content.length > 0
      ? "partial"
      : "empty";

  const observedFields = ["url"];
  if (candidate.title) observedFields.push("title");
  if (candidate.description) observedFields.push("description");
  if (price !== null) observedFields.push("price");
  if (imageUrls.length) observedFields.push("image_url");

  return {
    source,
    captured_at: new Date().toISOString(),
    title: candidate.title,
    url: candidate.url,
    source_page_url: candidate.url,
    image_url: imageUrls[0] || null,
    image_urls: imageUrls,
    price_value: price,
    price_evidence: price === null ? null : "valor encontrado no conteúdo capturado",
    description: candidate.description,
    collection_method: "Bright Data SERP API + Web Unlocker",
    data_quality: detailStatus === "detail_scraped"
      ? "detail_scraped"
      : "search_snippet_only",
    observed_fields: observedFields,
    source_specific: {
      search_query: candidate.query || null,
      detail_scrape_status: detailStatus,
      detail_content_chars: content.length,
    },
    raw_content_preview: content.slice(0, 4000),
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );

  await Promise.all(workers);
  return results;
}

function dryRun({ source, query, country, url }) {
  const exampleUrl = url || "https://example.com/product/123";

  console.log(JSON.stringify({
    mode: "dry-run",
    source,
    search_request: url ? null : buildSerpPayload(query, country),
    scrape_request: buildUnlockerPayload(exampleUrl, country),
    explanation: [
      "A busca retorna organic[].",
      "As URLs selecionadas são enviadas ao Web Unlocker.",
      "O Markdown é analisado localmente; Bright Data não conhece o schema final do seu banco.",
      "Para uma coleta real, use --live e configure as três variáveis de ambiente.",
    ],
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  const source = String(args.source || "amazon").toLowerCase();
  const profile = PROFILES[source] || PROFILES.generic;
  const query = args.query || profile.query;
  const country = args.country || profile.country;
  const limit = Math.max(1, Number(args.limit || DEFAULT_LIMIT));
  const concurrency = Math.max(1, Number(args.concurrency || DEFAULT_CONCURRENCY));
  const url = args.url || null;

  if (!args.live) {
    return dryRun({ source, query, country, url });
  }

  env("BRIGHTDATA_API_KEY");
  env("BRIGHTDATA_UNLOCKER_ZONE");
  if (!url) env("BRIGHTDATA_SERP_ZONE");

  let candidates;

  if (url) {
    candidates = [{ title: null, description: null, url, query: null }];
  } else {
    console.log(`Consultando SERP: ${query}`);
    const searchResponse = await searchGoogle(query, country);
    candidates = discoverCandidates(searchResponse, profile, query).slice(0, limit);
  }

  console.log(`URLs selecionadas: ${candidates.length}`);

  const results = await mapWithConcurrency(
    candidates,
    concurrency,
    async (candidate) => {
      try {
        const markdown = await scrapeMarkdown(candidate.url, country);
        return {
          ok: true,
          record: normalizeRecord(candidate, markdown, source),
        };
      } catch (error) {
        return {
          ok: false,
          url: candidate.url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const output = {
    metadata: {
      source,
      query,
      country,
      captured_at: new Date().toISOString(),
      candidates_count: candidates.length,
      records_count: results.filter((item) => item.ok).length,
      errors_count: results.filter((item) => !item.ok).length,
    },
    candidates,
    records: results.filter((item) => item.ok).map((item) => item.record),
    errors: results.filter((item) => !item.ok),
  };

  const outputPath = args.output || "brightdata_demo_output.json";
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Resultado salvo em: ${outputPath}`);
  console.log(JSON.stringify(output.metadata, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
