import { ServiceUnavailableException } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NvidiaService } from '../ai-gateway/nvidia.service';
import { TrendEngineService } from '../trend-engine/trend-engine.service';
import { OpportunityEngineService } from '../opportunity-engine/opportunity-engine.service';

describe('CopilotService', () => {
  let service: CopilotService;
  let mockPrisma: any;
  let mockNvidia: any;
  let mockTrendEngine: any;
  let mockOpportunityEngine: any;

  beforeEach(() => {
    mockPrisma = {
      aiConversation: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'conv-123' }),
      },
      aiMessage: {
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
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

    mockNvidia = {
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
      mockNvidia as unknown as NvidiaService,
      mockTrendEngine as unknown as TrendEngineService,
      mockOpportunityEngine as unknown as OpportunityEngineService,
    );
  });

  it('deve lançar ServiceUnavailableException quando a chave NVIDIA não estiver configurada', async () => {
    mockNvidia.isAvailable = false;

    await expect(
      service.chat({
        messages: [{ role: 'user', content: 'Olá, quais são as melhores esteiras?' }],
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('deve processar uma resposta direta do Copilot e salvar histórico', async () => {
    mockNvidia.chatCompletion.mockResolvedValueOnce({
      content: 'As melhores esteiras no catálogo possuem Opportunity Score acima de 80.',
      toolCalls: undefined,
      model: 'z-ai/glm-5.2',
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
    mockNvidia.chatCompletion.mockResolvedValueOnce({
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
      model: 'z-ai/glm-5.2',
      latencyMs: 400,
    });

    // 2ª chamada: modelo recebe os dados e gera o parecer final
    mockNvidia.chatCompletion.mockResolvedValueOnce({
      content:
        'Encontrei a Esteira Ergométrica Dobrável Pro com risco baixo e preço médio de R$ 2.499 no Mercado Livre.',
      toolCalls: undefined,
      model: 'z-ai/glm-5.2',
      latencyMs: 510,
    });

    const result = await service.chat({
      messages: [{ role: 'user', content: 'Busque esteiras disponíveis' }],
    });

    expect(result.tool_calls_executed).toBe(1);
    expect(result.reply).toContain('Esteira Ergométrica Dobrável Pro');
    expect(mockPrisma.productCluster.findMany).toHaveBeenCalled();
  });
});
