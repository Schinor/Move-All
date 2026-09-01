// Servidor de fixtures SÓ PARA DEV / verificação visual.
// NÃO faz parte do app. Serve JSON no formato do contrato (snake_case) para
// que o frontend renderize populado sem backend real. Nenhum dado mock vive
// dentro dos componentes Angular — apenas aqui.
import { createServer } from 'node:http';

const PORT = 8787;

function ind(value, explanation, inputs, window = '30d') {
  return { value, explanation, inputs, window };
}

const products = [
  {
    id: 'faixas-inteligentes',
    name: 'Faixas de Resistência Inteligentes',
    category: 'Recovery',
    stage: 'rising',
    risk: 'baixo',
    growth: 38.4,
    margin: 62,
    lead_time: 24,
    revenue: 1240000,
    score: 87,
    spark: [12, 14, 13, 18, 22, 25, 31, 38],
    img: null,
  },
  {
    id: 'colete-de-peso',
    name: 'Colete de Peso Ajustável',
    category: 'Força',
    stage: 'rising',
    risk: 'medio',
    growth: 41.2,
    margin: 55,
    lead_time: 32,
    revenue: 980000,
    score: 82,
    spark: [8, 9, 12, 15, 19, 24, 30, 41],
    img: null,
  },
  {
    id: 'cold-plunge',
    name: 'Cold Plunge Portátil',
    category: 'Recovery',
    stage: 'emerging',
    risk: 'medio',
    growth: 89.3,
    margin: 48,
    lead_time: 40,
    revenue: 1520000,
    score: 91,
    spark: [3, 5, 8, 14, 22, 38, 60, 89],
    img: null,
  },
  {
    id: 'smart-rope',
    name: 'Pular Corda Smart',
    category: 'Cardio',
    stage: 'rising',
    risk: 'baixo',
    growth: 18.6,
    margin: 58,
    lead_time: 21,
    revenue: 640000,
    score: 74,
    spark: [10, 11, 12, 13, 14, 16, 17, 18],
    img: null,
  },
  {
    id: 'espelho-ia',
    name: 'Espelho de Treino com IA',
    category: 'Smart Home Gym',
    stage: 'emerging',
    risk: 'alto',
    growth: 64.8,
    margin: 44,
    lead_time: 55,
    revenue: 2100000,
    score: 85,
    spark: [5, 8, 12, 20, 28, 40, 52, 65],
    img: null,
  },
  {
    id: 'foam-roller-v',
    name: 'Foam Roller Vibratório',
    category: 'Recovery',
    stage: 'peaking',
    risk: 'baixo',
    growth: 12.4,
    margin: 66,
    lead_time: 18,
    revenue: 430000,
    score: 69,
    spark: [40, 42, 45, 48, 50, 51, 52, 52],
    img: null,
  },
];

function toTrendProduct(p) {
  return {
    product_cluster_id: p.id,
    canonical_name: p.name,
    category: p.category,
    image_url: p.img,
    trend_score: ind(
      p.score,
      `Score composto por crescimento de marketplace, fornecedores e buzz social na categoria ${p.category}.`,
      { marketplace_growth: 0.28, supplier_growth: 0.19, social_buzz: 0.22 },
    ),
    opportunity_score: ind(
      Math.round(p.score * 0.9),
      'Tendência × margem × (1 − saturação ocidental).',
      { trend: p.score / 100, margin: p.margin / 100, saturation: 0.2 },
    ),
    western_saturation_score: ind(0.2, 'Presença ainda incipiente no Ocidente — janela aberta.', {
      lojas: 0.15,
      best_sellers: 0.05,
    }),
    margin_estimate: ind(p.margin, 'Margem estimada sobre o landed cost.', { fob: 0.4, frete: 0.1 }),
    risk: p.risk,
    main_sources: ['1688', 'AliExpress', 'Douyin'],
    recommendation: 'Janela aberta. Monitorar de perto e validar fornecedores auditados.',
    stage: p.stage,
    spark: p.spark,
    growth_pct: p.growth,
    margin_pct: p.margin,
    lead_time_days: p.lead_time,
    projected_revenue: p.revenue,
  };
}

const summary = {
  kpis: [
    { label: 'Oportunidades Ativas', value: '47', delta: 12.5, spark: [30, 33, 35, 38, 40, 43, 45, 47] },
    { label: 'Sinais / 24h', value: '1.842', delta: 32.6, spark: [900, 1100, 1250, 1400, 1550, 1700, 1800, 1842] },
    { label: 'Trend Score Médio', value: '78', delta: 4.2, spark: [70, 71, 72, 74, 75, 76, 77, 78] },
    { label: 'Margem Média', value: '56%', delta: -1.8, spark: [60, 59, 58, 58, 57, 57, 56, 56] },
  ],
  tickers: [
    { name: 'Faixas Inteligentes', value: '+38.4%', up: true },
    { name: 'Colete de Peso', value: '+41.2%', up: true },
    { name: 'Cold Plunge', value: '+89.3%', up: true },
    { name: 'EMS Suit', value: '−8.2%', up: false },
    { name: 'Smart Rope', value: '+18.6%', up: true },
    { name: 'Espelho IA', value: '+64.8%', up: true },
    { name: 'Foam Roller V.', value: '+12.4%', up: true },
    { name: 'Percussion', value: '+22.1%', up: true },
  ],
};

const alerts = [
  { id: 'a1', product_cluster_id: 'cold-plunge', alert_type: 'review_spike', severity: 'medio', message: 'Cold Plunge: +50% em reviews no AliExpress em 7 dias', created_at: new Date().toISOString(), status: 'open' },
  { id: 'a2', product_cluster_id: 'espelho-ia', alert_type: 'saturation', severity: 'alto', message: 'Espelho de Treino IA entrou em Best Sellers na Amazon (janela fechando)', created_at: new Date().toISOString(), status: 'open' },
];

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = (req.url || '').split('?')[0];
  if (url === '/api/dashboard/summary') return send(res, 200, summary);
  if (url === '/api/trends/products') return send(res, 200, products.map(toTrendProduct));
  if (url === '/api/alerts') return send(res, 200, alerts);
  if (url === '/api/sources/status') {
    return send(res, 200, [
      { source: 'AliExpress', online: true, last_collected_at: new Date().toISOString() },
      { source: '1688', online: true, last_collected_at: new Date().toISOString() },
    ]);
  }
  const m = url.match(/^\/api\/trends\/products\/(.+)$/);
  if (m) {
    const p = products.find((x) => x.id === m[1]);
    if (!p) return send(res, 404, { message: 'not found' });
    return send(res, 200, { ...toTrendProduct(p), image_urls: [], signals: {
      supplier_growth_30d: ind(0.35, 'Novos fornecedores na 1688 em 30 dias.', { novos: 12 }),
      review_growth_30d: ind(0.4, 'Crescimento de reviews no AliExpress.', { reviews: 320 }),
    } });
  }
  const ph = url.match(/^\/api\/products\/(.+)\/(price|review)-history$/);
  if (ph) {
    const pts = Array.from({ length: 12 }, (_, i) => ({ t: `2026-0${(i % 9) + 1}-01`, v: 50 + i * 3 }));
    return send(res, 200, { window: '30d', points: pts });
  }
  if (/^\/api\/products\/(.+)\/suppliers$/.test(url)) {
    return send(res, 200, [
      { id: 's1', name: 'Shenzhen FitTech Co.', country: 'China', country_code: 'CN', city: 'Shenzhen', category: 'Smart Fitness', score: ind(94, 'Score do fornecedor.', { auditado: 1, recompra: 0.4 }), moq: 500, fob: 38.2, lead_time: 28, shipping: 14, quality: 92, margin: ind(58, null, null), risk: 'baixo', certifications: ['CE', 'RoHS'] },
    ]);
  }
  // Blocos de telas-lacuna: retornam pending
  if (['/api/signals', '/api/markets', '/api/recommendations'].includes(url)) {
    return send(res, 200, { status: 'pending', items: [] });
  }
  if (url === '/api/pipeline') return send(res, 200, { status: 'pending', columns: [] });
  if (url === '/api/signals/sources') return send(res, 200, []);
  return send(res, 404, { message: 'not found' });
}).listen(PORT, () => console.log(`[fixtures] http://localhost:${PORT}`));
