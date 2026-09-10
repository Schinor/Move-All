import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService, ChatMessage, ChatTool } from '../ai-gateway/openrouter.service';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { OpportunityEngineService } from '../opportunity-engine/opportunity-engine.service';
import { CopilotChatDto } from './dto/copilot-chat.dto';
import { UpdateCopilotConversationDto } from './dto/update-copilot-conversation.dto';

export const MAX_HISTORY_MESSAGES = 20;
const TOOL_OUTPUT_PREVIEW_CHARS = 400;

/**
 * Older tool dumps are JSON payloads that dominate token cost. Keep the latest
 * contiguous tool-round intact and replace earlier tool contents with a short summary.
 */
export function compactToolOutputs(messages: ChatMessage[]): ChatMessage[] {
  let lastRoundStart = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      lastRoundStart = i;
      while (lastRoundStart > 0 && messages[lastRoundStart - 1].role === 'tool') {
        lastRoundStart--;
      }
      break;
    }
  }

  if (lastRoundStart < 0) {
    return messages;
  }

  return messages.map((message, index) => {
    if (message.role !== 'tool' || index >= lastRoundStart) {
      return message;
    }

    const content = message.content ?? '';
    if (content.length <= TOOL_OUTPUT_PREVIEW_CHARS) {
      return message;
    }

    return {
      ...message,
      content: JSON.stringify({
        truncated: true,
        name: message.name ?? 'tool',
        chars: content.length,
        preview: content.slice(0, TOOL_OUTPUT_PREVIEW_CHARS),
      }),
    };
  });
}

const SYSTEM_PROMPT = `Você é o Move AI Copilot, analista sênior de inteligência de mercado e sourcing para o segmento Fitness (equipamentos comerciais, residenciais, musculação, cardio, crossfit, calistenia, pilates e fisioterapia).
PRINCÍPIOS MANDATÓRIOS:
1. A IA EXPLICA e CONTEXTUALIZA, mas NUNCA inventa métricas, preços, nomes de produtos ou scores.
2. Quando o usuário fizer perguntas sobre catálogo, ranking, produtos, tendências, preços ou fornecedores, USE AS FERRAMENTAS (tool calls) para consultar a base de dados real do PostgreSQL/Prisma.
3. Se nenhuma ferramenta retornar dados para a consulta, informe com transparência que não há registros correspondentes na base atual.
4. Responda sempre em português claro, profissional, conciso e orientado a negócios.`;

const COPILOT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Busca produtos fitness no catálogo pelo nome ou categoria, retornando scores e preços reais.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca do produto (ex.: "esteira", "haltere", "kettlebell")',
          },
          category: {
            type: 'string',
            description:
              'Categoria fitness opcional (ex.: "musculacao_pesos_livres", "cardio_fitness")',
          },
          limit: {
            type: 'number',
            description: 'Número máximo de resultados (padrão: 8)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_details',
      description:
        'Obtém detalhes analíticos aprofundados de um produto específico pelo seu ID (scores, histórico de preços, risco Monte Carlo).',
      parameters: {
        type: 'object',
        properties: {
          product_cluster_id: {
            type: 'string',
            description: 'ID UUID do cluster do produto',
          },
        },
        required: ['product_cluster_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_signals',
      description:
        'Consulta os sinais aduaneiros (TradeAtlas/Comex) e sinais de demanda recentes no mercado brasileiro.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Número máximo de sinais a retornar (padrão: 6)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_suppliers',
      description: 'Consulta a lista de fornecedores internacionais de produtos fitness mapeados.',
      parameters: {
        type: 'object',
        properties: {
          country: {
            type: 'string',
            description: 'País do fornecedor opcional (ex.: "China", "Brasil", "EUA")',
          },
          limit: {
            type: 'number',
            description: 'Limite de fornecedores (padrão: 6)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_collection_status',
      description: 'Consulta o status dos pipelines de coleta e raspagem de dados em execução.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openRouter: OpenRouterService,
    private readonly trendEngine: TrendEngineService,
    private readonly opportunityEngine: OpportunityEngineService,
  ) {}

  async listConversations(clientId?: string) {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (!normalizedClientId) return [];

    const conversations = await this.prisma.aiConversation.findMany({
      where: {
        OR: [{ clientId: normalizedClientId }, { clientId: null }],
      },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      take: 50,
      include: {
        _count: { select: { messages: true } },
      },
    });

    return conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title || 'Nova conversa',
      is_pinned: conversation.isPinned ?? false,
      message_count: conversation._count.messages,
      created_at: conversation.createdAt.toISOString(),
      updated_at: conversation.updatedAt.toISOString(),
    }));
  }

  async getConversation(id: string, clientId?: string) {
    const conversation = await this.findConversation(id, clientId);
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    await this.claimConversation(conversation, clientId);

    const fullConversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversation.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!fullConversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    return {
      id: fullConversation.id,
      title: fullConversation.title || 'Nova conversa',
      is_pinned: fullConversation.isPinned ?? false,
      message_count: fullConversation.messages.length,
      created_at: fullConversation.createdAt.toISOString(),
      updated_at: fullConversation.updatedAt.toISOString(),
      messages: fullConversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        tool_calls: message.toolCalls,
        created_at: message.createdAt.toISOString(),
      })),
    };
  }

  async deleteConversation(id: string, clientId?: string) {
    const conversation = await this.findConversation(id, clientId);
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    await this.prisma.aiConversation.delete({ where: { id: conversation.id } });
    return { deleted: true, conversation_id: conversation.id };
  }

  async updateConversation(id: string, dto: UpdateCopilotConversationDto, clientId?: string) {
    const conversation = await this.findConversation(id, clientId);
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada.');
    }

    const data: { title?: string; isPinned?: boolean } = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('O nome da conversa não pode ficar vazio.');
      }
      data.title = title;
    }
    if (dto.isPinned !== undefined) data.isPinned = dto.isPinned;

    const updated = await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data,
      include: { _count: { select: { messages: true } } },
    });

    return {
      id: updated.id,
      title: updated.title || 'Nova conversa',
      is_pinned: updated.isPinned ?? false,
      message_count: updated._count.messages,
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString(),
    };
  }

  async chat(dto: CopilotChatDto) {
    if (!this.openRouter.isAvailable) {
      throw new ServiceUnavailableException(
        'Move AI indisponível — chave OPENROUTER_API_KEY não configurada.',
      );
    }

    const prepared = await this.prepareConversation(dto);
    const conversationId = prepared.conversationId;
    const messages = prepared.messages;

    let toolCallsCount = 0;
    const maxToolIterations = 3;
    let finalReply = '';

    for (let iteration = 0; iteration < maxToolIterations; iteration++) {
      const response = await this.openRouter.chatCompletion(compactToolOutputs(messages), {
        endpointName: 'copilot_chat',
        tools: COPILOT_TOOLS,
        toolChoice: 'auto',
        temperature: 0.2,
        maxTokens: 2048,
        metadata: {
          conversationId,
          historyMessages: messages.length,
        },
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallsCount += response.toolCalls.length;
        // Adiciona a mensagem do assistente contendo os tool calls
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
          tool_calls: response.toolCalls,
        });

        // Executa cada ferramenta
        for (const toolCall of response.toolCalls) {
          const fnName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            args = {};
          }

          const toolResult = await this.executeTool(fnName, args);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: fnName,
            content: JSON.stringify(toolResult),
          });
        }
      } else {
        // Modelo retornou a resposta final em texto
        finalReply = response.content ?? 'Não foi possível gerar uma resposta.';
        break;
      }
    }

    if (!finalReply) {
      // Se estourou as iterações sem texto, faz uma chamada final sem ferramentas
      const fallbackResponse = await this.openRouter.chatCompletion(compactToolOutputs(messages), {
        endpointName: 'copilot_chat_summary',
        temperature: 0.2,
        maxTokens: 1024,
        metadata: {
          conversationId,
          historyMessages: messages.length,
        },
      });
      finalReply = fallbackResponse.content ?? 'Análise concluída com base nos dados obtidos.';
    }

    // 4. Salvar resposta do assistente no banco
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: finalReply,
      },
    });
    await this.touchConversation(conversationId);

    return {
      reply: finalReply,
      conversation_id: conversationId,
      tool_calls_executed: toolCallsCount,
      grounded_at: new Date().toISOString(),
    };
  }

  async *chatStream(
    dto: CopilotChatDto,
  ): AsyncGenerator<{ token?: string; done?: boolean; conversation_id?: string }, void, unknown> {
    if (!this.openRouter.isAvailable) {
      throw new ServiceUnavailableException(
        'Move AI indisponível — chave OPENROUTER_API_KEY não configurada.',
      );
    }

    const prepared = await this.prepareConversation(dto);
    const conversationId = prepared.conversationId;
    const messages = prepared.messages;

    // Verifica se ferramentas são necessárias antes de gerar o stream final
    const toolCheckResponse = await this.openRouter.chatCompletion(compactToolOutputs(messages), {
      endpointName: 'copilot_tool_check',
      tools: COPILOT_TOOLS,
      toolChoice: 'auto',
      temperature: 0.2,
      maxTokens: 1024,
      metadata: {
        conversationId,
        historyMessages: messages.length,
      },
    });

    if (toolCheckResponse.toolCalls && toolCheckResponse.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: toolCheckResponse.content ?? '',
        tool_calls: toolCheckResponse.toolCalls,
      });

      for (const toolCall of toolCheckResponse.toolCalls) {
        const fnName = toolCall.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        const toolResult = await this.executeTool(fnName, args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: fnName,
          content: JSON.stringify(toolResult),
        });
      }
    }

    let fullReply = '';
    for await (const token of this.openRouter.chatStream(compactToolOutputs(messages), {
      endpointName: 'copilot_chat_stream',
      temperature: 0.2,
      maxTokens: 2048,
      metadata: {
        conversationId,
        historyMessages: messages.length,
      },
    })) {
      fullReply += token;
      yield { token, conversation_id: conversationId };
    }

    if (fullReply.trim()) {
      await this.prisma.aiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: fullReply.trim(),
        },
      });
      await this.touchConversation(conversationId);
    }

    yield { done: true, conversation_id: conversationId };
  }

  private async prepareConversation(dto: CopilotChatDto): Promise<{
    conversationId: string;
    messages: ChatMessage[];
  }> {
    const lastUserMsg = dto.messages.filter((message) => message.role === 'user').at(-1);
    const conversation = await this.findConversation(dto.conversationId, dto.clientId);
    let conversationId: string;

    if (!conversation) {
      const newConversation = await this.prisma.aiConversation.create({
        data: {
          title: (
            lastUserMsg?.content ||
            dto.messages.at(0)?.content ||
            'Nova Consulta Fitness'
          ).slice(0, 60),
          clientId: this.normalizeClientId(dto.clientId) ?? null,
        },
      });
      conversationId = newConversation.id;
    } else {
      conversationId = conversation.id;
      await this.claimConversation(conversation, dto.clientId);
    }

    const storedMessages = (
      await this.prisma.aiMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: MAX_HISTORY_MESSAGES,
        select: { role: true, content: true },
      })
    ).reverse();

    this.logger.debug(
      `Copilot history window=${storedMessages.length}/${MAX_HISTORY_MESSAGES} conversation=${conversationId}`,
    );

    if (lastUserMsg) {
      await this.prisma.aiMessage.create({
        data: {
          conversationId,
          role: 'user',
          content: lastUserMsg.content,
        },
      });
      await this.touchConversation(conversationId);
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...storedMessages.map((message) => ({
        role: this.toChatRole(message.role),
        content: message.content,
      })),
    ];

    if (lastUserMsg) {
      messages.push({ role: 'user', content: lastUserMsg.content });
    } else if (storedMessages.length === 0) {
      messages.push(
        ...dto.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      );
    }

    return { conversationId, messages };
  }

  private async findConversation(id?: string, clientId?: string) {
    if (!id) return null;

    const normalizedClientId = this.normalizeClientId(clientId);
    if (normalizedClientId) {
      return this.prisma.aiConversation.findFirst({
        where: {
          id,
          OR: [{ clientId: normalizedClientId }, { clientId: null }],
        },
      });
    }

    return this.prisma.aiConversation.findUnique({ where: { id } });
  }

  private async claimConversation(
    conversation: { id: string; clientId: string | null },
    clientId?: string,
  ): Promise<void> {
    const normalizedClientId = this.normalizeClientId(clientId);
    if (normalizedClientId && !conversation.clientId) {
      await this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { clientId: normalizedClientId },
      });
    }
  }

  private async touchConversation(id: string): Promise<void> {
    await this.prisma.aiConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  private normalizeClientId(clientId?: string): string | undefined {
    const normalized = clientId?.trim();
    return normalized ? normalized : undefined;
  }

  private toChatRole(role: string): ChatMessage['role'] {
    if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
      return role;
    }
    return 'assistant';
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'search_products': {
          const query = typeof args.query === 'string' ? args.query.trim() : '';
          const category = typeof args.category === 'string' ? args.category.trim() : undefined;
          const limit = typeof args.limit === 'number' ? Math.min(args.limit, 20) : 8;

          const clusters = await this.prisma.productCluster.findMany({
            where: {
              ...(query ? { canonicalName: { contains: query, mode: 'insensitive' } } : {}),
              ...(category ? { category } : {}),
            },
            include: {
              snapshots: { orderBy: { collectedAt: 'desc' }, take: 1 },
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
          });

          return clusters.map((c) => ({
            id: c.id,
            name: c.canonicalName,
            category: c.category,
            risk_level: c.riskLevel ?? 'medio',
            financial_score: c.financialScore ?? 50,
            latest_price: c.snapshots.at(0)?.priceMin ? Number(c.snapshots.at(0)?.priceMin) : null,
            marketplace: c.snapshots.at(0)?.marketplace ?? 'desconhecido',
          }));
        }

        case 'get_product_details': {
          const id = String(args.product_cluster_id);
          const cluster = await this.prisma.productCluster.findUnique({
            where: { id },
            include: {
              snapshots: { orderBy: { collectedAt: 'asc' }, take: 50 },
              alerts: { orderBy: { createdAt: 'desc' }, take: 3 },
            },
          });

          if (!cluster) {
            return { error: `Produto com id ${id} não encontrado.` };
          }

          const trend = this.trendEngine.calculateFromSnapshots(
            cluster.snapshots.map((s) => ({
              marketplace: s.marketplace,
              category: cluster.category,
              priceMin: s.priceMin ? Number(s.priceMin) : null,
              rating: s.rating ? Number(s.rating) : null,
              reviewCount: s.reviewCount,
              salesSignalRaw: s.salesSignalRaw ? Number(s.salesSignalRaw) : null,
              salesSignalType: s.salesSignalType as any,
              collectedAt: s.collectedAt,
            })),
            cluster.category ?? undefined,
          );

          const opp = this.opportunityEngine.calculate({
            trendScore: trend.trendScore,
            marginScore: (cluster.financialScore ?? 50) / 100,
            westernSaturationScore: 0.2,
          });

          const prices = cluster.snapshots.map((s) => Number(s.priceMin)).filter((p) => p > 0);

          return {
            id: cluster.id,
            name: cluster.canonicalName,
            category: cluster.category,
            risk: cluster.riskLevel ?? 'medio',
            scores: {
              opportunity_score: Math.round(opp.opportunityScore * 100),
              trend_score: Math.round(trend.trendScore * 100),
              growth_score: Math.round(trend.marketplaceGrowthScore * 100),
              review_velocity: Math.round(trend.reviewVelocityScore * 100),
            },
            price_stats: {
              min_usd: prices.length ? Math.min(...prices) : null,
              max_usd: prices.length ? Math.max(...prices) : null,
              snapshots_recorded: cluster.snapshots.length,
            },
            alerts: cluster.alerts.map((a) => a.message),
          };
        }

        case 'get_market_signals': {
          const limit = typeof args.limit === 'number' ? Math.min(args.limit, 15) : 6;
          const signals = await this.prisma.shipment.findMany({
            orderBy: { arrivalDate: 'desc' },
            take: limit,
            select: {
              id: true,
              productDetails: true,
              originCountry: true,
              fobUsd: true,
              quantity: true,
              quantityUnit: true,
              arrivalDate: true,
            },
          });

          const demandSignals = await this.prisma.intelligenceDemandSignal.findMany({
            orderBy: { weekStart: 'desc' },
            take: limit,
          });

          return {
            customs_shipments: signals.map((s) => ({
              product: s.productDetails,
              origin: s.originCountry,
              fob_usd: s.fobUsd ? Number(s.fobUsd) : null,
              quantity: s.quantity ? Number(s.quantity) : null,
              date: s.arrivalDate,
            })),
            demand_trends: demandSignals.map((d) => ({
              keyword: d.keyword,
              geo: d.geo,
              trend_index: d.trendIndex ? Number(d.trendIndex) : null,
              week: d.weekStart,
            })),
          };
        }

        case 'get_top_suppliers': {
          const country = typeof args.country === 'string' ? args.country.trim() : undefined;
          const limit = typeof args.limit === 'number' ? Math.min(args.limit, 15) : 6;

          const shipments = await this.prisma.shipment.findMany({
            where: {
              exporterName: { not: null },
              ...(country ? { originCountry: { contains: country, mode: 'insensitive' } } : {}),
            },
            orderBy: { arrivalDate: 'desc' },
            take: limit * 3,
          });

          const byExporter = new Map<
            string,
            { count: number; country: string | null; fobTotal: number }
          >();
          for (const s of shipments) {
            if (!s.exporterName) continue;
            const existing = byExporter.get(s.exporterName) ?? {
              count: 0,
              country: s.originCountry,
              fobTotal: 0,
            };
            existing.count += 1;
            if (s.fobUsd) existing.fobTotal += Number(s.fobUsd);
            byExporter.set(s.exporterName, existing);
          }

          return [...byExporter.entries()].slice(0, limit).map(([name, data]) => ({
            supplier_name: name,
            origin_country: data.country,
            shipments_observed: data.count,
            avg_fob_usd: data.count > 0 ? Math.round(data.fobTotal / data.count) : null,
          }));
        }

        case 'get_collection_status': {
          const jobs = await this.prisma.collectionJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5,
          });
          return jobs.map((j) => ({
            id: j.id,
            query_term: j.queryTerm,
            status: j.status,
            started_at: j.startedAt,
            finished_at: j.finishedAt,
            error: j.errorMessage,
          }));
        }

        default:
          return { error: `Ferramenta desconhecida: ${name}` };
      }
    } catch (err) {
      this.logger.error(`Erro ao executar ferramenta ${name}: ${err}`);
      return { error: `Falha na consulta interna: ${String(err)}` };
    }
  }
}
