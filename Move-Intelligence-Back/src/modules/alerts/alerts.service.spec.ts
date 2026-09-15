import { PrismaService } from '../../shared/database/prisma.service';
import { AlertsService } from './alerts.service';

function buildService(prismaOverrides: Record<string, any> = {}): {
  service: AlertsService;
  prisma: any;
} {
  const prisma = {
    businessRuleConfig: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    productCluster: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    productScore: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    alert: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    ...prismaOverrides,
  };
  const service = new AlertsService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('AlertsService — segurança de webhook (SSRF)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('saveRules recusa webhook http (não-https) e não persiste a regra', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.saveRules({
        minTrendScore: 70,
        minGrowthPct: 40,
        webhookUrl: 'http://hooks.slack.com/services/T000/B000/xxx',
        webhookChannel: 'slack',
        enabled: true,
      }),
    ).rejects.toThrow(/https/i);

    expect(prisma.businessRuleConfig.create).not.toHaveBeenCalled();
    expect(prisma.businessRuleConfig.update).not.toHaveBeenCalled();
  });

  it('saveRules recusa webhook genérico apontando para IP privado (SSRF)', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.saveRules({
        minTrendScore: 70,
        minGrowthPct: 40,
        webhookUrl: 'https://169.254.169.254/latest/meta-data',
        webhookChannel: 'generic',
        enabled: true,
      }),
    ).rejects.toThrow();

    expect(prisma.businessRuleConfig.create).not.toHaveBeenCalled();
  });

  it('saveRules aceita e persiste um webhook Slack oficial em https', async () => {
    const { service, prisma } = buildService();

    await service.saveRules({
      minTrendScore: 70,
      minGrowthPct: 40,
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/xxx',
      webhookChannel: 'slack',
      enabled: true,
    });

    expect(prisma.businessRuleConfig.create).toHaveBeenCalledTimes(1);
  });

  it('testWebhook recusa host que não seja hooks.slack.com e nunca chama fetch', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as any;
    const { service } = buildService();

    await expect(
      service.testWebhook('https://attacker.example.com/steal', 'slack'),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('testWebhook chama fetch quando a URL é segura', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchSpy as any;
    const { service } = buildService();

    const result = await service.testWebhook(
      'https://hooks.slack.com/services/T000/B000/xxx',
      'slack',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, status: 200 });
  });
});

describe('AlertsService — scan dispara por faixa ou variação do Move Score (F2.7)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function clusterSnapshots() {
    return [
      { salesSignalRaw: 100, priceMin: 50, collectedAt: new Date('2026-01-01') },
      { salesSignalRaw: 101, priceMin: 50, collectedAt: new Date('2026-02-01') },
    ];
  }

  it('dispara quando a decisão muda de faixa, mesmo sem crescimento', async () => {
    const cluster = {
      id: 'cluster-1',
      canonicalName: 'Produto X',
      category: 'geral',
      financialScore: null,
      snapshots: clusterSnapshots(),
    };
    const { service, prisma } = buildService({
      businessRuleConfig: {
        findFirst: jest.fn().mockResolvedValue({
          value: { minGrowthPct: 1_000_000, minMoveScoreDelta: 10, enabled: true },
        }),
      },
      productCluster: { findMany: jest.fn().mockResolvedValue([cluster]) },
      productScore: {
        findMany: jest.fn().mockResolvedValue([
          { productClusterId: 'cluster-1', score: 88, decision: 'AVANCAR' },
          { productClusterId: 'cluster-1', score: 60, decision: 'REPROVAR' },
        ]),
      },
    });

    const result = await service.scanOpportunitiesAndNotify();

    expect(result.alertsCreated).toBe(1);
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alertType: 'MOVE_SCORE_SHIFT' }),
      }),
    );
  });

  it('dispara quando a variação atinge N pontos sem mudar de faixa', async () => {
    const cluster = {
      id: 'cluster-2',
      canonicalName: 'Produto Y',
      category: 'geral',
      financialScore: null,
      snapshots: clusterSnapshots(),
    };
    const { service, prisma } = buildService({
      businessRuleConfig: {
        findFirst: jest.fn().mockResolvedValue({
          value: { minGrowthPct: 1_000_000, minMoveScoreDelta: 10, enabled: true },
        }),
      },
      productCluster: { findMany: jest.fn().mockResolvedValue([cluster]) },
      productScore: {
        findMany: jest.fn().mockResolvedValue([
          { productClusterId: 'cluster-2', score: 80, decision: 'AVANCAR COM RESSALVAS' },
          { productClusterId: 'cluster-2', score: 70, decision: 'AVANCAR COM RESSALVAS' },
        ]),
      },
    });

    const result = await service.scanOpportunitiesAndNotify();

    expect(result.alertsCreated).toBe(1);
  });

  it('não dispara sem score novo e com crescimento abaixo do corte', async () => {
    const cluster = {
      id: 'cluster-3',
      canonicalName: 'Produto Z',
      category: 'geral',
      financialScore: null,
      snapshots: clusterSnapshots(),
    };
    const { service, prisma } = buildService({
      businessRuleConfig: {
        findFirst: jest.fn().mockResolvedValue({
          value: { minGrowthPct: 40, minMoveScoreDelta: 10, enabled: true },
        }),
      },
      productCluster: { findMany: jest.fn().mockResolvedValue([cluster]) },
      productScore: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.scanOpportunitiesAndNotify();

    expect(result.alertsCreated).toBe(0);
    expect(prisma.alert.create).not.toHaveBeenCalled();
  });

  it('C8: dispara quando a ação muda (ex.: entra em DECIDIR_AGORA)', async () => {
    const cluster = {
      id: 'cluster-4',
      canonicalName: 'Produto W',
      category: 'geral',
      financialScore: null,
      snapshots: clusterSnapshots(),
    };
    const { service, prisma } = buildService({
      businessRuleConfig: {
        findFirst: jest.fn().mockResolvedValue({
          value: { minGrowthPct: 1_000_000, minMoveScoreDelta: 1_000, enabled: true },
        }),
      },
      productCluster: { findMany: jest.fn().mockResolvedValue([cluster]) },
      productScore: {
        findMany: jest.fn().mockResolvedValue([
          { productClusterId: 'cluster-4', score: 82, decision: 'AVANCAR', action: 'DECIDIR_AGORA' },
          { productClusterId: 'cluster-4', score: 78, decision: 'AVANCAR', action: 'TESTAR_DEMANDA' },
        ]),
      },
    });

    const result = await service.scanOpportunitiesAndNotify();

    expect(result.alertsCreated).toBe(1);
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ alertType: 'MOVE_SCORE_SHIFT' }),
      }),
    );
  });
});
