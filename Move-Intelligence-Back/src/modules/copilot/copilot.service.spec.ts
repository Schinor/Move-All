import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  CopilotService,
  COPILOT_UNAVAILABLE_REPLY,
  compactToolOutputs,
  MAX_HISTORY_MESSAGES,
  extractMentionedIds,
  collectToolProductRefs,
} from './copilot.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { OpenRouterService } from '../ai-gateway/openrouter.service';
import { DashboardApiService } from '../dashboard-api/dashboard-api.service';

describe('CopilotService', () => {
  let service: CopilotService;
  let mockPrisma: any;
  let mockOpenRouter: any;
  let mockDashboard: any;

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
      productScore: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
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

    mockDashboard = {
      listTrendingProducts: jest.fn().mockResolvedValue([]),
    };

    service = new CopilotService(
      mockPrisma as unknown as PrismaService,
      mockOpenRouter as unknown as OpenRouterService,
      mockDashboard as unknown as DashboardApiService,
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
        snapshots: [{ priceMin: 2499.0, marketplace: 'mercado_livre' }],
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

  describe('ferramentas de score', () => {
    it('não inventa move_score quando o cluster ainda não tem ProductScore', async () => {
      mockPrisma.productCluster.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          canonicalName: 'Kettlebell de Ferro Fundido 16kg',
          category: 'kettlebells',
          snapshots: [{ priceMin: 17.59, marketplace: '1688' }],
        },
      ]);

      const result: any = await (service as any).executeTool('search_products', {
        query: 'kettlebell',
      });

      expect(result.products[0].move_score).toBeNull();
      expect(result.products[0].data_confidence).toBeNull();
      expect(result.products[0]).not.toHaveProperty('financial_score');
      expect(result.products[0]).not.toHaveProperty('trend_score');
    });

    it('expõe o ranking com o Move Score oficial da tela', async () => {
      mockDashboard.listTrendingProducts.mockResolvedValueOnce([
        {
          product_cluster_id: 'b6ee4262',
          canonical_name: 'Kit Super Bands Elásticos de Resistência 4 Peças',
          category: 'resistance_bands',
          move_score: 82,
          decision: 'AVANCAR',
          data_confidence: 'suficiente',
          risk: 'alto',
          growth_pct: 12.5,
          stage: 'rising',
        },
      ]);

      const result: any = await (service as any).executeTool('get_product_ranking', { limit: 5 });

      expect(mockDashboard.listTrendingProducts).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'move_score', limit: 5 }),
      );
      expect(result.products[0]).toEqual(
        expect.objectContaining({
          name: 'Kit Super Bands Elásticos de Resistência 4 Peças',
          move_score: 82,
          decision: 'AVANCAR',
        }),
      );
    });

    it('ordena o ranking por growth quando solicitado e cai em move_score no inválido', async () => {
      await (service as any).executeTool('get_product_ranking', { sort: 'growth' });

      expect(mockDashboard.listTrendingProducts).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'growth' }),
      );

      await (service as any).executeTool('get_product_ranking', { sort: 'opportunity_score' });

      expect(mockDashboard.listTrendingProducts).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'move_score' }),
      );
    });

    it('informa quando o ranking está vazio em vez de devolver lista silenciosa', async () => {
      mockDashboard.listTrendingProducts.mockResolvedValueOnce([]);

      const result: any = await (service as any).executeTool('get_product_ranking', {});

      expect(result.products).toEqual([]);
      expect(String(result.note)).toMatch(/nenhum|sem/i);
    });

    it('C7: aceita filtro por action e teto 200 (sem teto de 50)', async () => {
      mockDashboard.listTrendingProducts.mockResolvedValueOnce([]);
      await (service as any).executeTool('get_product_ranking', { limit: 150, action: 'DECIDIR_AGORA', sort: 'momentum' });
      expect(mockDashboard.listTrendingProducts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 150, action: 'DECIDIR_AGORA', sort: 'momentum' }),
      );
    });
  });

  describe('pós-validação de grounding (C7)', () => {
    it('extrai UUIDs citados', () => {
      const id = '11111111-1111-4111-8111-111111111111';
      expect(extractMentionedIds(`veja ${id} aqui`)).toEqual([id]);
      expect(extractMentionedIds('sem id')).toEqual([]);
    });

    it('regressão da reunião: recomendado fora da lista → refaz e avisa', async () => {
      const listed = '11111111-1111-4111-8111-111111111111';
      const outside = '22222222-2222-4222-8222-222222222222';
      const messages: Array<{ role: 'tool'; content: string }> = [
        {
          role: 'tool',
          content: JSON.stringify({ products: [{ id: listed, name: 'Halter 24kg' }] }),
        },
      ];
      // Retry devolve texto ainda com ID fora → anexa aviso.
      mockOpenRouter.chatCompletion.mockResolvedValueOnce({ content: `Recomendo ${outside}`, model: 'm' });
      const fixed = await service.validateGroundedReply(messages as never, `Recomendo ${outside}`, 'conv-1');
      expect(fixed).toMatch(/Aviso/);
      expect(fixed).toContain(outside);
    });

    it('resposta grounded passa sem retry', async () => {
      const listed = '11111111-1111-4111-8111-111111111111';
      const messages: Array<{ role: 'tool'; content: string }> = [
        { role: 'tool', content: JSON.stringify({ products: [{ id: listed }] }) },
      ];
      const calls = mockOpenRouter.chatCompletion.mock.calls.length;
      const out = await service.validateGroundedReply(messages as never, `Recomendo ${listed}`, 'conv-1');
      expect(out).toContain(listed);
      expect(mockOpenRouter.chatCompletion.mock.calls.length).toBe(calls);
    });

    it('collectToolProductRefs lê ids e nomes', () => {
      const refs = collectToolProductRefs([
        { role: 'tool', content: JSON.stringify({ products: [{ id: 'a', name: 'Halter' }] }) },
      ] as never);
      expect(refs.ids.has('a')).toBe(true);
      expect(refs.names.has('halter')).toBe(true);
    });
  });

  describe('pseudo-tool-calls em texto (P0-3)', () => {
    const PRINT_MARKUP =
      '<tool_call>exec <argkey>query</argkey> <argvalue>SELECT column_name FROM information_schema.columns</arg_value> </tool_call>';

    it('(a) texto exato do print → sem markup na resposta e sem executar exec', async () => {
      mockOpenRouter.chatCompletion
        .mockResolvedValueOnce({ content: PRINT_MARKUP, toolCalls: undefined, model: 'm' })
        .mockResolvedValueOnce({ content: PRINT_MARKUP, toolCalls: undefined, model: 'm' });

      const result = await service.chat({
        messages: [{ role: 'user', content: 'qual o produto com maior Move Score?' }],
      });

      expect(result.reply).toBe(COPILOT_UNAVAILABLE_REPLY);
      expect(result.reply).not.toContain('<tool_call>');
      expect(result.reply).not.toContain('SELECT');
      expect(mockDashboard.listTrendingProducts).not.toHaveBeenCalled();
      const savedAssistant = (mockPrisma.aiMessage.create.mock.calls as any[])
        .map((call: any) => call[0]?.data)
        .find((data: any) => data?.role === 'assistant');
      expect(savedAssistant?.content).not.toContain('<tool_call>');
    });

    it('(b) pseudo-call com ferramenta válida → executa e responde', async () => {
      mockDashboard.listTrendingProducts.mockResolvedValueOnce([]);
      mockOpenRouter.chatCompletion
        .mockResolvedValueOnce({
          content: '<tool_call>get_product_ranking <argkey>limit</argkey> <argvalue>5</argvalue></tool_call>',
          toolCalls: undefined,
          model: 'm',
        })
        .mockResolvedValueOnce({ content: 'Nenhum produto no ranking.', toolCalls: undefined, model: 'm' });

      const result = await service.chat({
        messages: [{ role: 'user', content: 'top produtos?' }],
      });

      expect(mockDashboard.listTrendingProducts).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
      );
      expect(result.reply).toContain('Nenhum produto no ranking.');
      expect(result.tool_calls_executed).toBe(1);
    });

    it('(c) stream vazio → fecha com done e mensagem de erro amigável salva', async () => {
      mockOpenRouter.chatCompletion.mockResolvedValueOnce({ content: '', toolCalls: undefined, model: 'm' });
      mockOpenRouter.chatStream = jest.fn().mockImplementation(async function* () {
        // gerador vazio: fecha sem tokens e sem erro
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: 'user', content: 'ola' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.at(-1)).toEqual(
        expect.objectContaining({ done: true, conversation_id: 'conv-123' }),
      );
      const savedAssistant = (mockPrisma.aiMessage.create.mock.calls as any[])
        .map((call: any) => call[0]?.data)
        .find((data: any) => data?.role === 'assistant');
      expect(savedAssistant?.content).toBe(COPILOT_UNAVAILABLE_REPLY);
    });

    it('(c2) stream que trava → timeout configurável e mensagem amigável', async () => {
      process.env.COPILOT_STREAM_TIMEOUT_MS = '30';
      mockOpenRouter.chatCompletion.mockResolvedValueOnce({ content: '', toolCalls: undefined, model: 'm' });
      mockOpenRouter.chatStream = jest.fn().mockImplementation(async function* () {
        await new Promise(() => undefined); // nunca resolve
        yield 'x';
      });

      try {
        const chunks: unknown[] = [];
        for await (const chunk of service.chatStream({
          messages: [{ role: 'user', content: 'ola' }],
        })) {
          chunks.push(chunk);
        }
        expect(chunks.at(-1)).toEqual(expect.objectContaining({ done: true }));
        const savedAssistant = (mockPrisma.aiMessage.create.mock.calls as any[])
          .map((call: any) => call[0]?.data)
          .find((data: any) => data?.role === 'assistant');
        expect(savedAssistant?.content).toBe(COPILOT_UNAVAILABLE_REPLY);
      } finally {
        delete process.env.COPILOT_STREAM_TIMEOUT_MS;
      }
    });
  });

  describe('stream independente da conexão (P0-5)', () => {
    function mockToolCheck() {
      mockOpenRouter.chatCompletion.mockResolvedValueOnce({ content: '', toolCalls: undefined, model: 'm' });
    }

    it('(a) cliente desconecta no meio → parcial gerado é salvo', async () => {
      mockToolCheck();
      mockOpenRouter.chatStream = jest.fn().mockImplementation(async function* () {
        yield 'Olá ';
        yield 'mundo';
      });

      const gen = service.chatStream({ messages: [{ role: 'user', content: 'ola' }] });
      const first = await gen.next();
      expect(first.value).toEqual(expect.objectContaining({ token: 'Olá ' }));
      await gen.return?.(undefined); // cliente foi embora

      const savedAssistant = (mockPrisma.aiMessage.create.mock.calls as any[])
        .map((call: any) => call[0]?.data)
        .find((data: any) => data?.role === 'assistant');
      expect(savedAssistant?.content).toBe('Olá');
    });

    it('(b) erro do provedor no meio → salva o parcial e fecha com done', async () => {
      mockToolCheck();
      mockOpenRouter.chatStream = jest.fn().mockImplementation(async function* () {
        yield 'Parcial ';
        throw new Error('provider boom');
      });

      const chunks: unknown[] = [];
      for await (const chunk of service.chatStream({
        messages: [{ role: 'user', content: 'ola' }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks.at(-1)).toEqual(expect.objectContaining({ done: true }));
      const savedAssistant = (mockPrisma.aiMessage.create.mock.calls as any[])
        .map((call: any) => call[0]?.data)
        .find((data: any) => data?.role === 'assistant');
      expect(savedAssistant?.content).toBe('Parcial');
    });
  });
  describe('busca que não para no meio (1+2+3)', () => {
    const bike = {
      id: 'bike-1',
      canonicalName: 'Bicicleta Ergométrica Spinning',
      category: 'spinning_bike',
      snapshots: [],
    };
    const savedAssistant = () =>
      (mockPrisma.aiMessage.create.mock.calls as any[])
        .map((call: any) => call[0]?.data)
        .find((data: any) => data?.role === 'assistant');

    it('(1) stream encadeia rodadas: busca vazia → nova busca → resposta, sem stream extra', async () => {
      mockPrisma.productCluster.findMany
        .mockResolvedValueOnce([]) // "xyz" por nome
        .mockResolvedValueOnce([]) // categorias disponíveis
        .mockResolvedValueOnce([bike]); // "bicicleta" por nome
      mockOpenRouter.chatCompletion
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search_products', arguments: '{"query":"xyz"}' } }],
          model: 'm',
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: 'c2', type: 'function', function: { name: 'search_products', arguments: '{"query":"bicicleta"}' } }],
          model: 'm',
        })
        .mockResolvedValueOnce({ content: 'Encontrei a Bicicleta Ergométrica Spinning.', toolCalls: undefined, model: 'm' });
      mockOpenRouter.chatStream = jest.fn();

      const chunks: any[] = [];
      for await (const chunk of service.chatStream({ messages: [{ role: 'user', content: 'pernas?' }] })) {
        chunks.push(chunk);
      }

      const text = chunks.map((chunk) => chunk.token ?? '').join('');
      expect(text).toBe('Encontrei a Bicicleta Ergométrica Spinning.');
      expect(chunks.at(-1)).toEqual(expect.objectContaining({ done: true }));
      expect(mockOpenRouter.chatCompletion).toHaveBeenCalledTimes(3);
      expect(mockOpenRouter.chatStream).not.toHaveBeenCalled();
      expect(savedAssistant()?.content).toBe('Encontrei a Bicicleta Ergométrica Spinning.');
    });

    it('(3) "Vou ampliar a busca" sem ferramenta é cobrado e vira chamada real', async () => {
      mockPrisma.productCluster.findMany.mockResolvedValueOnce([bike]);
      mockOpenRouter.chatCompletion
        .mockResolvedValueOnce({
          content: 'Sem resultados com esses termos. Vou ampliar a busca para outros equipamentos de pernas.',
          toolCalls: undefined,
          model: 'm',
        })
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [{ id: 'c1', type: 'function', function: { name: 'search_products', arguments: '{"query":"bicicleta"}' } }],
          model: 'm',
        })
        .mockResolvedValueOnce({ content: 'Encontrei a Bicicleta Ergométrica Spinning.', toolCalls: undefined, model: 'm' });

      const result = await service.chat({ messages: [{ role: 'user', content: 'Tem algum produto para as pernas?' }] });

      expect(result.reply).toContain('Bicicleta Ergométrica Spinning');
      expect(result.reply).not.toContain('Vou ampliar');
      expect(result.tool_calls_executed).toBe(1);
      const secondCallMessages = mockOpenRouter.chatCompletion.mock.calls[1][0] as Array<{ role: string; content: string }>;
      expect(secondCallMessages.some((m) => m.role === 'system' && m.content.includes('anunciou'))).toBe(true);
    });

    it('(3) sem rodadas restantes, a promessa nunca é a resposta final', async () => {
      const promise = { content: 'Vou ampliar a busca para outros equipamentos.', toolCalls: undefined, model: 'm' };
      mockOpenRouter.chatCompletion
        .mockResolvedValueOnce(promise)
        .mockResolvedValueOnce(promise)
        .mockResolvedValueOnce(promise)
        .mockResolvedValueOnce(promise);

      const result = await service.chat({ messages: [{ role: 'user', content: 'pernas?' }] });

      expect(result.reply).not.toContain('Vou ampliar');
      expect(result.reply).toMatch(/Não encontrei produtos/);
    });

    it('(1) rodadas demoradas mandam batimento para o front não desistir', async () => {
      process.env.COPILOT_STREAM_HEARTBEAT_MS = '10';
      mockOpenRouter.chatCompletion.mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ content: 'Resposta após consulta lenta.', toolCalls: undefined, model: 'm' }), 45),
          ),
      );
      try {
        const chunks: any[] = [];
        for await (const chunk of service.chatStream({ messages: [{ role: 'user', content: 'ola' }] })) {
          chunks.push(chunk);
        }
        const firstToken = chunks.findIndex((chunk) => chunk.token);
        const heartbeats = chunks.slice(0, firstToken).filter((chunk) => !chunk.token && !chunk.done);
        expect(heartbeats.length).toBeGreaterThan(0);
        expect(heartbeats[0]).toEqual({ conversation_id: 'conv-123' });
        expect(chunks.map((chunk) => chunk.token ?? '').join('')).toBe('Resposta após consulta lenta.');
      } finally {
        delete process.env.COPILOT_STREAM_HEARTBEAT_MS;
      }
    });

    it('(2) search_products entende "pernas" por sinônimos', async () => {
      mockPrisma.productCluster.findMany
        .mockResolvedValueOnce([]) // pergunta literal
        .mockResolvedValueOnce([]) // palavra "perna"
        .mockResolvedValueOnce([bike]); // sinônimos + categorias

      const result: any = await (service as any).executeTool('search_products', {
        query: 'Tem algum produto para as pernas?',
      });

      expect(result.matched_by).toBe('sinonimos');
      expect(result.interpreted_as).toEqual(['perna']);
      expect(result.products[0].name).toBe('Bicicleta Ergométrica Spinning');
      const synonymWhere = mockPrisma.productCluster.findMany.mock.calls[2][0].where;
      expect(JSON.stringify(synonymWhere)).toContain('spinning_bike');
    });

    it('(2) sem resultado devolve categorias disponíveis em vez de lista vazia muda', async () => {
      mockPrisma.productCluster.findMany
        .mockResolvedValueOnce([]) // "xyz" por nome
        .mockResolvedValueOnce([{ category: 'yoga_mat' }, { category: 'dumbbells' }]);

      const result: any = await (service as any).executeTool('search_products', { query: 'xyz' });

      expect(result.products).toEqual([]);
      expect(result.available_categories).toEqual(['dumbbells', 'yoga_mat']);
      expect(String(result.note)).toMatch(/Não prometa/);
    });
  });
});
