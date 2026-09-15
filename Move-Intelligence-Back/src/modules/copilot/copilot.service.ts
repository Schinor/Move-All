import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { syntheticSnapshotWhere } from '../../shared/synthetic-data/synthetic-data.filter';
import { OpenRouterService, ChatMessage, ChatTool } from '../ai-gateway/openrouter.service';
import { DashboardApiService } from '../dashboard-api/dashboard-api.service';
import { loadLatestMoveScores } from '../../shared/scoring/product-score-loader';
import type { Prisma } from '@prisma/client';
import { extractTextToolCalls, stripTextToolCalls } from './text-tool-calls';
import { expandSearchQuery, normalizeSearchText } from '../../shared/search/search-expansion';
import {
  PROMISE_FALLBACK_SUFFIX,
  PROMISE_NUDGE,
  chunkReply,
  finalizeReply,
  hasUnfulfilledPromise,
} from './reply-guard';
import { CopilotChatDto } from './dto/copilot-chat.dto';
import { UpdateCopilotConversationDto } from './dto/update-copilot-conversation.dto';

export const MAX_HISTORY_MESSAGES = 20;
/** Resposta amigável quando a consulta aos dados falha ou o modelo insiste em markup. */
export const COPILOT_UNAVAILABLE_REPLY =
  'Não consegui consultar os dados agora. Tente reformular a pergunta.';
// P0-3: trocado pelo Raul apenas por modelo com tool calling nativo (pode ter custo).
const TOOL_CALL_RETRY_MESSAGE =
  'Use apenas as ferramentas disponíveis via function calling e nunca escreva chamadas de ferramenta em texto.';
const TOOL_OUTPUT_PREVIEW_CHARS = 400;
/** Rodadas de ferramentas antes da resposta (busca vazia → busca ampliada → resposta). */
const MAX_TOOL_ROUNDS = 4;

/** Ordenações aceitas por `get_product_ranking`, espelhando /trends/products (C2). */
const RANKING_SORTS = [
  'move_score',
  'growth',
  'projected_revenue',
  'momentum',
  'price',
  'reviews',
  'action',
  'name',
];

/** Extrai UUIDs citados no texto (para pós-validação C7). */
export function extractMentionedIds(text: string): string[] {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
}

/** IDs e nomes devolvidos pelas ferramentas na conversa (base para validar grounding). */
export function collectToolProductRefs(messages: ChatMessage[]): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'tool' || !m.content) continue;
    try {
      const data = JSON.parse(m.content) as unknown;
      const list = Array.isArray((data as { products?: unknown }).products)
        ? ((data as { products: Array<Record<string, unknown>> }).products)
        : Array.isArray(data)
          ? (data as Array<Record<string, unknown>>)
          : [];
      for (const p of list) {
        if (typeof p.id === 'string') ids.add(p.id);
        if (typeof p.product_cluster_id === 'string') ids.add(p.product_cluster_id as string);
        if (typeof p.name === 'string') names.add((p.name as string).toLowerCase());
        if (typeof p.canonical_name === 'string') names.add((p.canonical_name as string).toLowerCase());
      }
    } catch {
      continue;
    }
  }
  return { ids, names };
}

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
4. Responda sempre em português claro, profissional, conciso e orientado a negócios.
5. NUNCA anuncie que vai buscar, consultar ou ampliar algo depois: chame a ferramenta nesta mesma resposta ou responda com o que já tem. Se search_products vier vazio, tente de novo com o tipo de equipamento ou uma categoria de available_categories antes de responder.

VOCABULÁRIO ÚNICO — MOVE SCORE + AÇÃO (regras classificam, IA explica):
- Existe UM único score: o MOVE SCORE (0-100), oficial, calculado por Monte Carlo sobre o histórico real. O mesmo número aparece na tela de Ranking.
- "score" sem qualificador, "ranking", "produto com maior score", "top produtos" => é o MOVE SCORE. Obtenha-o SEMPRE com a ferramenta get_product_ranking, que já devolve a lista ordenada. NUNCA responda a essa pergunta com search_products, que não ordena por score.
- Ação oficial por quadrante (B3, decisões 2-3): DECIDIR_AGORA (sobe + faixa verde) · NEGOCIAR_CUSTO (sobe + fora do verde) · TESTAR_DEMANDA (estável/cai + verde) · IGNORAR (demais) · DADOS_INSUFICIENTES (sem histórico mínimo). Rótulos: Decidir agora, Negociar custo, Testar demanda, Ignorar, Dados insuficientes. Faixa verde > 70, amarela 50–70 (move_score_bands, padrão 70/50).
- Tendência é momentum (sobe/estável/cai, sem nota 0–100). Cite growth_pct só no detalhe.
- Sem Move Score (move_score nulo) ou ação DADOS_INSUFICIENTES, diga que o produto ainda NÃO tem histórico suficiente — e mostre o rótulo de confiança (data_confidence), nunca um número. Jamais assuma valor padrão nem trate nulo como empate.
- Contexto permitido além do score: ação, momentum, P(VPL>0), CVaR, causas do risco, premissas e origem — tudo vindo das ferramentas. Cite SÓ produtos que existem nos dados consultados.
- Risco: descreva o que está causando o risco alto (margem, drivers da simulação). Sem riscos operacionais.

FORMATO:
- Resposta "Recomendado + alternativas": o recomendado é o maior Move Score entre DECIDIR_AGORA (regras escolhem); alternativas são os próximos.
- Use tabelas Markdown (com a linha separadora de hífens abaixo do cabeçalho) para comparar 3 ou mais produtos, com no máximo 4 colunas.
- Sempre cite Move Score + ação ao lado do nome do produto. Proibido citar produto que não veio de ferramenta.`;

const COPILOT_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_product_ranking',
      description:
        'Retorna o ranking de produtos já ordenado (move_score, ação por quadrante, momentum, faixa), com os MESMOS números da tela de Ranking. Pagina o banco inteiro (sem teto de 50) e aceita filtro por ação. Use SEMPRE que a pergunta envolver "maior score", "melhores produtos", "top N", "ranking" ou comparação.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Quantos produtos retornar, do topo para baixo (padrão: 10, máximo: 200)',
          },
          sort: {
            type: 'string',
            enum: ['move_score', 'growth', 'projected_revenue', 'momentum', 'price', 'reviews', 'action', 'name'],
            description: 'Critério de ordenação (padrão: move_score, o score oficial)',
          },
          category: {
            type: 'string',
            description: 'Filtra por categoria fitness opcional (ex.: "resistance_bands")',
          },
          action: {
            type: 'string',
            enum: ['DECIDIR_AGORA', 'NEGOCIAR_CUSTO', 'TESTAR_DEMANDA', 'IGNORAR', 'DADOS_INSUFICIENTES'],
            description: 'Filtra pela ação do quadrante (C2)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_products',
      description:
        'Busca produtos fitness no catálogo por nome, categoria, grupo muscular ou objetivo (ex.: "pernas", "abdômen", "cardio"): expande sinônimos e faz busca aproximada. Não ordena por score — para ranking use get_product_ranking. Traz o Move Score oficial (null sem histórico suficiente). Sem resultado, devolve available_categories para sugerir.',
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
        'Obtém detalhes analíticos aprofundados de um produto específico pelo seu ID (Move Score, decisão, P(VPL>0), CVaR, premissas e histórico de preços).',
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
    private readonly dashboard: DashboardApiService,
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

    // (1) Até MAX_TOOL_ROUNDS rodadas de ferramentas; (3) promessa sem ação é cobrada no loop.
    const loop = await this.runToolLoop(messages, conversationId, 'copilot_chat');
    const toolCallsCount = loop.toolCallsCount;
    let finalReply = loop.draft;

    if (loop.exhausted) {
      // Rodadas esgotadas sem texto: chamada final sem ferramentas.
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
    } else if (!finalReply) {
      finalReply = 'Não foi possível gerar uma resposta.';
    }

    // C7: pós-validação — nenhum ID fora das ferramentas pode aparecer. Refaz uma
    // vez; se persistir, anexa aviso (caso da reunião: recomendado fora da lista).
    // P0-3: sanitização final — markup remanescente nunca é salvo nem exibido.
    // (3) Nunca termina em promessa: sem rodada restante, vira resposta honesta.
    finalReply = finalizeReply(finalReply) || COPILOT_UNAVAILABLE_REPLY;
    finalReply = await this.validateGroundedReply(messages, finalReply, conversationId);

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

    // (1) Até MAX_TOOL_ROUNDS rodadas de ferramentas antes de responder: uma busca
    // vazia pode virar busca ampliada em vez de a conversa parar numa promessa.
    // As rodadas podem levar mais que o timeout de inatividade do front (60 s):
    // enquanto não terminam, manda um batimento { conversation_id } periódico.
    const loopPromise = this.runToolLoop(messages, conversationId, 'copilot_tool_check');
    const heartbeatMs = Number(process.env.COPILOT_STREAM_HEARTBEAT_MS ?? 15_000);
    let loopSettled = false;
    const loopDone = loopPromise.then(
      () => {
        loopSettled = true;
      },
      () => {
        loopSettled = true;
      },
    );
    while (!loopSettled) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<'tick'>((resolve) => {
        timer = setTimeout(() => resolve('tick'), heartbeatMs);
      });
      const outcome = await Promise.race([loopDone.then(() => 'done' as const), tick]);
      clearTimeout(timer);
      if (outcome === 'tick' && !loopSettled) {
        yield { conversation_id: conversationId };
      }
    }
    const loop = await loopPromise;

    if (loop.draft.trim()) {
      // O rascunho final já veio do modelo: valida ANTES de enviar — (3) promessa
      // sem ação e C7 grounding — e só então transmite em pedaços.
      let reply = finalizeReply(loop.draft) || COPILOT_UNAVAILABLE_REPLY;
      try {
        reply = await this.validateGroundedReply(messages, reply, conversationId);
      } catch {
        // Validação é best-effort; a resposta sanitizada segue.
      }
      try {
        for (const chunk of chunkReply(reply)) {
          yield { token: chunk, conversation_id: conversationId };
        }
      } finally {
        // P0-5: salva mesmo se o cliente desconectar no meio.
        try {
          await this.prisma.aiMessage.create({
            data: { conversationId, role: 'assistant', content: reply.trim() },
          });
          await this.touchConversation(conversationId);
        } catch {
          // Salvamento é best-effort no caminho do stream.
        }
      }
      yield { done: true, conversation_id: conversationId };
      return;
    }

    // P0-3/P0-5: o stream sempre fecha com done; vazio vira erro amigável.
    // P0-5: a resposta não depende da conexão — o finally salva a mensagem do
    // assistente sempre, inclusive se o cliente desconectar no meio (o break do
    // consumidor completa o gerador via return, mas o finally executa antes).
    let fullReply = '';
    let streamError: string | null = null;
    let promiseNotice: string | null = null;
    try {
      for await (const token of this.streamWithTimeout(
        this.openRouter.chatStream(compactToolOutputs(messages), {
          endpointName: 'copilot_chat_stream',
          temperature: 0.2,
          maxTokens: 2048,
          metadata: {
            conversationId,
            historyMessages: messages.length,
          },
        }),
      )) {
        fullReply += token;
        yield { token, conversation_id: conversationId };
      }
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
    } finally {
      fullReply = stripTextToolCalls(fullReply);
      // (3) O texto já saiu em stream: se terminou prometendo, complementa com aviso honesto.
      if (hasUnfulfilledPromise(fullReply)) {
        promiseNotice = PROMISE_FALLBACK_SUFFIX;
        fullReply = `${fullReply.trim()}\n\n${promiseNotice}`;
      }
      if (!fullReply.trim()) {
        fullReply = streamError ?? COPILOT_UNAVAILABLE_REPLY;
      }
      try {
        await this.prisma.aiMessage.create({
          data: {
            conversationId,
            role: 'assistant',
            content: fullReply.trim(),
          },
        });
        await this.touchConversation(conversationId);
      } catch {
        // Salvamento é best-effort no caminho do stream.
      }
    }

    if (promiseNotice) {
      yield { token: `\n\n${promiseNotice}`, conversation_id: conversationId };
    }
    yield { done: true, conversation_id: conversationId };
  }

  /**
   * P0-3: consome o gerador de tokens com timeout total configurável
   * (`COPILOT_STREAM_TIMEOUT_MS`, padrão 60 s). Estouro vira erro amigável
   * em vez de travar o front esperando para sempre.
   */
  private async *streamWithTimeout(
    source: AsyncGenerator<string, void, unknown>,
    timeoutMs?: number,
  ): AsyncGenerator<string, void, unknown> {
    const totalMs =
      timeoutMs ?? Number(process.env.COPILOT_STREAM_TIMEOUT_MS ?? 60_000);
    const deadline = Date.now() + totalMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(COPILOT_UNAVAILABLE_REPLY);
        }
        let timedOut = false;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(COPILOT_UNAVAILABLE_REPLY));
          }, remaining);
        });
        try {
          const next = (await Promise.race([source.next(), timeout])) as
            | IteratorResult<string, void>
            | never;
          if (timedOut) break;
          if (next.done) return;
          yield next.value;
        } finally {
          if (timer) clearTimeout(timer);
          timer = null;
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
      // Abandona sem await: num gerador suspenso num await que nunca resolve,
      // o return() também nunca assentaria e travaria o stream.
      try {
        void source.return?.(undefined)?.catch?.(() => undefined);
      } catch {
        // Fechamento é best-effort.
      }
    }
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

  /** C7: confere IDs citados contra as ferramentas; refaz uma vez ou anexa aviso. */
  async validateGroundedReply(
    messages: ChatMessage[],
    reply: string,
    conversationId: string,
  ): Promise<string> {
    const refs = collectToolProductRefs(messages);
    if (refs.ids.size === 0) return reply;
    const mentioned = extractMentionedIds(reply).filter((id) => !refs.ids.has(id));
    if (mentioned.length === 0) return reply;
    try {
      const retry = await this.openRouter.chatCompletion(
        [
          ...compactToolOutputs(messages),
          {
            role: 'user',
            content: `Corrija a resposta anterior: cite SÓ produtos retornados pelas ferramentas (${[...refs.ids].slice(0, 20).join(', ')}). Nunca invente ID ou nome. Reescreva sem os IDs inválidos: ${mentioned.join(', ')}.`,
          },
        ],
        {
          endpointName: 'copilot_chat_grounding_fix',
          temperature: 0.2,
          maxTokens: 1024,
          metadata: { conversationId, invalidIds: mentioned },
        },
      );
      const fixed = retry.content ?? reply;
      const stillBad = extractMentionedIds(fixed).filter((id) => !refs.ids.has(id));
      if (stillBad.length === 0) return fixed;
      return `${fixed}\n\nAviso: a resposta menciona produto fora da base consultada (${stillBad.join(', ')}).`;
    } catch {
      return `${reply}\n\nAviso: a resposta menciona produto fora da base consultada (${mentioned.join(', ')}).`;
    }
  }

  private toChatRole(role: string): ChatMessage['role'] {
    if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
      return role;
    }
    return 'assistant';
  }

  /** P0-3: nomes aceitos pelo function calling nativo. `exec`/SQL livre nunca executa. */
  /**
   * (1) Rodadas de ferramentas compartilhadas por chat e stream. O modelo pode
   * encadear chamadas (busca vazia → sinônimos/categoria) até MAX_TOOL_ROUNDS.
   * (3) Texto que anuncia consulta sem chamar ferramenta é cobrado enquanto
   * houver rodada. Devolve o rascunho final (vazio sem texto) e se esgotou.
   */
  private async runToolLoop(
    messages: ChatMessage[],
    conversationId: string,
    endpointName: string,
  ): Promise<{ draft: string; toolCallsCount: number; exhausted: boolean }> {
    let toolCallsCount = 0;
    let textToolRetryUsed = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.openRouter.chatCompletion(compactToolOutputs(messages), {
        endpointName,
        tools: COPILOT_TOOLS,
        toolChoice: 'auto',
        temperature: 0.2,
        maxTokens: 2048,
        metadata: {
          conversationId,
          historyMessages: messages.length,
          round,
        },
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallsCount += response.toolCalls.length;
        messages.push({
          role: 'assistant',
          content: response.content ?? '',
          tool_calls: response.toolCalls,
        });
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
        continue;
      }

      // P0-3: o modelo sem tool calling nativo escreve pseudo-calls em texto.
      const { calls, cleanText } = extractTextToolCalls(response.content ?? '');
      const known = calls.filter((call) => this.isKnownTool(call.name));
      const unknown = calls.filter((call) => !this.isKnownTool(call.name));
      if (known.length > 0) {
        toolCallsCount += known.length;
        messages.push({ role: 'assistant', content: cleanText });
        for (const [index, call] of known.entries()) {
          const toolResult = await this.executeTool(call.name, call.args);
          messages.push({
            role: 'tool',
            tool_call_id: `text-${round}-${index}`,
            name: call.name,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }
      if (unknown.length > 0) {
        for (const call of unknown) {
          await this.logRejectedTextTool(conversationId, call.name, response.content ?? '');
        }
        if (!textToolRetryUsed) {
          textToolRetryUsed = true;
          messages.push({ role: 'assistant', content: cleanText });
          messages.push({
            role: 'system',
            content: `${TOOL_CALL_RETRY_MESSAGE} Ferramentas: ${this.availableToolNames()}.`,
          });
          continue;
        }
        return { draft: COPILOT_UNAVAILABLE_REPLY, toolCallsCount, exhausted: false };
      }

      // (3) Anunciou nova consulta sem chamar ferramenta: cobra a chamada.
      if (hasUnfulfilledPromise(cleanText) && round < MAX_TOOL_ROUNDS - 1) {
        messages.push({ role: 'assistant', content: cleanText });
        messages.push({
          role: 'system',
          content: `${PROMISE_NUDGE} Ferramentas: ${this.availableToolNames()}.`,
        });
        continue;
      }

      return { draft: cleanText, toolCallsCount, exhausted: false };
    }

    return { draft: '', toolCallsCount, exhausted: true };
  }

  /**
   * (2) Busca que entende a intenção: nome literal → palavras → sinônimos do
   * grupo muscular/objetivo → busca aproximada (pg_trgm). Sem resultado,
   * devolve as categorias disponíveis para a IA sugerir em vez de prometer.
   */
  private async searchProducts(args: Record<string, unknown>) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const category =
      typeof args.category === 'string' && args.category.trim() ? args.category.trim() : undefined;
    const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(args.limit, 20)) : 8;
    const expansion = expandSearchQuery(query);

    const find = (where: Prisma.ProductClusterWhereInput) =>
      this.prisma.productCluster.findMany({
        where: { ...where, ...(category ? { category } : {}) },
        include: {
          // Com INCLUDE_SYNTHETIC_DATA=false, o copilot não deve citar
          // preço/marketplace tirado de um snapshot sintético.
          snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'desc' }, take: 1 },
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
    const nameOrCategory = (terms: string[]): Prisma.ProductClusterWhereInput[] =>
      terms.flatMap((term) => [
        { canonicalName: { contains: term, mode: 'insensitive' } },
        { category: { contains: term.replace(/\s+/g, '_'), mode: 'insensitive' } },
      ]);

    let clusters: Awaited<ReturnType<typeof find>> = [];
    let matchedBy = 'nome';
    let searchedTerms: string[] = query ? [query] : [];

    if (!query) {
      clusters = await find({});
      matchedBy = category ? 'categoria' : 'catalogo';
    } else {
      clusters = await find({ OR: nameOrCategory([query]) });

      if (clusters.length === 0 && expansion.tokens.length > 0 && expansion.tokens.join(' ') !== normalizeSearchText(query)) {
        searchedTerms = expansion.tokens;
        clusters = await find({ OR: nameOrCategory(expansion.tokens) });
        matchedBy = 'palavras';
      }

      if (clusters.length === 0 && (expansion.terms.length > 0 || expansion.categories.length > 0)) {
        searchedTerms = [...expansion.terms, ...expansion.categories];
        clusters = await find({
          OR: [
            ...nameOrCategory(expansion.terms),
            ...(expansion.categories.length > 0 ? [{ category: { in: expansion.categories } }] : []),
          ],
        });
        matchedBy = 'sinonimos';
      }

      if (clusters.length === 0) {
        const ids = await this.fuzzyClusterIds([query, ...expansion.tokens]);
        if (ids.length > 0) {
          clusters = await find({ id: { in: ids } });
          matchedBy = 'aproximada';
        }
      }
    }

    if (clusters.length === 0) {
      return {
        products: [],
        matched_by: 'nenhum',
        searched_terms: searchedTerms,
        available_categories: await this.availableCategories(),
        note: 'Nenhum produto encontrado para esses termos (nome, palavras, sinônimos e busca aproximada). Informe isso ao usuário com transparência e sugira categorias de available_categories. Não prometa nova busca.',
      };
    }

    // `null` é informação: sem Move Score não há número — a IA usa o
    // rótulo de confiança. Preencher com padrão faria a IA reportar um
    // score inexistente.
    const scores = await loadLatestMoveScores(
      this.prisma,
      clusters.map((c) => c.id),
    );
    return {
      products: clusters.map((c) => {
        const moveScore = scores.get(c.id);
        return {
          id: c.id,
          name: c.canonicalName,
          category: c.category,
          move_score: moveScore?.moveScore ?? null,
          decision: moveScore?.decision ?? null,
          data_confidence: moveScore?.dataConfidence ?? null,
          p_vpl_positivo: moveScore?.pVplPositivo ?? null,
          latest_price: c.snapshots.at(0)?.priceMin ? Number(c.snapshots.at(0)?.priceMin) : null,
          marketplace: c.snapshots.at(0)?.marketplace ?? 'desconhecido',
        };
      }),
      matched_by: matchedBy,
      searched_terms: searchedTerms,
      ...(matchedBy === 'sinonimos' ? { interpreted_as: expansion.topics } : {}),
    };
  }

  /** Busca aproximada (pg_trgm) reaproveitando /search; sem extensão/migração, segue vazia. */
  private async fuzzyClusterIds(terms: string[]): Promise<string[]> {
    const ids = new Set<string>();
    const unique = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 3))];
    for (const term of unique.slice(0, 4)) {
      try {
        const result = await this.dashboard.search(term, 10);
        for (const product of result?.products ?? []) {
          if (product?.id) ids.add(product.id);
        }
      } catch {
        // Sem busca aproximada disponível: segue sem ela.
      }
      if (ids.size > 0) break;
    }
    return [...ids];
  }

  /** Categorias existentes no catálogo, para a IA sugerir quando a busca vier vazia. */
  private async availableCategories(): Promise<string[]> {
    try {
      const rows = await this.prisma.productCluster.findMany({
        select: { category: true },
        distinct: ['category'],
        take: 50,
      });
      return rows
        .map((row) => row.category)
        .filter((value): value is string => Boolean(value))
        .sort();
    } catch {
      return [];
    }
  }

  private isKnownTool(name: string): boolean {
    return COPILOT_TOOLS.some((tool) => tool.function.name === name);
  }

  private availableToolNames(): string {
    return COPILOT_TOOLS.map((tool) => tool.function.name).join(', ');
  }

  /** P0-3: registra pseudo-tool-call rejeitada (best-effort, nunca quebra o chat). */
  private async logRejectedTextTool(
    conversationId: string,
    toolName: string,
    excerpt: string,
  ): Promise<void> {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          endpoint: 'copilot_chat',
          model: process.env.OPENROUTER_MODEL ?? 'default',
          latencyMs: 0,
          status: 'rejected_tool',
          error: `text_tool_call:${toolName || 'empty'}:${excerpt.slice(0, 500)}`,
          metadata: { conversationId, toolName } as never,
        },
      });
    } catch {
      // Log é best-effort.
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case 'get_product_ranking': {
          // C7: pagina o banco inteiro, filtro por action, sem teto de 50 (até 200).
          const limit =
            typeof args.limit === 'number' && Number.isFinite(args.limit)
              ? Math.min(Math.max(Math.trunc(args.limit), 1), 200)
              : 10;
          const sort = RANKING_SORTS.includes(String(args.sort))
            ? String(args.sort)
            : 'move_score';
          const category = typeof args.category === 'string' ? args.category.trim() : undefined;
          const action =
            typeof args.action === 'string' && args.action.trim() ? args.action.trim().toUpperCase() : undefined;

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw = (await this.dashboard.listTrendingProducts({
            limit,
            sort,
            ...(category ? { category } : {}),
            ...(action ? { action, page: 1, pageSize: limit } : {}),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          })) as any;
          const products: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : (raw?.items ?? []);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rows = products.map((product: any, index: number) => ({
            position: index + 1,
            id: product.product_cluster_id,
            name: product.canonical_name,
            category: product.category,
            // B3: Move Score + ação por quadrante, momentum, faixa e risco.
            // Sem score, o rótulo de confiança — nunca número.
            move_score: product.move_score ?? null,
            decision: product.decision ?? null,
            action: (product as Record<string, unknown>).action ?? null,
            action_label: (product as Record<string, unknown>).action_label ?? null,
            score_band: (product as Record<string, unknown>).score_band ?? null,
            momentum: (product as Record<string, unknown>).momentum ?? null,
            data_confidence: product.data_confidence ?? null,
            p_vpl_positivo: product.p_vpl_positivo ?? null,
            cvar5: product.cvar5 ?? null,
            risk_explanation: (product as Record<string, unknown>).risk_explanation ?? null,
            growth_pct: product.growth_pct ?? null,
            stage: product.stage ?? null,
            risk: product.risk ?? null,
          }));

          return {
            sorted_by: sort,
            products: rows,
            note: rows.length
              ? `Ranking ordenado por ${sort}; os valores são os mesmos exibidos na tela de Ranking.`
              : 'Nenhum produto no ranking para os filtros informados.',
          };
        }

        case 'search_products':
          return this.searchProducts(args);

        case 'get_product_details': {
          const id = String(args.product_cluster_id);
          const cluster = await this.prisma.productCluster.findUnique({
            where: { id },
            include: {
              snapshots: { where: syntheticSnapshotWhere(), orderBy: { collectedAt: 'asc' }, take: 50 },
              alerts: { orderBy: { createdAt: 'desc' }, take: 3 },
            },
          });

          if (!cluster) {
            return { error: `Produto com id ${id} não encontrado.` };
          }

          // Contexto só com Move Score, decisão, P(VPL>0), CVaR e premissas +
          // origem (F2.7). Sem score, só a confiança.
          const latestScores = await loadLatestMoveScores(this.prisma, [cluster.id]);
          const latest = latestScores.get(cluster.id);
          const latestScore = latest
            ? await this.prisma.productScore.findFirst({
                where: { productClusterId: cluster.id },
                orderBy: { computedAt: 'desc' },
              })
            : null;

          const prices = cluster.snapshots.map((s) => Number(s.priceMin)).filter((p) => p > 0);

          return {
            id: cluster.id,
            name: cluster.canonicalName,
            category: cluster.category,
            move_score: latest?.moveScore ?? null,
            decision: latest?.decision ?? null,
            data_confidence: latest?.dataConfidence ?? null,
            p_vpl_positivo: latest?.pVplPositivo ?? null,
            cvar5: latest?.cvar5 ?? null,
            premises: latestScore?.premises ?? null,
            premises_hash: latestScore?.premisesHash ?? null,
            data_version: latestScore?.dataVersion ?? null,
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
