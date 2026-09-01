import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

export interface AlertRuleConfig {
  minTrendScore: number;
  minGrowthPct: number;
  webhookUrl?: string;
  webhookChannel: 'slack' | 'telegram' | 'generic';
  telegramChatId?: string;
  enabled: boolean;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(status?: string) {
    return this.prisma.alert.findMany({
      where: status ? { status: status as never } : undefined,
      include: {
        cluster: {
          select: {
            canonicalName: true,
            category: true,
            riskLevel: true,
            financialScore: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async acknowledge(id: string) {
    return this.prisma.alert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED' },
    });
  }

  async getRules(): Promise<AlertRuleConfig> {
    const config = await this.prisma.businessRuleConfig.findFirst({
      where: { key: 'opportunity_alerts_config' },
    });

    if (!config || typeof config.value !== 'object' || !config.value) {
      return {
        minTrendScore: 78,
        minGrowthPct: 40,
        webhookUrl: process.env.ALERTS_WEBHOOK_URL || '',
        webhookChannel: (process.env.ALERTS_WEBHOOK_CHANNEL as any) || 'slack',
        telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: true,
      };
    }

    return config.value as unknown as AlertRuleConfig;
  }

  async saveRules(rules: AlertRuleConfig) {
    const existing = await this.prisma.businessRuleConfig.findFirst({
      where: { key: 'opportunity_alerts_config' },
    });

    if (existing) {
      return this.prisma.businessRuleConfig.update({
        where: { id: existing.id },
        data: { value: rules as any, updatedAt: new Date() },
      });
    }

    return this.prisma.businessRuleConfig.create({
      data: {
        key: 'opportunity_alerts_config',
        value: rules as any,
      },
    });
  }

  async testWebhook(webhookUrl: string, channel: 'slack' | 'telegram' | 'generic', telegramChatId?: string) {
    const samplePayload = {
      product: 'Halteres Ajustáveis Selecionáveis 24kg Par',
      category: 'Musculação / Dumbbells',
      trendScore: 88,
      growthPct: 195,
      currentVolume: 850,
      timestamp: new Date().toISOString(),
    };

    return this.dispatchWebhook(webhookUrl, channel, {
      title: '🚀 Teste de Alerta de Oportunidade Move Intelligence',
      message: `O produto *${samplePayload.product}* atingiu Trend Score *${samplePayload.trendScore}/100* (+${samplePayload.growthPct}% de crescimento)!`,
      productName: samplePayload.product,
      category: samplePayload.category,
      trendScore: samplePayload.trendScore,
      growthPct: samplePayload.growthPct,
      telegramChatId,
    });
  }

  async scanOpportunitiesAndNotify() {
    const rules = await this.getRules();
    if (!rules.enabled) {
      return { status: 'disabled', alertsCreated: 0 };
    }

    const clusters = await this.prisma.productCluster.findMany({
      include: {
        snapshots: {
          orderBy: { collectedAt: 'asc' },
          take: 1000,
        },
      },
      take: 100,
    });

    let alertsCreated = 0;
    const dispatched = [];

    for (const cluster of clusters) {
      if (cluster.snapshots.length < 2) continue;

      const firstVol = Number(cluster.snapshots[0].salesSignalRaw) || 0;
      const lastVol = Number(cluster.snapshots.at(-1)?.salesSignalRaw) || 0;
      const growthPct = firstVol > 0 ? Math.round(((lastVol - firstVol) / firstVol) * 100) : 0;
      const avgPrice = Number(cluster.snapshots.at(-1)?.priceMin) || 0;

      // Se atender os critérios de alerta de oportunidade
      if (growthPct >= rules.minGrowthPct || (cluster.financialScore && cluster.financialScore >= rules.minTrendScore)) {
        // Verifica se já não existe alerta recente (últimas 48h)
        const recentAlert = await this.prisma.alert.findFirst({
          where: {
            productClusterId: cluster.id,
            createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
          },
        });

        if (!recentAlert) {
          const alert = await this.prisma.alert.create({
            data: {
              productClusterId: cluster.id,
              alertType: 'OPPORTUNITY_SPIKE',
              severity: 'HIGH',
              message: `Produto '${cluster.canonicalName}' rompeu marco de crescimento: +${growthPct}% (${lastVol} un/mês).`,
              evidence: {
                growthPct,
                currentVolume: lastVol,
                avgPrice,
                category: cluster.category,
              },
            },
          });
          alertsCreated++;

          if (rules.webhookUrl) {
            try {
              await this.dispatchWebhook(rules.webhookUrl, rules.webhookChannel, {
                title: '⚡ Nova Oportunidade de Mercado Detectada',
                message: `O produto *${cluster.canonicalName}* está em forte aceleração: +${growthPct}% no volume mensal!`,
                productName: cluster.canonicalName,
                category: cluster.category || 'Geral',
                growthPct,
                trendScore: cluster.financialScore || 80,
                telegramChatId: rules.telegramChatId,
              });
              dispatched.push(cluster.canonicalName);
            } catch (err) {
              this.logger.error(`Falha ao disparar webhook para ${cluster.canonicalName}: ${err}`);
            }
          }
        }
      }
    }

    return {
      status: 'completed',
      alertsCreated,
      dispatchedCount: dispatched.length,
      dispatchedProducts: dispatched,
    };
  }

  private async dispatchWebhook(
    url: string,
    channel: 'slack' | 'telegram' | 'generic',
    data: {
      title: string;
      message: string;
      productName: string;
      category: string;
      growthPct: number;
      trendScore: number;
      telegramChatId?: string;
    },
  ) {
    let body: any;

    if (channel === 'slack') {
      body = {
        text: `${data.title}: ${data.productName}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: data.title, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Produto:*\n${data.productName}` },
              { type: 'mrkdwn', text: `*Categoria:*\n${data.category}` },
              { type: 'mrkdwn', text: `*Crescimento:*\n+${data.growthPct}%` },
              { type: 'mrkdwn', text: `*Score:*\n${data.trendScore}/100` },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Move Intelligence Platform • ${new Date().toLocaleString('pt-BR')}`,
              },
            ],
          },
        ],
      };
    } else if (channel === 'telegram') {
      const text = `*${data.title}*\n\n` +
        `📦 *Produto:* ${data.productName}\n` +
        `🏷️ *Categoria:* ${data.category}\n` +
        `📈 *Crescimento:* +${data.growthPct}%\n` +
        `⭐ *Score:* ${data.trendScore}/100\n\n` +
        `_Move Intelligence Platform_`;

      body = {
        chat_id: data.telegramChatId,
        text,
        parse_mode: 'Markdown',
      };
    } else {
      body = {
        event: 'OPPORTUNITY_ALERT',
        ...data,
        timestamp: new Date().toISOString(),
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Webhook respondeu status HTTP ${res.status}: ${txt}`);
    }

    return { success: true, status: res.status };
  }
}
