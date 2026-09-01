#!/usr/bin/env node

const API_URL = process.env.MOVE_API_URL || 'http://localhost:3000/api';

async function authenticate() {
  if (process.env.MOVE_API_TOKEN) {
    return { accessToken: process.env.MOVE_API_TOKEN, refreshToken: null };
  }
  if (!process.env.MOVE_API_EMAIL || !process.env.MOVE_API_PASSWORD) {
    return { accessToken: null, refreshToken: null };
  }
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.MOVE_API_EMAIL,
      password: process.env.MOVE_API_PASSWORD,
    }),
  });
  if (!response.ok) throw new Error(`Falha ao autenticar coleta: HTTP ${response.status}`);
  const payload = await response.json();
  return { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
}

let auth = await authenticate();

function authorizedHeaders() {
  return {
    'content-type': 'application/json',
    ...(auth.accessToken ? { authorization: `Bearer ${auth.accessToken}` } : {}),
  };
}

async function authorizedFetch(url, options = {}) {
  let response = await fetch(url, { ...options, headers: { ...authorizedHeaders(), ...options.headers } });
  if (response.status !== 401 || !auth.refreshToken) return response;
  const refreshed = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  });
  if (!refreshed.ok) return response;
  const payload = await refreshed.json();
  auth = { accessToken: payload.accessToken, refreshToken: payload.refreshToken };
  response = await fetch(url, { ...options, headers: { ...authorizedHeaders(), ...options.headers } });
  return response;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--skip-demand') {
      result.skipDemand = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const [rawKey, inline] = token.slice(2).split('=', 2);
    const value = inline ?? argv[++index];
    result[rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
const body = {
  sources: String(
    options.sources ||
      'alibaba,amazon,amazon_br,mercado_livre,shopee_br,tiktok_shop,taobao,1688',
  ).split(','),
  limit: Number(options.limit || 10),
  geos: String(options.geos || 'BR,US').split(','),
  includeDemand: !options.skipDemand,
  keywordDepth: options.keywordDepth || 'all',
  windowDays: 7,
  ...(options.clusters ? { clusters: String(options.clusters).split(',') } : {}),
  ...(options.maxTerms ? { maxTerms: Number(options.maxTerms) } : {}),
};

let job;
if (options.jobId) {
  const response = await authorizedFetch(`${API_URL}/collections/jobs/${options.jobId}`);
  if (!response.ok) {
    throw new Error(`Falha ao consultar job ${options.jobId}: HTTP ${response.status}`);
  }
  job = await response.json();
  console.log(`Monitorando coleta semanal existente: ${job.id}`);
} else {
  const response = await authorizedFetch(`${API_URL}/collections/intelligence/weekly`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Falha ao iniciar coleta semanal: HTTP ${response.status} ${await response.text()}`);
  }
  job = await response.json();
  console.log(`Coleta semanal iniciada: ${job.id}`);
}
while (job.status === 'QUEUED' || job.status === 'RUNNING') {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const statusResponse = await authorizedFetch(`${API_URL}/collections/jobs/${job.id}`);
  if (!statusResponse.ok) {
    throw new Error(`Falha ao consultar job ${job.id}: HTTP ${statusResponse.status}`);
  }
  job = await statusResponse.json();
  const stats = job.stats || {};
  console.log(
    `[${job.status}] termos=${stats.terms_completed || 0}/${stats.terms_requested || '?'} produtos=${stats.unique_products || stats.products || 0}`,
  );
}

console.log(JSON.stringify(job, null, 2));
if (job.status === 'FAILED') process.exitCode = 1;
