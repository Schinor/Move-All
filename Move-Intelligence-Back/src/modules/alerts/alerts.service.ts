import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { syntheticSnapshotWhere } from '../../shared/synthetic-data/synthetic-data.filter';
import { assertSafeWebhookUrl, UnsafeWebhookUrlError, WebhookChannel } from './webhook-safety';

export interface AlertRuleConfig {
  minTrendScore: number;
  minGrowthPct: number;
  /** Variação mínima do Move Score (pontos) para disparar (F2.7). */
  minMoveScoreDelta?: number;
  webhookUrl?: string;
  webhookChannel: WebhookChannel;
  telegramChatId?: string;
  enabled: boolean;
}

/** Queda/aumento que dispara alerta quando não configurado (F2.7). */
const DEFAULT_MOVE_SCORE_DELTA = 10;

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
        minMoveScoreDelta: DEFAULT_MOVE_SCORE_DELTA,
        webhookUrl: process.env.ALERTS_WEBHOOK_URL || '',
        webhookChannel: (process.env.ALERTS_WEBHOOK_CHANNEL as any) || 'slack',
        telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
        enabled: true,
      };
    }

    const stored = config.value as unknown as AlertRuleConfig;
    return { minMoveScoreDelta: DEFAULT_MOVE_SCORE_DELTA, ...stored };
  }

  async saveRules(rules: AlertRuleConfig) {
    // Previne SSRF: uma regra salva com webhook malicioso seria disparada
    // depois, sem intervenção do usuário, a cada scan de oportunidades.
    if (rules.webhookUrl) {
      await assertSafeWebhookUrl(rules.webhookUrl, rules.webhookChannel);
    }

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

  async testWebhook(webhookUrl: string, channel: WebhookChannel, telegramChatId?: string) {
    const samplePayload = {
      product: 'Halteres Ajustáveis Selecionáveis 24kg Par',
      category: 'Musculação / Dumbbells',
      moveScore: 88,
      decision: 'AVANCAR',
      growthPct: 195,
      currentVolume: 850,
      timestamp: new Date().toISOString(),
    };

    return this.dispatchWebhook(webhookUrl, channel, {
      title: '🚀 Teste de Alerta de Oportunidade Move Intelligence',
      message: `O produto *${samplePayload.product}* atingiu Move Score *${samplePayload.moveScore}/100* (decisão ${samplePayload.decision}, +${samplePayload.growthPct}% de crescimento)!`,
      productName: samplePayload.product,
      category: samplePayload.category,
      moveScore: samplePayload.moveScore,
      decision: samplePayload.decision,
      growthPct: samplePayload.growthPct,
      telegramChatId,
    });
  }

  async scanOpportunitiesAndNotify() {
    const rules = await this.getRules();
    if (!rules.enabled) {
      return { status: 'disabled', alertsCreated: 0 };
    }

    // Com INCLUDE_SYNTHETIC_DATA=false (default), não dispara alerta de
    // oportunidade a partir de crescimento/score calculado sobre dados
    // sintéticos do historical-collection.
    const clusters = await this.prisma.productCluster.findMany({
      include: {
        snapshots: {
          where: syntheticSnapshotWhere(),
          orderBy: { collectedAt: 'asc' },
          take: 1000,
        },
      },
      take: 100,
    });
    // Move Score vigente + anterior por cluster (B3/C8): dispara quando a AÇÃO
    // muda (ex.: entra em DECIDIR_AGORA) ou variação ≥ N pontos. Decision fica
    // como fallback até a limpeza futura.
    const scoreRows = await this.prisma.productScore.findMany({
      where: { productClusterId: { in: clusters.map((cluster) => cluster.id) } },
      orderBy: { computedAt: 'desc' },
    });
    const scoresByCluster = new Map<
      string,
      { score: number | null; decision: string; action: string | null }[]
    >();
    for (const row of scoreRows) {
      const list = scoresByCluster.get(row.productClusterId) ?? [];
      if (list.length < 2) {
        const action = (row as unknown as Record<string, unknown>).action;
        list.push({
          score: row.score,
          decision: row.decision,
          action: typeof action === 'string' ? action : null,
        });
        scoresByCluster.set(row.productClusterId, list);
      }
    }

    let alertsCreated = 0;
    const dispatched = [];
    const minDelta = rules.minMoveScoreDelta ?? DEFAULT_MOVE_SCORE_DELTA;

    for (const cluster of clusters) {
      if (cluster.snapshots.length < 2) continue;

      const firstVol = Number(cluster.snapshots[0].salesSignalRaw) || 0;
      const lastVol = Number(cluster.snapshots.at(-1)?.salesSignalRaw) || 0;
      const growthPct = firstVol > 0 ? Math.round(((lastVol - firstVol) / firstVol) * 100) : 0;
      const avgPrice = Number(cluster.snapshots.at(-1)?.priceMin) || 0;
      const [current, previous] = scoresByCluster.get(cluster.id) ?? [];
      const moveScore = current?.score ?? null;
      const actionChanged =
        current !== undefined &&
        previous !== undefined &&
        (current.action ?? current.decision) !== (previous.action ?? previous.decision);
      const bandChanged =
        current !== undefined &&
        previous !== undefined &&
        current.decision !== previous.decision;
      const delta =
        current?.score !== null &&
        current?.score !== undefined &&
        previous?.score !== null &&
        previous?.score !== undefined
          ? Math.abs(current.score - previous.score)
          : 0;
      const moveTrigger =
        moveScore !== null && (actionChanged || bandChanged || delta >= minDelta);

      // Disparo: pico de crescimento OU mudança de ação/faixa/variação do Move Score.
      if (growthPct >= rules.minGrowthPct || moveTrigger) {
        // Verifica se já não existe alerta recente (últimas 48h)
        const recentAlert = await this.prisma.alert.findFirst({
          where: {
            productClusterId: cluster.id,
            createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
          },
        });

        if (!recentAlert) {
          const actionLabel = current?.action ?? current?.decision ?? null;
          const reason = moveTrigger
            ? `Move Score ${previous?.score ?? '—'} → ${moveScore} (ação ${actionLabel})`
            : `crescimento de +${growthPct}%`;
          const alert = await this.prisma.alert.create({
            data: {
              productClusterId: cluster.id,
              alertType: moveTrigger ? 'MOVE_SCORE_SHIFT' : 'OPPORTUNITY_SPIKE',
              severity: 'HIGH',
              message: `Produto '${cluster.canonicalName}': ${reason} (${lastVol} un/mês).`,
              evidence: {
                growthPct,
                currentVolume: lastVol,
                avgPrice,
                category: cluster.category,
                moveScore,
                previousMoveScore: previous?.score ?? null,
                decision: current?.decision ?? null,
                action: current?.action ?? null,
              },
            },
          });
          alertsCreated++;

          if (rules.webhookUrl) {
            try {
              await this.dispatchWebhook(rules.webhookUrl, rules.webhookChannel, {
                title: '⚡ Nova Oportunidade de Mercado Detectada',
                message: `O produto *${cluster.canonicalName}* mudou de patamar: ${reason}!`,
                productName: cluster.canonicalName,
                category: cluster.category || 'Geral',
                growthPct,
                // Sem Move Score, o webhook reflete a ausência — nunca placeholder.
                moveScore,
                decision: current?.decision ?? null,
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
    channel: WebhookChannel,
    data: {
      title: string;
      message: string;
      productName: string;
      category: string;
      growthPct: number;
      moveScore: number | null;
      decision?: string | null;
      telegramChatId?: string;
    },
  ) {
    // Anti-SSRF: valida protocolo/host (e resolve DNS no caso genérico) antes
    // de qualquer requisição de rede, mesmo que a regra já tenha sido salva.
    try {
      await assertSafeWebhookUrl(url, channel);
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        throw new Error(`Webhook recusado por segurança: ${error.message}`);
      }
      throw error;
    }

    const scoreLabel = data.moveScore !== null ? `${data.moveScore}/100` : 'sem score';
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
              { type: 'mrkdwn', text: `*Move Score:*\n${scoreLabel}` },
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
        `⭐ *Move Score:* ${scoreLabel}\n\n` +
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
