import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CopilotService, compactToolOutputs, MAX_HISTORY_MESSAGES } from './copilot.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { OpportunityEngineService } from '../opportunity-engine/opportunity-engine.service';

describe('CopilotService', () => {
  let service: CopilotService;
  let mockPrisma: any;
  let mockOpenRouter: any;
  let mockTrendEngine: any;
  let mockOpportunityEngine: any;

  beforeEach(() => {
    mockPrisma = {
      aiConversation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'conv-123' }),
        update: jest.fn().mockResolvedValue({ id: 'conv-123' }),
        delete: jest.fn().mockResolvedValue({ id: 'conv-123' }),
      },
      aiMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      productClusterId: jest.fn(),
      productCluster: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      shipment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      intelligenceDemandSignal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      collectionJob: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockOpenRouter = {
      isAvailable: true,
      chatCompletion: jest.fn(),
    };

    mockTrendEngine = {
      calculateFromSnapshots: jest.fn(),
    };

    mockOpportunityEngine = {
      calculate: jest.fn(),
    };

    service = new CopilotService(
      mockPrisma as unknown as PrismaService,
      mockOpenRouter as unknown as OpenRouterService,
      mockTrendEngine as unknown as TrendEngineService,
      mockOpportunityEngine as unknown as OpportunityEngineService,
    );
  });

  it('deve lançar ServiceUnavailableException quando a chave OPENROUTER não estiver configurada', async () => {
    mockOpenRouter.isAvailable = false;

    await expect(
      service.chat({
        messages: [{ role: 'user', content: 'Olá, quais são as melhores esteiras?' }],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('deve processar uma resposta direta do Copilot e salvar histórico', async () => {
    mockOpenRouter.chatCompletion.mockResolvedValueOnce({
      content: 'As melhores esteiras no catálogo possuem Opportunity Score acima de 80.',
      toolCalls: undefined,
      model: 'inclusionai/ling-3.0-flash-fin:free',
      latencyMs: 320,
    });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'Quais esteiras são recomendadas?' }],
    });

    expect(result.conversation_id).toBe('conv-123');
    expect(result.reply).toContain('Opportunity Score acima de 80');
    expect(result.tool_calls_executed).toBe(0);
    expect(mockPrisma.aiMessage.create).toHaveBeenCalledTimes(2); // 1 user + 1 assistant
  });

  it('deve usar o histórico persistido como contexto ao continuar uma conversa', async () => {
    mockPrisma.aiConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-123',
      clientId: 'client-123',
    });
    mockPrisma.aiMessage.findMany.mockResolvedValueOnce([
      { role: 'assistant', content: 'A resposta anterior veio da base.' },
      { role: 'user', content: 'Qual é a tendência anterior?' },
    ]);
    mockOpenRouter.chatCompletion.mockResolvedValueOnce({
      content: 'Vou continuar a análise com esse contexto.',
      toolCalls: undefined,
      model: 'inclusionai/ling-3.0-flash-fin:free',
      latencyMs: 320,
    });

    await service.chat({
      clientId: 'client-123',
      conversationId: 'conv-123',
      messages: [{ role: 'user', content: 'E qual é o próximo passo?' }],
    });

    expect(mockPrisma.aiMessage.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-123' },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    expect(mockOpenRouter.chatCompletion.mock.calls[0][0]).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'Qual é a tendência anterior?' },
      { role: 'assistant', content: 'A resposta anterior veio da base.' },
      { role: 'user', content: 'E qual é o próximo passo?' },
    ]);
  });

  it('deve listar conversas do cliente com contagem e ordenação do banco', async () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    const updatedAt = new Date('2026-09-01T12:05:00.000Z');
    mockPrisma.aiConversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-123',
        title: 'Análise de esteiras',
        isPinned: false,
        createdAt,
        updatedAt,
        _count: { messages: 4 },
      },
    ]);

    await expect(service.listConversations('client-123')).resolves.toEqual([
      {
        id: 'conv-123',
        title: 'Análise de esteiras',
        is_pinned: false,
        message_count: 4,
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
      },
    ]);
    expect(mockPrisma.aiConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ clientId: 'client-123' }, { clientId: null }] },
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      }),
    );
  });

  it('deve carregar e excluir uma conversa pertencente ao cliente', async () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    const updatedAt = new Date('2026-09-01T12:05:00.000Z');
    mockPrisma.aiConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-123',
      clientId: 'client-123',
    });
    mockPrisma.aiConversation.findUnique.mockResolvedValueOnce({
      id: 'conv-123',
      title: 'Análise de esteiras',
      isPinned: false,
      createdAt,
      updatedAt,
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Quais esteiras devo analisar?',
          toolCalls: null,
          createdAt,
        },
      ],
    });

    await expect(service.getConversation('conv-123', 'client-123')).resolves.toMatchObject({
      id: 'conv-123',
      message_count: 1,
      messages: [
        expect.objectContaining({
          role: 'user',
          content: 'Quais esteiras devo analisar?',
        }),
      ],
    });

    mockPrisma.aiConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-123',
      clientId: 'client-123',
    });
    await expect(service.deleteConversation('conv-123', 'client-123')).resolves.toEqual({
      deleted: true,
      conversation_id: 'conv-123',
    });
    expect(mockPrisma.aiConversation.delete).toHaveBeenCalledWith({
      where: { id: 'conv-123' },
    });
  });

  it('deve renomear e fixar uma conversa pertencente ao cliente', async () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    const updatedAt = new Date('2026-09-01T12:05:00.000Z');
    mockPrisma.aiConversation.findFirst.mockResolvedValueOnce({
      id: 'conv-123',
      clientId: 'client-123',
    });
    mockPrisma.aiConversation.update.mockResolvedValueOnce({
      id: 'conv-123',
      title: 'Decisão sobre esteiras',
      isPinned: true,
      createdAt,
      updatedAt,
      _count: { messages: 4 },
    });

    await expect(
      service.updateConversation(
        'conv-123',
        { title: '  Decisão sobre esteiras  ', isPinned: true },
        'client-123',
      ),
    ).resolves.toEqual({
      id: 'conv-123',
      title: 'Decisão sobre esteiras',
      is_pinned: true,
      message_count: 4,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
    });
    expect(mockPrisma.aiConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-123' },
      data: { title: 'Decisão sobre esteiras', isPinned: true },
      include: { _count: { select: { messages: true } } },
    });
  });

  it('deve rejeitar o acesso a uma conversa que não pertence ao cliente', async () => {
    mockPrisma.aiConversation.findFirst.mockResolvedValueOnce(null);

    await expect(service.getConversation('conv-private', 'client-123')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deve executar tool-use quando o modelo solicitar busca de produtos e retornar resposta fundamentada', async () => {
    mockPrisma.productCluster.findMany.mockResolvedValueOnce([
      {
        id: 'cluster-esteira-1',
        canonicalName: 'Esteira Ergométrica Dobrável Pro',
        category: 'cardio_fitness',
        riskLevel: 'baixo',
        financialScore: 85,
        snapshots: [{ priceMin: 2499.0, marketplace: 'mercadolivre' }],
      },
    ]);

    // 1ª chamada: modelo decide chamar a ferramenta search_products
    mockOpenRouter.chatCompletion.mockResolvedValueOnce({
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'search_products',
            arguments: JSON.stringify({ query: 'esteira', limit: 5 }),
          },
        },
      ],
      model: 'inclusionai/ling-3.0-flash-fin:free',
      latencyMs: 400,
    });

    // 2ª chamada: modelo recebe os dados e gera o parecer final
    mockOpenRouter.chatCompletion.mockResolvedValueOnce({
      content:
        'Encontrei a Esteira Ergométrica Dobrável Pro com risco baixo e preço médio de R$ 2.499 no Mercado Livre.',
      toolCalls: undefined,
      model: 'inclusionai/ling-3.0-flash-fin:free',
      latencyMs: 510,
    });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'Busque esteiras disponíveis' }],
    });

    expect(result.tool_calls_executed).toBe(1);
    expect(result.reply).toContain('Esteira Ergométrica Dobrável Pro');
    expect(mockPrisma.productCluster.findMany).toHaveBeenCalled();
  });

  it('deve truncar saídas de ferramenta antigas e preservar a última rodada', () => {
    const bulky = JSON.stringify({ rows: 'x'.repeat(500) });
    const compacted = compactToolOutputs([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'busque esteiras' },
      { role: 'assistant', content: '', tool_calls: [] },
      { role: 'tool', name: 'search_products', content: bulky },
      { role: 'user', content: 'e agora halteres?' },
      { role: 'assistant', content: '', tool_calls: [] },
      { role: 'tool', name: 'search_products', content: '{"ok":true}' },
    ]);

    const olderTool = compacted.find(
      (message) => message.role === 'tool' && message.content?.includes('truncated'),
    );
    const latestTool = compacted.at(-1);

    expect(olderTool?.content).toContain('"truncated":true');
    expect(olderTool?.content).not.toContain('x'.repeat(500));
    expect(latestTool).toEqual({
      role: 'tool',
      name: 'search_products',
      content: '{"ok":true}',
    });
  });
});
