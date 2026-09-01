import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ProductsService } from '../src/modules/products/products.service';
import { TrendEngineService } from '../src/modules/trend-engine/trend-engine.service';
import { OpportunityEngineService } from '../src/modules/opportunity-engine/opportunity-engine.service';
import { BusinessRulesService } from '../src/shared/business-rules/business-rules.service';
import { NvidiaService } from '../src/modules/ai-gateway/nvidia.service';
import { PrismaService } from '../src/shared/database/prisma.service';

const prisma = new PrismaClient();

interface ClusterDefinition {
  canonicalName: string;
  category: string;
  clusterKey: string;
  growthProfile: 'explosive' | 'rising' | 'steady' | 'mature';
  basePriceBrl: number;
  basePriceUsd: number;
  baseMonthlySales: number;
  baseReviews: number;
  baseRating: number;
  keywords: {
    BR: string[];
    US: string[];
  };
  suppliers: Array<{
    name: string;
    country: string;
    city: string;
  }>;
}

const FIXED_FITNESS_CATALOG: ClusterDefinition[] = [
  // 1. Musculação e Pesos Livres
  {
    canonicalName: 'Halteres Ajustáveis Selecionáveis 24kg Par',
    category: 'musculacao_pesos_livres',
    clusterKey: 'dumbbells',
    growthProfile: 'explosive',
    basePriceBrl: 1199.0,
    basePriceUsd: 85.0,
    baseMonthlySales: 320,
    baseReviews: 240,
    baseRating: 4.8,
    keywords: {
      BR: ['haltere ajustável', 'kit halteres reguláveis', 'halteres para casa'],
      US: ['adjustable dumbbells', 'home gym dumbbells', 'quick select dumbbell set'],
    },
    suppliers: [
      { name: 'Nantong Iron Bull Fitness Co., Ltd.', country: 'China', city: 'Nantong' },
      { name: 'Rizhao Kuangfu International Trade Co.', country: 'China', city: 'Rizhao' },
    ],
  },
  {
    canonicalName: 'Kettlebell de Ferro Fundido 16kg',
    category: 'musculacao_pesos_livres',
    clusterKey: 'kettlebells',
    growthProfile: 'steady',
    basePriceBrl: 219.0,
    basePriceUsd: 18.0,
    baseMonthlySales: 450,
    baseReviews: 580,
    baseRating: 4.9,
    keywords: {
      BR: ['kettlebell ferro fundido', 'peso kettlebell 16kg', 'kettlebell crossfit'],
      US: ['cast iron kettlebell', 'competition kettlebell', 'powder coat kettlebell'],
    },
    suppliers: [
      { name: 'Hebei Orient Fitness Equipment Co.', country: 'China', city: 'Shijiazhuang' },
      { name: 'Qingdao Impex Metal Products Ltd.', country: 'China', city: 'Qingdao' },
    ],
  },
  {
    canonicalName: 'Kit Anilhas Olímpicas Emborrachadas Bumper 50kg',
    category: 'musculacao_pesos_livres',
    clusterKey: 'dumbbells',
    growthProfile: 'steady',
    basePriceBrl: 849.0,
    basePriceUsd: 65.0,
    baseMonthlySales: 280,
    baseReviews: 410,
    baseRating: 4.7,
    keywords: {
      BR: ['anilha olímpica emborrachada', 'bumper plate olimpica', 'kit anilhas crossfit'],
      US: ['olympic bumper plates', 'rubber bumper plate set', 'competition weight plates'],
    },
    suppliers: [
      { name: 'Dingzhou Caron Sports Goods Co.', country: 'China', city: 'Dingzhou' },
    ],
  },
  {
    canonicalName: 'Banco de Musculação Inclinável e Declinável',
    category: 'musculacao_pesos_livres',
    clusterKey: 'weight_bench',
    growthProfile: 'rising',
    basePriceBrl: 589.0,
    basePriceUsd: 42.0,
    baseMonthlySales: 380,
    baseReviews: 620,
    baseRating: 4.6,
    keywords: {
      BR: ['banco de musculação inclinável', 'banco regulável academia', 'banco supino'],
      US: ['adjustable weight bench', 'incline decline workout bench', 'home gym bench'],
    },
    suppliers: [
      { name: 'Shandong Minolta Fitness Equipment', country: 'China', city: 'Dezhou' },
    ],
  },
  {
    canonicalName: 'Gaiola de Agachamento Power Rack Profissional',
    category: 'musculacao_pesos_livres',
    clusterKey: 'commercial_gym_equipment',
    growthProfile: 'rising',
    basePriceBrl: 2490.0,
    basePriceUsd: 210.0,
    baseMonthlySales: 85,
    baseReviews: 140,
    baseRating: 4.8,
    keywords: {
      BR: ['gaiola agachamento power rack', 'power rack crossfit', 'rack de agachamento'],
      US: ['power rack cage', 'squat rack with pull up bar', 'commercial power cage'],
    },
    suppliers: [
      { name: 'Shandong Baodelong Fitness Co., Ltd.', country: 'China', city: 'Dezhou' },
    ],
  },

  // 2. Cardio Fitness
  {
    canonicalName: 'Walking Pad Esteira Dobrável Ultracompacta',
    category: 'cardio_fitness',
    clusterKey: 'compact_cardio',
    growthProfile: 'explosive',
    basePriceBrl: 1890.0,
    basePriceUsd: 145.0,
    baseMonthlySales: 540,
    baseReviews: 380,
    baseRating: 4.7,
    keywords: {
      BR: ['walking pad esteira compacta', 'esteira dobrável home office', 'esteira slim silenciosa'],
      US: ['walking pad treadmill', 'under desk folding treadmill', 'compact portable treadmill'],
    },
    suppliers: [
      { name: 'Kingsmith Technology Co., Ltd.', country: 'China', city: 'Beijing' },
      { name: 'Zhejiang Ypoo Health Technology Co.', country: 'China', city: 'Jinhua' },
    ],
  },
  {
    canonicalName: 'Bicicleta Ergométrica Spinning Roda 18kg',
    category: 'cardio_fitness',
    clusterKey: 'spinning_bike',
    growthProfile: 'rising',
    basePriceBrl: 1450.0,
    basePriceUsd: 110.0,
    baseMonthlySales: 310,
    baseReviews: 750,
    baseRating: 4.6,
    keywords: {
      BR: ['bicicleta spinning profissional', 'bike indoor spinning 18kg', 'bicicleta ergométrica residencial'],
      US: ['spinning bike indoor', 'commercial spin cycle', 'magnetic resistance indoor bike'],
    },
    suppliers: [
      { name: 'Xiamen Lijiang Sports Equipment Co.', country: 'China', city: 'Xiamen' },
    ],
  },
  {
    canonicalName: 'Máquina de Remo Indoor Air Rower',
    category: 'cardio_fitness',
    clusterKey: 'rowing_machine',
    growthProfile: 'rising',
    basePriceBrl: 2890.0,
    basePriceUsd: 220.0,
    baseMonthlySales: 110,
    baseReviews: 190,
    baseRating: 4.8,
    keywords: {
      BR: ['máquina de remo indoor air rower', 'remo ergômetro crossfit', 'remo seco magnético'],
      US: ['air rowing machine', 'indoor rower workout', 'commercial air resistance rower'],
    },
    suppliers: [
      { name: 'Zhejiang Liansheng Sports Equipment', country: 'China', city: 'Yongkang' },
    ],
  },
  {
    canonicalName: 'Simulador de Escada Ergométrica Comercial',
    category: 'cardio_fitness',
    clusterKey: 'commercial_gym_equipment',
    growthProfile: 'explosive',
    basePriceBrl: 14900.0,
    basePriceUsd: 1150.0,
    baseMonthlySales: 28,
    baseReviews: 45,
    baseRating: 4.9,
    keywords: {
      BR: ['simulador de escada academia', 'stair climber comercial', 'escada ergométrica profissional'],
      US: ['stair climber machine', 'commercial stairmill stepper', 'cardio stair climber'],
    },
    suppliers: [
      { name: 'Shandong MBH Fitness Equipment Co.', country: 'China', city: 'Dezhou' },
    ],
  },

  // 3. Treino Funcional e Crossfit
  {
    canonicalName: 'Kit Super Bands Elásticos de Resistência 4 Peças',
    category: 'treino_funcional_crossfit',
    clusterKey: 'resistance_bands',
    growthProfile: 'rising',
    basePriceBrl: 129.0,
    basePriceUsd: 7.5,
    baseMonthlySales: 1200,
    baseReviews: 2100,
    baseRating: 4.8,
    keywords: {
      BR: ['kit super bands elastico', 'faixas elásticas crossfit', 'elásticos treino funcional'],
      US: ['pull up assistance bands', 'heavy duty resistance bands', 'latex workout loop bands'],
    },
    suppliers: [
      { name: 'Danyang Dantu Latex Products Co.', country: 'China', city: 'Zhenjiang' },
    ],
  },
  {
    canonicalName: 'Corda de Pular Speed Rope Rolamentada Crossfit',
    category: 'treino_funcional_crossfit',
    clusterKey: 'jump_rope',
    growthProfile: 'steady',
    basePriceBrl: 49.9,
    basePriceUsd: 2.8,
    baseMonthlySales: 1850,
    baseReviews: 3200,
    baseRating: 4.7,
    keywords: {
      BR: ['corda de pular speed rope', 'corda crossfit rolamento duplo', 'corda de pular cabo de aço'],
      US: ['speed jump rope', 'crossfit speed rope with bearings', 'adjustable wire jump rope'],
    },
    suppliers: [
      { name: 'Yiwu Huading Sporting Goods Co.', country: 'China', city: 'Yiwu' },
    ],
  },
  {
    canonicalName: 'Roda Abdominal Dupla com Retorno Automático',
    category: 'treino_funcional_crossfit',
    clusterKey: 'ab_wheel',
    growthProfile: 'rising',
    basePriceBrl: 99.0,
    basePriceUsd: 6.2,
    baseMonthlySales: 780,
    baseReviews: 1100,
    baseRating: 4.7,
    keywords: {
      BR: ['roda abdominal retorno automático', 'ab wheel com suporte cotovelo', 'rolo abdominal fitness'],
      US: ['automatic rebound ab roller', 'ab wheel with elbow support', 'abdominal core wheel'],
    },
    suppliers: [
      { name: 'Ningbo Topfit Outdoor Products Co.', country: 'China', city: 'Ningbo' },
    ],
  },
  {
    canonicalName: 'Push Up Board Prancha Multifuncional de Flexão',
    category: 'treino_funcional_crossfit',
    clusterKey: 'push_up_equipment',
    growthProfile: 'steady',
    basePriceBrl: 69.9,
    basePriceUsd: 4.1,
    baseMonthlySales: 920,
    baseReviews: 1450,
    baseRating: 4.6,
    keywords: {
      BR: ['push up board prancha flexao', 'suporte para flexão multifuncional', 'tábua de flexão 14 em 1'],
      US: ['push up board system', 'multi function push up rack', 'color coded push up trainer'],
    },
    suppliers: [
      { name: 'Yongkang Great Wall Industry Co.', country: 'China', city: 'Yongkang' },
    ],
  },

  // 4. Calistenia e Peso Corporal
  {
    canonicalName: 'Barra Fixa de Parede Reforçada Multifuncional',
    category: 'calistenia_peso_corporal',
    clusterKey: 'pull_up_equipment',
    growthProfile: 'steady',
    basePriceBrl: 249.0,
    basePriceUsd: 19.5,
    baseMonthlySales: 390,
    baseReviews: 780,
    baseRating: 4.8,
    keywords: {
      BR: ['barra fixa de parede calistenia', 'barra fixa e paralela 2 em 1', 'pull up bar parede'],
      US: ['wall mounted pull up bar', 'chin up station heavy duty', 'multigrip wall pull up bar'],
    },
    suppliers: [
      { name: 'Cangzhou Tianhe Sports Equipment', country: 'China', city: 'Cangzhou' },
    ],
  },
  {
    canonicalName: 'Argolas Olímpicas de Madeira Calistenia Crossfit',
    category: 'calistenia_peso_corporal',
    clusterKey: 'functional_training',
    growthProfile: 'steady',
    basePriceBrl: 159.0,
    basePriceUsd: 11.0,
    baseMonthlySales: 260,
    baseReviews: 420,
    baseRating: 4.9,
    keywords: {
      BR: ['argolas olimpicas de madeira', 'argolas ginastica calistenia', 'gym rings com fitas'],
      US: ['wooden gymnastic rings', 'olympic workout rings', 'gymnastic rings with numbered straps'],
    },
    suppliers: [
      { name: 'Tianjin King Glory Wood Products', country: 'China', city: 'Tianjin' },
    ],
  },

  // 5. Pilates, Yoga e Mobilidade
  {
    canonicalName: 'Tapete de Yoga Mat TPE Antiderrapante 6mm',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'yoga_mat',
    growthProfile: 'steady',
    basePriceBrl: 89.9,
    basePriceUsd: 5.5,
    baseMonthlySales: 1600,
    baseReviews: 2900,
    baseRating: 4.8,
    keywords: {
      BR: ['tapete de yoga mat tpe', 'colchonete yoga antiderrapante', 'tapete de exercicio 6mm'],
      US: ['eco friendly tpe yoga mat', 'non slip exercise workout mat', 'thick fitness yoga mat'],
    },
    suppliers: [
      { name: 'Nantong Wanyue Foam Products Co.', country: 'China', city: 'Nantong' },
    ],
  },
  {
    canonicalName: 'Reformer de Pilates Portátil com Molas e Prancha',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'yoga_pilates',
    growthProfile: 'explosive',
    basePriceBrl: 799.0,
    basePriceUsd: 58.0,
    baseMonthlySales: 210,
    baseReviews: 160,
    baseRating: 4.7,
    keywords: {
      BR: ['reformer pilates portátil', 'prancha de pilates dobrável', 'kit pilates reformer em casa'],
      US: ['portable pilates reformer board', 'foldable pilates reformer', 'home pilates machine with bands'],
    },
    suppliers: [
      { name: 'Suzhou Harmony Fitness Co., Ltd.', country: 'China', city: 'Suzhou' },
    ],
  },
  {
    canonicalName: 'Rolo de Liberação Miofascial Foam Roller Texturizado',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'recovery_massage',
    growthProfile: 'steady',
    basePriceBrl: 79.0,
    basePriceUsd: 4.8,
    baseMonthlySales: 850,
    baseReviews: 1600,
    baseRating: 4.7,
    keywords: {
      BR: ['rolo de liberação miofascial', 'foam roller texturizado', 'rolo massagem muscular eva'],
      US: ['deep tissue foam roller', 'high density muscle massage roller', 'trigger point roller'],
    },
    suppliers: [
      { name: 'Ningbo Brighten Daily Products Co.', country: 'China', city: 'Ningbo' },
    ],
  },

  // 6. Recuperação Muscular e Fisioterapia
  {
    canonicalName: 'Pistola Massageadora Muscular Percussiva 30 Velocidades',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'recovery_massage',
    growthProfile: 'explosive',
    basePriceBrl: 229.0,
    basePriceUsd: 16.5,
    baseMonthlySales: 950,
    baseReviews: 1800,
    baseRating: 4.8,
    keywords: {
      BR: ['pistola massageadora muscular percussiva', 'massage gun profunda', 'massageador muscular eletrico'],
      US: ['deep tissue percussion massage gun', 'muscle therapy massage gun', 'handheld body massager gun'],
    },
    suppliers: [
      { name: 'Shenzhen Booster Technology Co.', country: 'China', city: 'Shenzhen' },
      { name: 'Dongguan Meilijian Smart Tech Co.', country: 'China', city: 'Dongguan' },
    ],
  },
  {
    canonicalName: 'Plataforma Vibratória Oscilatória Fitness 200W',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'vibration_plate',
    growthProfile: 'rising',
    basePriceBrl: 649.0,
    basePriceUsd: 45.0,
    baseMonthlySales: 290,
    baseReviews: 510,
    baseRating: 4.6,
    keywords: {
      BR: ['plataforma vibratória fitness', 'plataforma oscilatoria emagrecimento', 'vibration plate treino'],
      US: ['whole body vibration plate', 'vibration exercise platform machine', 'body vibration trainer'],
    },
    suppliers: [
      { name: 'Zhejiang Juping Fitness Equipment', country: 'China', city: 'Yongkang' },
    ],
  },
];

const WEEKS_COUNT = 26; // 6 meses (26 semanas)
const END_DATE = new Date('2026-08-24T12:00:00.000Z');

function computeTrajectory(
  profile: ClusterDefinition['growthProfile'],
  weekIndex: number, // 0 a 25
  totalWeeks: number,
) {
  const progress = weekIndex / (totalWeeks - 1); // 0.0 a 1.0

  let demandTrend: number;
  let salesMultiplier: number;
  let reviewMultiplier: number;

  switch (profile) {
    case 'explosive': {
      // Começa modesto e acelera exponencialmente
      const curve = Math.pow(progress, 1.6);
      demandTrend = 28 + curve * 67; // 28 -> 95
      salesMultiplier = 0.35 + curve * 1.85; // 35% -> 220%
      reviewMultiplier = 0.2 + Math.pow(progress, 1.4) * 0.8;
      break;
    }
    case 'rising': {
      // Crescimento linear consistente
      demandTrend = 38 + progress * 46; // 38 -> 84
      salesMultiplier = 0.55 + progress * 0.95; // 55% -> 150%
      reviewMultiplier = 0.3 + progress * 0.7;
      break;
    }
    case 'steady': {
      // Estável com leve flutuação sazonal
      const season = Math.sin(progress * Math.PI * 2) * 6;
      demandTrend = 62 + season + progress * 10; // ~62-72
      salesMultiplier = 0.85 + (Math.sin(progress * 4) * 0.15) + progress * 0.3;
      reviewMultiplier = 0.5 + progress * 0.5;
      break;
    }
    case 'mature':
    default: {
      demandTrend = 55 + (Math.cos(progress * 3) * 5);
      salesMultiplier = 0.9 + Math.sin(progress * 2) * 0.1;
      reviewMultiplier = 0.6 + progress * 0.4;
      break;
    }
  }

  return {
    demandTrend: Math.max(5, Math.min(100, Math.round(demandTrend))),
    salesMultiplier,
    reviewMultiplier,
  };
}

async function main() {
  console.log('🚀 Iniciando geração do dataset robusto de 6 meses (Fitness Intelligence)...');

  // Criar ou obter Job de Importação para os Shipments
  let importJob = await prisma.importJob.findFirst({
    where: { originalName: 'TradeAtlas-Fitness-Historical-6M.csv' },
  });

  if (!importJob) {
    importJob = await prisma.importJob.create({
      data: {
        filename: 'tradeatlas_fitness_6m.csv',
        originalName: 'TradeAtlas-Fitness-Historical-6M.csv',
        mimeType: 'text/csv',
        sizeBytes: 1024 * 1024,
        sourceType: 'TRADE_ATLAS',
        detectedType: 'TRADE_ATLAS',
        status: 'DONE',
        rowsTotal: 100,
        rowsImported: 100,
        storagePath: 'imports/tradeatlas_fitness_6m.csv',
        startedAt: new Date('2026-02-23T00:00:00.000Z'),
        finishedAt: new Date('2026-08-24T00:00:00.000Z'),
      },
    });
  }

  // Gerar lista de datas das 26 semanas
  const weeks: Date[] = [];
  for (let i = WEEKS_COUNT - 1; i >= 0; i--) {
    const date = new Date(END_DATE);
    date.setDate(date.getDate() - i * 7);
    weeks.push(date);
  }

  console.log(`📅 Período coberto: de ${weeks[0].toISOString().split('T')[0]} a ${weeks[weeks.length - 1].toISOString().split('T')[0]} (${weeks.length} semanas)`);

  let totalProducts = 0;
  let totalSnapshots = 0;
  let totalDemandSignals = 0;
  let totalDemandLinks = 0;
  let totalShipments = 0;

  for (const clusterDef of FIXED_FITNESS_CATALOG) {
    console.log(`\n📦 Processando Cluster: ${clusterDef.canonicalName} [${clusterDef.category}]`);

    // 1. Criar ou Obter ProductCluster
    let cluster = await prisma.productCluster.findFirst({
      where: { canonicalName: clusterDef.canonicalName },
    });

    if (!cluster) {
      cluster = await prisma.productCluster.create({
        data: {
          canonicalName: clusterDef.canonicalName,
          category: clusterDef.category,
          confidenceScore: new Prisma.Decimal(0.98),
          riskLevel: clusterDef.growthProfile === 'explosive' ? 'baixo' : clusterDef.growthProfile === 'rising' ? 'baixo' : 'medio',
          financialScore: clusterDef.growthProfile === 'explosive' ? 88 : 75,
        },
      });
    }

    const marketplaces = [
      { code: 'mercadolivre', country: 'BR', currency: 'BRL', priceMultiplier: 1.0, seller: 'Move Sports Oficial' },
      { code: 'amazon_br', country: 'BR', currency: 'BRL', priceMultiplier: 1.05, seller: 'Amazon Brasil Retail' },
      { code: 'shopee_br', country: 'BR', currency: 'BRL', priceMultiplier: 0.95, seller: 'FitTech Distribuidora' },
      { code: 'alibaba', country: 'CN', currency: 'USD', priceMultiplier: 1.0, seller: clusterDef.suppliers[0]?.name ?? 'Global Gym Supplier' },
      { code: '1688', country: 'CN', currency: 'CNY', priceMultiplier: 7.2, seller: clusterDef.suppliers[0]?.name ?? 'China Fitness Manufacturer' },
      { code: 'amazon', country: 'US', currency: 'USD', priceMultiplier: 1.15, seller: 'Prime Fitness US' },
    ];

    // Vincular items ao cluster
    for (const mp of marketplaces) {
      const extId = `ext_${clusterDef.clusterKey}_${mp.code}`;
      await prisma.productClusterItem.upsert({
        where: {
          marketplace_externalProductId: {
            marketplace: mp.code,
            externalProductId: extId,
          },
        },
        create: {
          clusterId: cluster.id,
          marketplace: mp.code,
          externalProductId: extId,
          similarityScore: new Prisma.Decimal(0.95),
          matchedBy: 'canonical_catalog',
        },
        update: {
          clusterId: cluster.id,
        },
      });
    }

    // 2. Gerar histórico de 26 semanas para este cluster
    for (let weekIdx = 0; weekIdx < weeks.length; weekIdx++) {
      const weekDate = weeks[weekIdx];
      const trajectory = computeTrajectory(clusterDef.growthProfile, weekIdx, WEEKS_COUNT);

      // A. Demand Signals (Google Trends BR & US)
      for (const [geo, kwList] of Object.entries(clusterDef.keywords)) {
        for (const kw of kwList) {
          const kwNoise = (Math.sin(weekIdx + kw.length) * 4);
          const finalIndex = Math.max(5, Math.min(100, Math.round(trajectory.demandTrend + kwNoise)));
          const signalId = randomUUID();

          const demandSignal = await prisma.intelligenceDemandSignal.upsert({
            where: {
              keyword_geo_source_weekStart: {
                keyword: kw,
                geo,
                source: 'google_trends',
                weekStart: weekDate,
              },
            },
            create: {
              id: signalId,
              keyword: kw,
              geo,
              source: 'google_trends',
              weekStart: weekDate,
              trendIndex: new Prisma.Decimal(finalIndex),
              rawValue: new Prisma.Decimal(finalIndex * 125),
              capturedAt: weekDate,
            },
            update: {
              trendIndex: new Prisma.Decimal(finalIndex),
            },
          });
          totalDemandSignals++;
        }
      }

      // B. Products & Snapshots nos Marketplaces
      for (const mp of marketplaces) {
        const recordId = `prod_${clusterDef.clusterKey}_${mp.code}`;
        const isBrl = mp.currency === 'BRL';
        const isUsd = mp.currency === 'USD';
        const isCny = mp.currency === 'CNY';

        // Preço com leve ruído estocástico e desconto por ganho de escala
        const priceBase = isBrl ? clusterDef.basePriceBrl : isUsd ? clusterDef.basePriceUsd : (clusterDef.basePriceUsd * 7.1);
        const priceNoise = 1.0 + (Math.sin(weekIdx * 0.8 + mp.code.length) * 0.04);
        const finalPrice = Math.round(priceBase * mp.priceMultiplier * priceNoise * 100) / 100;

        const reviews = Math.round(clusterDef.baseReviews * trajectory.reviewMultiplier);
        const sales = Math.round(clusterDef.baseMonthlySales * trajectory.salesMultiplier);
        const rating = Math.min(5.0, Math.round((clusterDef.baseRating + (Math.sin(weekIdx) * 0.1)) * 10) / 10);

        const prodUuid = randomUUID();
        const rawProduct = await prisma.intelligenceProduct.upsert({
          where: {
            source_recordId_capturedAt: {
              source: mp.code,
              recordId,
              capturedAt: weekDate,
            },
          },
          create: {
            id: prodUuid,
            source: mp.code,
            recordId,
            capturedAt: weekDate,
            title: `${clusterDef.canonicalName} - ${mp.seller}`,
            canonicalTitle: clusterDef.canonicalName,
            brand: mp.seller,
            cluster: clusterDef.clusterKey,
            priceValue: new Prisma.Decimal(finalPrice),
            priceCurrency: mp.currency,
            rating: new Prisma.Decimal(rating),
            reviewsCount: reviews,
            monthlySales: sales,
            moq: isUsd || isCny ? 50 : 1,
            supplier: mp.seller,
            dataQuality: 'catalog_listing',
            sourceSpecific: {
              marketplace_origin: mp.country,
              weekly_index: weekIdx,
              seller: mp.seller,
              stock_status: 'in_stock',
            },
          },
          update: {
            priceValue: new Prisma.Decimal(finalPrice),
            reviewsCount: reviews,
            monthlySales: sales,
          },
        });
        totalProducts++;

        // Analytical Snapshot
        await prisma.productListingSnapshot.create({
          data: {
            marketplace: mp.code,
            externalProductId: `ext_${clusterDef.clusterKey}_${mp.code}`,
            productClusterId: cluster.id,
            rawProductId: rawProduct.id,
            title: `${clusterDef.canonicalName} (${mp.code.toUpperCase()})`,
            priceMin: new Prisma.Decimal(finalPrice),
            priceMax: new Prisma.Decimal(finalPrice * 1.08),
            currency: mp.currency,
            moq: isUsd || isCny ? 50 : 1,
            stock: 250,
            rating: new Prisma.Decimal(rating),
            reviewCount: reviews,
            salesSignalRaw: new Prisma.Decimal(sales),
            salesSignalType: 'units_monthly',
            sellerName: mp.seller,
            imageCount: 5,
            imageUrl: `https://images.move-intelligence.com/fitness/${clusterDef.clusterKey}.jpg`,
            productUrl: `https://${mp.code}.com/dp/${clusterDef.clusterKey}`,
            collectedAt: weekDate,
          },
        });
        totalSnapshots++;

        // Demand Links
        const relevantSignals = await prisma.intelligenceDemandSignal.findMany({
          where: {
            weekStart: weekDate,
            geo: mp.country === 'BR' ? 'BR' : 'US',
          },
          take: 2,
        });

        for (const sig of relevantSignals) {
          try {
            await prisma.intelligenceProductDemandLink.upsert({
              where: {
                productId_demandSignalId_keyword: {
                  productId: rawProduct.id,
                  demandSignalId: sig.id,
                  keyword: sig.keyword,
                },
              },
              create: {
                id: randomUUID(),
                productId: rawProduct.id,
                demandSignalId: sig.id,
                keyword: sig.keyword,
                matchMethod: 'cluster_map',
                createdAt: weekDate,
              },
              update: {},
            });
            totalDemandLinks++;
          } catch {
            // ignore duplicate links
          }
        }
      }
    }

    // 3. Despachos Aduaneiros Recentes (Shipments / TradeAtlas / Comex)
    for (const sup of clusterDef.suppliers) {
      for (let s = 0; s < 4; s++) {
        const shipDate = new Date(weeks[Math.floor(Math.random() * weeks.length)]);
        const fobTotal = Math.round(clusterDef.basePriceUsd * (150 + s * 100) * 100) / 100;
        const netKg = Math.round((150 + s * 100) * 12.5);

        const natKey = `ship_${clusterDef.clusterKey}_${sup.name.slice(0, 10)}_${s}_${shipDate.toISOString().split('T')[0]}`;
        await prisma.shipment.upsert({
          where: { naturalKey: natKey },
          create: {
            naturalKey: natKey,
            importJobId: importJob.id,
            arrivalDate: shipDate,
            importerName: 'MOVE EQUIPAMENTOS FITNESS DO BRASIL LTDA',
            importerCountry: 'Brazil',
            exporterName: sup.name,
            exporterCountry: sup.country,
            originCountry: sup.country,
            hsCode: '9506.91.00',
            productDetails: `${clusterDef.canonicalName} - Lote Comercial ${sup.city}`,
            fobUsd: new Prisma.Decimal(fobTotal),
            cifUsd: new Prisma.Decimal(fobTotal * 1.14),
            grossWeightKg: new Prisma.Decimal(netKg * 1.08),
            netWeightKg: new Prisma.Decimal(netKg),
            quantity: new Prisma.Decimal(150 + s * 100),
            quantityUnit: 'UN',
            portOfArrival: 'Porto de Santos (SP)',
            portOfDeparture: `Port of ${sup.city}`,
            declarationNumber: `DI-26/08-${Math.floor(100000 + Math.random() * 900000)}`,
          },
          update: {},
        });
        totalShipments++;
      }
    }
  }

  console.log('\n📊 Estatísticas de Inserção:');
  console.log(`- Produtos brutos persistidos: ${totalProducts}`);
  console.log(`- Snapshots analíticos criados: ${totalSnapshots}`);
  console.log(`- Sinais de demanda (Google Trends): ${totalDemandSignals}`);
  console.log(`- Vínculos Produto-Demanda: ${totalDemandLinks}`);
  console.log(`- Despachos aduaneiros (Shipments): ${totalShipments}`);

  // 4. Executar Simulações Monte Carlo em Lote para calcular Scores e Risco
  console.log('\n🎲 Executando simulação estocástica Monte Carlo em lote para atualizar risco do ranking...');
  try {
    const prismaService = new PrismaService();
    await prismaService.$connect();
    const rulesService = new BusinessRulesService();
    const trendEngine = new TrendEngineService(rulesService);
    const opportunityEngine = new OpportunityEngineService(rulesService);
    const nvidiaService = new NvidiaService(prismaService);

    const productsService = new ProductsService(
      prismaService,
      trendEngine,
      opportunityEngine,
      nvidiaService,
    );

    const batchSummary = await productsService.simulateBatchForRanking(50);
    console.log(`✅ Simulação Monte Carlo concluída: ${batchSummary.simulated} clusters calculados, ${batchSummary.failed} falhas.`);
  } catch (err) {
    console.warn(`⚠️ Aviso na simulação Monte Carlo batch: ${err}`);
  }

  console.log('\n✨ Dataset de 6 meses gerado e sincronizado com sucesso no Move Intelligence!');
}

main()
  .catch((e) => {
    console.error('❌ Erro na geração do dataset:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
