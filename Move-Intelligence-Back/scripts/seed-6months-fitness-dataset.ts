import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ProductsService } from '../src/modules/products/products.service';
import { TrendEngineService } from '../src/modules/trend-engine/trend-engine.service';
import { OpportunityEngineService } from '../src/modules/opportunity-engine/opportunity-engine.service';
import { BusinessRulesService } from '../src/shared/business-rules/business-rules.service';
import { OpenRouterService } from '../src/modules/ai-gateway/openrouter.service';
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
    clusterKey: 'olympic_bumper_plates_50kg',
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
    clusterKey: 'stair_climber_commercial',
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
    clusterKey: 'foam_roller_textured',
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

  // 7. Expansão do catálogo para revisão visual do ranking
  {
    canonicalName: 'Barra Olímpica 2,20m com Rolamentos 20kg',
    category: 'musculacao_pesos_livres',
    clusterKey: 'olympic_barbell_20kg',
    growthProfile: 'mature',
    basePriceBrl: 899.0,
    basePriceUsd: 72.0,
    baseMonthlySales: 170,
    baseReviews: 460,
    baseRating: 4.8,
    keywords: {
      BR: ['barra olímpica 20kg', 'barra 2,20m rolamentada', 'barra levantamento de peso'],
      US: ['20kg olympic barbell', 'bearing weightlifting bar', '7ft olympic bar'],
    },
    suppliers: [{ name: 'Dingzhou Hengda Fitness Equipment', country: 'China', city: 'Dingzhou' }],
  },
  {
    canonicalName: 'Kit Halteres Sextavados Emborrachados 2 a 10kg',
    category: 'musculacao_pesos_livres',
    clusterKey: 'hex_dumbbell_set',
    growthProfile: 'explosive',
    basePriceBrl: 1390.0,
    basePriceUsd: 108.0,
    baseMonthlySales: 410,
    baseReviews: 330,
    baseRating: 4.7,
    keywords: {
      BR: ['kit halteres sextavados', 'halteres emborrachados academia', 'jogo halteres 2 a 10kg'],
      US: ['rubber hex dumbbell set', 'home gym dumbbell rack set', 'hex weights set'],
    },
    suppliers: [{ name: 'Rizhao Land Sea Fitness Goods Co.', country: 'China', city: 'Rizhao' }],
  },
  {
    canonicalName: 'Suporte Vertical para Anilhas e Barras Olímpicas',
    category: 'musculacao_pesos_livres',
    clusterKey: 'plate_bar_storage_rack',
    growthProfile: 'mature',
    basePriceBrl: 479.0,
    basePriceUsd: 36.0,
    baseMonthlySales: 95,
    baseReviews: 180,
    baseRating: 4.6,
    keywords: {
      BR: ['suporte para anilhas e barras', 'porta anilhas olímpicas', 'organizador de pesos academia'],
      US: ['weight plate storage rack', 'olympic bar holder', 'gym weight organizer'],
    },
    suppliers: [{ name: 'Qingdao All Universe Machinery', country: 'China', city: 'Qingdao' }],
  },
  {
    canonicalName: 'Smith Machine Multifuncional com Crossover',
    category: 'musculacao_pesos_livres',
    clusterKey: 'smith_machine_crossover',
    growthProfile: 'rising',
    basePriceBrl: 7990.0,
    basePriceUsd: 690.0,
    baseMonthlySales: 32,
    baseReviews: 74,
    baseRating: 4.9,
    keywords: {
      BR: ['smith machine com crossover', 'estação musculação multifuncional', 'máquina smith profissional'],
      US: ['smith machine with cable crossover', 'all in one trainer rack', 'commercial smith machine'],
    },
    suppliers: [{ name: 'Shandong Realleader Fitness Co.', country: 'China', city: 'Dezhou' }],
  },
  {
    canonicalName: 'Colete de Peso Ajustável 20kg para Treino',
    category: 'musculacao_pesos_livres',
    clusterKey: 'adjustable_weight_vest_20kg',
    growthProfile: 'mature',
    basePriceBrl: 329.0,
    basePriceUsd: 24.0,
    baseMonthlySales: 230,
    baseReviews: 510,
    baseRating: 4.5,
    keywords: {
      BR: ['colete de peso ajustável', 'colete carga 20kg', 'colete treino funcional'],
      US: ['adjustable weighted vest', '20kg training vest', 'weight vest workout'],
    },
    suppliers: [{ name: 'Nantong Newone Sports Products', country: 'China', city: 'Nantong' }],
  },
  {
    canonicalName: 'Elíptico Magnético Residencial com Monitor LCD',
    category: 'cardio_fitness',
    clusterKey: 'magnetic_elliptical_home',
    growthProfile: 'steady',
    basePriceBrl: 2190.0,
    basePriceUsd: 175.0,
    baseMonthlySales: 145,
    baseReviews: 390,
    baseRating: 4.6,
    keywords: {
      BR: ['elíptico magnético residencial', 'transport elíptico silencioso', 'elíptico com monitor lcd'],
      US: ['magnetic elliptical trainer', 'home elliptical machine', 'quiet cross trainer'],
    },
    suppliers: [{ name: 'Zhejiang Todo Hardware Manufacture', country: 'China', city: 'Jinhua' }],
  },
  {
    canonicalName: 'Mini Stepper Hidráulico com Faixas Elásticas',
    category: 'cardio_fitness',
    clusterKey: 'mini_stepper_resistance_bands',
    growthProfile: 'mature',
    basePriceBrl: 289.0,
    basePriceUsd: 21.0,
    baseMonthlySales: 620,
    baseReviews: 1380,
    baseRating: 4.4,
    keywords: {
      BR: ['mini stepper hidráulico', 'simulador de caminhada compacto', 'stepper com elásticos'],
      US: ['mini hydraulic stepper', 'step machine with resistance bands', 'compact stair stepper'],
    },
    suppliers: [{ name: 'Yongkang Baisuikang Science Technology', country: 'China', city: 'Yongkang' }],
  },
  {
    canonicalName: 'Air Bike Profissional com Resistência por Ventilador',
    category: 'cardio_fitness',
    clusterKey: 'professional_air_bike',
    growthProfile: 'explosive',
    basePriceBrl: 5490.0,
    basePriceUsd: 445.0,
    baseMonthlySales: 58,
    baseReviews: 96,
    baseRating: 4.9,
    keywords: {
      BR: ['air bike profissional', 'bicicleta crossfit ventilador', 'bike resistência a ar'],
      US: ['commercial air bike', 'fan resistance exercise bike', 'crossfit assault bike'],
    },
    suppliers: [{ name: 'Shandong DHZ Fitness Equipment', country: 'China', city: 'Dezhou' }],
  },
  {
    canonicalName: 'Pedalinho Ergométrico Portátil para Braços e Pernas',
    category: 'cardio_fitness',
    clusterKey: 'portable_pedal_exerciser',
    growthProfile: 'mature',
    basePriceBrl: 189.0,
    basePriceUsd: 13.0,
    baseMonthlySales: 760,
    baseReviews: 2050,
    baseRating: 4.5,
    keywords: {
      BR: ['pedalinho ergométrico portátil', 'mini bicicleta fisioterapia', 'exercitador braços e pernas'],
      US: ['portable pedal exerciser', 'under desk mini cycle', 'arm and leg pedal trainer'],
    },
    suppliers: [{ name: 'Xiamen Evere Sports Goods', country: 'China', city: 'Xiamen' }],
  },
  {
    canonicalName: 'Esteira Curva Mecânica Profissional sem Motor',
    category: 'cardio_fitness',
    clusterKey: 'curved_manual_treadmill',
    growthProfile: 'rising',
    basePriceBrl: 7490.0,
    basePriceUsd: 610.0,
    baseMonthlySales: 21,
    baseReviews: 52,
    baseRating: 4.8,
    keywords: {
      BR: ['esteira curva profissional', 'esteira mecânica sem motor', 'esteira curva crossfit'],
      US: ['curved manual treadmill', 'non motorized running machine', 'commercial curved treadmill'],
    },
    suppliers: [{ name: 'Shandong Tianzhan Fitness Equipment', country: 'China', city: 'Dezhou' }],
  },
  {
    canonicalName: 'Caixa Pliométrica de Madeira 3 em 1 Reforçada',
    category: 'treino_funcional_crossfit',
    clusterKey: 'wood_plyometric_box',
    growthProfile: 'explosive',
    basePriceBrl: 439.0,
    basePriceUsd: 31.0,
    baseMonthlySales: 350,
    baseReviews: 280,
    baseRating: 4.8,
    keywords: {
      BR: ['caixa pliométrica madeira', 'caixote crossfit 3 em 1', 'plyo box reforçado'],
      US: ['wooden plyometric box', '3 in 1 crossfit plyo box', 'jump training box'],
    },
    suppliers: [{ name: 'Nantong Bodyx Sporting Fitness', country: 'China', city: 'Nantong' }],
  },
  {
    canonicalName: 'Slam Ball sem Quicar 15kg para Crossfit',
    category: 'treino_funcional_crossfit',
    clusterKey: 'slam_ball_15kg',
    growthProfile: 'mature',
    basePriceBrl: 219.0,
    basePriceUsd: 15.0,
    baseMonthlySales: 275,
    baseReviews: 640,
    baseRating: 4.7,
    keywords: {
      BR: ['slam ball 15kg', 'bola de peso crossfit', 'bola funcional sem quique'],
      US: ['15kg slam ball', 'dead bounce medicine ball', 'weighted workout ball'],
    },
    suppliers: [{ name: 'Shanghai Iyogasports Industry', country: 'China', city: 'Shanghai' }],
  },
  {
    canonicalName: 'Trenó de Tração e Empurrão com Alças Removíveis',
    category: 'treino_funcional_crossfit',
    clusterKey: 'push_pull_weight_sled',
    growthProfile: 'rising',
    basePriceBrl: 1190.0,
    basePriceUsd: 92.0,
    baseMonthlySales: 66,
    baseReviews: 88,
    baseRating: 4.6,
    keywords: {
      BR: ['trenó de tração crossfit', 'sled push pull academia', 'trenó funcional com alças'],
      US: ['push pull weight sled', 'crossfit training sled', 'fitness prowler sled'],
    },
    suppliers: [{ name: 'Qingdao Modun Industry Trade', country: 'China', city: 'Qingdao' }],
  },
  {
    canonicalName: 'Battle Rope Corda Naval 12m com Proteção',
    category: 'treino_funcional_crossfit',
    clusterKey: 'battle_rope_12m',
    growthProfile: 'mature',
    basePriceBrl: 399.0,
    basePriceUsd: 29.0,
    baseMonthlySales: 190,
    baseReviews: 520,
    baseRating: 4.7,
    keywords: {
      BR: ['battle rope 12 metros', 'corda naval crossfit', 'corda funcional com proteção'],
      US: ['12m battle rope', 'heavy workout training rope', 'covered exercise rope'],
    },
    suppliers: [{ name: 'Jiangsu Gong Sports Goods', country: 'China', city: 'Taizhou' }],
  },
  {
    canonicalName: 'Sandbag Funcional Ajustável até 30kg',
    category: 'treino_funcional_crossfit',
    clusterKey: 'adjustable_training_sandbag',
    growthProfile: 'explosive',
    basePriceBrl: 269.0,
    basePriceUsd: 18.0,
    baseMonthlySales: 510,
    baseReviews: 310,
    baseRating: 4.6,
    keywords: {
      BR: ['sandbag funcional ajustável', 'saco de peso crossfit', 'bolsa de treino 30kg'],
      US: ['adjustable workout sandbag', '30kg fitness sand bag', 'crossfit training weight bag'],
    },
    suppliers: [{ name: 'Nantong Ok Sporting Goods', country: 'China', city: 'Nantong' }],
  },
  {
    canonicalName: 'Paralelas Portáteis Altas para Calistenia',
    category: 'calistenia_peso_corporal',
    clusterKey: 'portable_dip_bars',
    growthProfile: 'mature',
    basePriceBrl: 379.0,
    basePriceUsd: 27.0,
    baseMonthlySales: 245,
    baseReviews: 610,
    baseRating: 4.8,
    keywords: {
      BR: ['paralelas portáteis calistenia', 'barra paralela alta', 'dip bars treino corporal'],
      US: ['portable dip bars', 'high parallettes calisthenics', 'bodyweight dip station'],
    },
    suppliers: [{ name: 'Cangzhou Shengyu Sports Equipment', country: 'China', city: 'Cangzhou' }],
  },
  {
    canonicalName: 'Paralletes Baixas de Madeira para Equilíbrio',
    category: 'calistenia_peso_corporal',
    clusterKey: 'wooden_low_parallettes',
    growthProfile: 'steady',
    basePriceBrl: 159.0,
    basePriceUsd: 11.0,
    baseMonthlySales: 430,
    baseReviews: 840,
    baseRating: 4.9,
    keywords: {
      BR: ['paralletes madeira baixas', 'apoio calistenia equilíbrio', 'barra paralela de chão'],
      US: ['wooden low parallettes', 'calisthenics handstand bars', 'floor push up bars wood'],
    },
    suppliers: [{ name: 'Tianjin Grand Wood Fitness Products', country: 'China', city: 'Tianjin' }],
  },
  {
    canonicalName: 'Estação Torre Power Tower com Banco Dobrável',
    category: 'calistenia_peso_corporal',
    clusterKey: 'power_tower_foldable_bench',
    growthProfile: 'explosive',
    basePriceBrl: 1290.0,
    basePriceUsd: 98.0,
    baseMonthlySales: 205,
    baseReviews: 260,
    baseRating: 4.7,
    keywords: {
      BR: ['power tower com banco', 'torre de exercícios multifuncional', 'estação barra fixa paralela'],
      US: ['power tower with bench', 'multifunction pull up dip station', 'foldable workout tower'],
    },
    suppliers: [{ name: 'Zhejiang Arcanapower Sports Tech', country: 'China', city: 'Jinhua' }],
  },
  {
    canonicalName: 'Fita de Suspensão Ajustável para Treino Corporal',
    category: 'calistenia_peso_corporal',
    clusterKey: 'suspension_training_straps',
    growthProfile: 'mature',
    basePriceBrl: 149.0,
    basePriceUsd: 9.5,
    baseMonthlySales: 780,
    baseReviews: 1750,
    baseRating: 4.6,
    keywords: {
      BR: ['fita de suspensão funcional', 'kit treino suspenso', 'faixa suspensão peso corporal'],
      US: ['suspension training straps', 'bodyweight resistance trainer', 'home suspension workout kit'],
    },
    suppliers: [{ name: 'Yangzhou Chenhong Plastic Rubber', country: 'China', city: 'Yangzhou' }],
  },
  {
    canonicalName: 'Escada Horizontal Monkey Bar Modular de Parede',
    category: 'calistenia_peso_corporal',
    clusterKey: 'wall_monkey_bar_modular',
    growthProfile: 'rising',
    basePriceBrl: 1690.0,
    basePriceUsd: 132.0,
    baseMonthlySales: 44,
    baseReviews: 72,
    baseRating: 4.8,
    keywords: {
      BR: ['monkey bar de parede', 'escada horizontal calistenia', 'barra modular funcional'],
      US: ['wall mounted monkey bars', 'modular calisthenics ladder', 'indoor climbing monkey bar'],
    },
    suppliers: [{ name: 'Guangzhou Leqi Sports Equipment', country: 'China', city: 'Guangzhou' }],
  },
  {
    canonicalName: 'Pegboard de Escalada em Madeira com Pinos',
    category: 'calistenia_peso_corporal',
    clusterKey: 'wood_climbing_pegboard',
    growthProfile: 'mature',
    basePriceBrl: 349.0,
    basePriceUsd: 25.0,
    baseMonthlySales: 105,
    baseReviews: 210,
    baseRating: 4.7,
    keywords: {
      BR: ['pegboard escalada madeira', 'painel de pinos crossfit', 'treino peg board parede'],
      US: ['wood climbing pegboard', 'crossfit wall peg board', 'upper body pegboard trainer'],
    },
    suppliers: [{ name: 'Xuzhou Golden Eagle Wood Products', country: 'China', city: 'Xuzhou' }],
  },
  {
    canonicalName: 'Bloco de Yoga em Cortiça Natural Par',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'natural_cork_yoga_blocks',
    growthProfile: 'steady',
    basePriceBrl: 79.0,
    basePriceUsd: 4.6,
    baseMonthlySales: 980,
    baseReviews: 2250,
    baseRating: 4.9,
    keywords: {
      BR: ['bloco yoga cortiça par', 'tijolo yoga natural', 'bloco apoio alongamento'],
      US: ['natural cork yoga blocks', 'yoga brick pair', 'eco yoga support block'],
    },
    suppliers: [{ name: 'Dongguan Yihong Cork Products', country: 'China', city: 'Dongguan' }],
  },
  {
    canonicalName: 'Roda de Yoga para Alongamento e Flexibilidade',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'yoga_wheel_flexibility',
    growthProfile: 'mature',
    basePriceBrl: 119.0,
    basePriceUsd: 7.0,
    baseMonthlySales: 540,
    baseReviews: 1320,
    baseRating: 4.7,
    keywords: {
      BR: ['roda de yoga alongamento', 'yoga wheel flexibilidade', 'arco para coluna yoga'],
      US: ['yoga wheel for back', 'flexibility stretching wheel', 'pilates yoga back roller'],
    },
    suppliers: [{ name: 'Ningbo Mylon Rubber Plastic', country: 'China', city: 'Ningbo' }],
  },
  {
    canonicalName: 'Cadeira de Pilates Wunda Chair Compacta',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'compact_wunda_chair',
    growthProfile: 'explosive',
    basePriceBrl: 3490.0,
    basePriceUsd: 285.0,
    baseMonthlySales: 39,
    baseReviews: 48,
    baseRating: 4.9,
    keywords: {
      BR: ['wunda chair pilates', 'cadeira de pilates compacta', 'combo chair pilates estúdio'],
      US: ['pilates wunda chair', 'compact combo chair', 'studio pilates chair equipment'],
    },
    suppliers: [{ name: 'Guangzhou Leekon Fitness Equipment', country: 'China', city: 'Guangzhou' }],
  },
  {
    canonicalName: 'Kit Faixas de Alongamento com Alças Graduadas',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'graded_stretching_straps',
    growthProfile: 'steady',
    basePriceBrl: 59.9,
    basePriceUsd: 3.2,
    baseMonthlySales: 1450,
    baseReviews: 3100,
    baseRating: 4.6,
    keywords: {
      BR: ['faixa de alongamento com alças', 'fita mobilidade graduada', 'strap yoga fisioterapia'],
      US: ['stretching strap with loops', 'graded mobility strap', 'yoga physical therapy strap'],
    },
    suppliers: [{ name: 'Yiwu Fitlike Sporting Goods', country: 'China', city: 'Yiwu' }],
  },
  {
    canonicalName: 'Meia Lua de Pilates Spine Corrector',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'pilates_spine_corrector',
    growthProfile: 'mature',
    basePriceBrl: 849.0,
    basePriceUsd: 66.0,
    baseMonthlySales: 72,
    baseReviews: 130,
    baseRating: 4.8,
    keywords: {
      BR: ['spine corrector pilates', 'meia lua pilates', 'corretor de coluna estúdio'],
      US: ['pilates spine corrector', 'pilates arc barrel', 'studio back corrector'],
    },
    suppliers: [{ name: 'Rizhao Landsea Fitness Products', country: 'China', city: 'Rizhao' }],
  },
  {
    canonicalName: 'Almofada de Equilíbrio Inflável Propriocepção',
    category: 'pilates_yoga_mobilidade',
    clusterKey: 'inflatable_balance_cushion',
    growthProfile: 'rising',
    basePriceBrl: 99.0,
    basePriceUsd: 5.9,
    baseMonthlySales: 690,
    baseReviews: 890,
    baseRating: 4.5,
    keywords: {
      BR: ['almofada equilíbrio inflável', 'disco propriocepção', 'balance cushion fisioterapia'],
      US: ['inflatable balance cushion', 'proprioception wobble disc', 'physical therapy balance disc'],
    },
    suppliers: [{ name: 'Shanghai Qianjing Sports Goods', country: 'China', city: 'Shanghai' }],
  },
  {
    canonicalName: 'Bota de Compressão Pneumática para Recuperação Par',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'pneumatic_compression_boots',
    growthProfile: 'explosive',
    basePriceBrl: 3990.0,
    basePriceUsd: 325.0,
    baseMonthlySales: 88,
    baseReviews: 115,
    baseRating: 4.8,
    keywords: {
      BR: ['bota compressão pneumática', 'recovery boots esportiva', 'pressoterapia pernas atleta'],
      US: ['pneumatic compression boots', 'athlete recovery leg boots', 'air compression massager'],
    },
    suppliers: [{ name: 'Guangzhou Longest Science Technology', country: 'China', city: 'Guangzhou' }],
  },
  {
    canonicalName: 'Massageador Cervical Shiatsu com Aquecimento',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'heated_shiatsu_neck_massager',
    growthProfile: 'mature',
    basePriceBrl: 189.0,
    basePriceUsd: 12.0,
    baseMonthlySales: 1180,
    baseReviews: 4100,
    baseRating: 4.5,
    keywords: {
      BR: ['massageador cervical shiatsu', 'massageador pescoço aquecimento', 'almofada massagem cervical'],
      US: ['heated shiatsu neck massager', 'neck shoulder massage pillow', 'deep kneading massager'],
    },
    suppliers: [{ name: 'Shenzhen Relcare Electronics', country: 'China', city: 'Shenzhen' }],
  },
  {
    canonicalName: 'Bolsa Térmica Elétrica para Compressa Quente',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'electric_heating_therapy_pad',
    growthProfile: 'steady',
    basePriceBrl: 89.9,
    basePriceUsd: 5.2,
    baseMonthlySales: 1720,
    baseReviews: 5300,
    baseRating: 4.4,
    keywords: {
      BR: ['bolsa térmica elétrica', 'compressa quente fisioterapia', 'almofada aquecimento muscular'],
      US: ['electric heating therapy pad', 'hot compress pain relief', 'muscle heating pad'],
    },
    suppliers: [{ name: 'Dongguan Sunbright Electric Appliance', country: 'China', city: 'Dongguan' }],
  },
  {
    canonicalName: 'Banheira Dobrável para Imersão em Gelo Individual',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'foldable_ice_bath_tub',
    growthProfile: 'explosive',
    basePriceBrl: 499.0,
    basePriceUsd: 33.0,
    baseMonthlySales: 730,
    baseReviews: 680,
    baseRating: 4.7,
    keywords: {
      BR: ['banheira gelo dobrável', 'ice bath portátil atleta', 'tina imersão recuperação'],
      US: ['foldable ice bath tub', 'portable cold plunge', 'athlete recovery ice tub'],
    },
    suppliers: [{ name: 'Yiwu Weiyou Outdoor Products', country: 'China', city: 'Yiwu' }],
  },
  {
    canonicalName: 'Kit Ventosas de Silicone para Liberação Miofascial',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'silicone_cupping_therapy_set',
    growthProfile: 'mature',
    basePriceBrl: 69.9,
    basePriceUsd: 3.8,
    baseMonthlySales: 960,
    baseReviews: 1980,
    baseRating: 4.6,
    keywords: {
      BR: ['kit ventosas silicone', 'ventosaterapia miofascial', 'copos massagem muscular'],
      US: ['silicone cupping therapy set', 'myofascial massage cups', 'sports recovery cupping kit'],
    },
    suppliers: [{ name: 'Guangzhou Shengbo Medical Devices', country: 'China', city: 'Guangzhou' }],
  },
  {
    canonicalName: 'Aparelho TENS Portátil com Eletrodos Reutilizáveis',
    category: 'recuperacao_fisioterapia',
    clusterKey: 'portable_tens_unit',
    growthProfile: 'steady',
    basePriceBrl: 179.0,
    basePriceUsd: 14.0,
    baseMonthlySales: 640,
    baseReviews: 1220,
    baseRating: 4.5,
    keywords: {
      BR: ['aparelho tens portátil', 'eletroestimulador fisioterapia', 'tens com eletrodos'],
      US: ['portable tens unit', 'muscle stimulator therapy', 'reusable electrode tens machine'],
    },
    suppliers: [{ name: 'Shenzhen Kentro Medical Electronics', country: 'China', city: 'Shenzhen' }],
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
      // Produto maduro em desaceleração: começa conhecido e termina com demanda menor.
      // A queda intencional exercita o estágio "Emergente" sem inventar um novo perfil.
      demandTrend = 42 - progress * 24 + Math.cos(progress * 3) * 3; // ~45 -> 15
      salesMultiplier = 1.05 - progress * 0.6; // 105% -> 45%
      reviewMultiplier = 1 - progress * 0.35; // 100% -> 65%
      break;
    }
  }

  return {
    demandTrend: Math.max(5, Math.min(100, Math.round(demandTrend))),
    salesMultiplier,
    reviewMultiplier,
  };
}

type SeedStats = {
  totalProducts: number;
  totalSnapshots: number;
  totalDemandSignals: number;
  totalDemandLinks: number;
  totalShipments: number;
};

async function seedOneCluster(
  tx: Prisma.TransactionClient,
  clusterDef: ClusterDefinition,
  weeks: Date[],
  importJobId: string,
  stats: SeedStats,
) {
  let cluster = await tx.productCluster.findFirst({
    where: { canonicalName: clusterDef.canonicalName },
  });

  if (!cluster) {
    cluster = await tx.productCluster.create({
      data: {
        canonicalName: clusterDef.canonicalName,
        category: clusterDef.category,
        confidenceScore: new Prisma.Decimal(0.98),
        riskLevel:
          clusterDef.growthProfile === 'explosive'
            ? 'baixo'
            : clusterDef.growthProfile === 'rising'
              ? 'baixo'
              : 'medio',
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

  for (const mp of marketplaces) {
    const extId = `ext_${clusterDef.clusterKey}_${mp.code}`;
    await tx.productClusterItem.upsert({
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

  for (let weekIdx = 0; weekIdx < weeks.length; weekIdx++) {
    const weekDate = weeks[weekIdx];
    const trajectory = computeTrajectory(clusterDef.growthProfile, weekIdx, WEEKS_COUNT);

    for (const [geo, kwList] of Object.entries(clusterDef.keywords)) {
      for (const kw of kwList) {
        const kwNoise = Math.sin(weekIdx + kw.length) * 4;
        const finalIndex = Math.max(5, Math.min(100, Math.round(trajectory.demandTrend + kwNoise)));
        const signalId = randomUUID();

        await tx.intelligenceDemandSignal.upsert({
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
        stats.totalDemandSignals++;
      }
    }

    for (const mp of marketplaces) {
      const recordId = `prod_${clusterDef.clusterKey}_${mp.code}`;
      const isBrl = mp.currency === 'BRL';
      const isUsd = mp.currency === 'USD';
      const isCny = mp.currency === 'CNY';

      const priceBase = isBrl
        ? clusterDef.basePriceBrl
        : isUsd
          ? clusterDef.basePriceUsd
          : clusterDef.basePriceUsd * 7.1;
      const priceNoise = 1.0 + Math.sin(weekIdx * 0.8 + mp.code.length) * 0.04;
      const finalPrice = Math.round(priceBase * mp.priceMultiplier * priceNoise * 100) / 100;

      const reviews = Math.round(clusterDef.baseReviews * trajectory.reviewMultiplier);
      const sales = Math.round(clusterDef.baseMonthlySales * trajectory.salesMultiplier);
      const rating = Math.min(5.0, Math.round((clusterDef.baseRating + Math.sin(weekIdx) * 0.1) * 10) / 10);

      const prodUuid = randomUUID();
      const rawProduct = await tx.intelligenceProduct.upsert({
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
      stats.totalProducts++;

      const snapshotPayload = {
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
      };

      await tx.productListingSnapshot.upsert({
        where: {
          marketplace_externalProductId_collectedAt: {
            marketplace: snapshotPayload.marketplace,
            externalProductId: snapshotPayload.externalProductId,
            collectedAt: weekDate,
          },
        },
        create: snapshotPayload,
        update: {
          productClusterId: cluster.id,
          rawProductId: rawProduct.id,
          title: snapshotPayload.title,
          priceMin: snapshotPayload.priceMin,
          priceMax: snapshotPayload.priceMax,
          currency: snapshotPayload.currency,
          rating: snapshotPayload.rating,
          reviewCount: snapshotPayload.reviewCount,
          salesSignalRaw: snapshotPayload.salesSignalRaw,
          sellerName: snapshotPayload.sellerName,
          imageUrl: snapshotPayload.imageUrl,
          productUrl: snapshotPayload.productUrl,
        },
      });
      stats.totalSnapshots++;

      const signalGeo = mp.country === 'BR' ? 'BR' : 'US';
      const relevantSignals = await tx.intelligenceDemandSignal.findMany({
        where: {
          weekStart: weekDate,
          geo: signalGeo,
          keyword: { in: clusterDef.keywords[signalGeo] },
        },
        orderBy: { keyword: 'asc' },
        take: 2,
      });

      for (const sig of relevantSignals) {
        try {
          await tx.intelligenceProductDemandLink.upsert({
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
          stats.totalDemandLinks++;
        } catch {
          // ignore duplicate links
        }
      }
    }
  }

  for (const sup of clusterDef.suppliers) {
    for (let s = 0; s < 4; s++) {
      const shipDate = new Date(weeks[Math.floor(Math.random() * weeks.length)]);
      const fobTotal = Math.round(clusterDef.basePriceUsd * (150 + s * 100) * 100) / 100;
      const netKg = Math.round((150 + s * 100) * 12.5);

      const natKey = `ship_${clusterDef.clusterKey}_${sup.name.slice(0, 10)}_${s}_${shipDate.toISOString().split('T')[0]}`;
      await tx.shipment.upsert({
        where: { naturalKey: natKey },
        create: {
          naturalKey: natKey,
          importJobId,
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
      stats.totalShipments++;
    }
  }
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

  const stats = {
    totalProducts: 0,
    totalSnapshots: 0,
    totalDemandSignals: 0,
    totalDemandLinks: 0,
    totalShipments: 0,
  };

  const catalogSize = FIXED_FITNESS_CATALOG.length;
  for (let clusterIdx = 0; clusterIdx < catalogSize; clusterIdx++) {
    const clusterDef = FIXED_FITNESS_CATALOG[clusterIdx];
    console.log(
      `\n📦 [${clusterIdx + 1}/${catalogSize}] Processando Cluster: ${clusterDef.canonicalName} [${clusterDef.category}]`,
    );

    await prisma.$transaction(
      async (tx) => {
        await seedOneCluster(tx, clusterDef, weeks, importJob.id, stats);
      },
      { timeout: 120_000 },
    );
  }

  console.log('\n📊 Estatísticas de Inserção:');
  console.log(`- Produtos brutos persistidos: ${stats.totalProducts}`);
  console.log(`- Snapshots analíticos criados: ${stats.totalSnapshots}`);
  console.log(`- Sinais de demanda (Google Trends): ${stats.totalDemandSignals}`);
  console.log(`- Vínculos Produto-Demanda: ${stats.totalDemandLinks}`);
  console.log(`- Despachos aduaneiros (Shipments): ${stats.totalShipments}`);

  // 4. Executar Simulações Monte Carlo em Lote para calcular Scores e Risco
  console.log('\n🎲 Executando simulação estocástica Monte Carlo em lote para atualizar risco do ranking...');
  try {
    const prismaService = new PrismaService();
    await prismaService.$connect();
    const rulesService = new BusinessRulesService();
    const trendEngine = new TrendEngineService(rulesService);
    const opportunityEngine = new OpportunityEngineService(rulesService);
    const openRouterService = new OpenRouterService(prismaService);

    const productsService = new ProductsService(
      prismaService,
      trendEngine,
      opportunityEngine,
      openRouterService,
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
