import { ServiceUnavailableException } from '@nestjs/common';
import { OpenRouterService } from './openrouter.service';
import { PrismaService } from '../../shared/database/prisma.service';

describe('OpenRouterService', () => {
  let service: OpenRouterService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      aiCallLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };

    service = new OpenRouterService(mockPrisma as unknown as PrismaService);
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_API_URL;
    delete process.env.OPENROUTER_HTTP_REFERER;
    delete process.env.OPENROUTER_X_TITLE;
    jest.restoreAllMocks();
  });

  it('deve indicar isAvailable = false quando OPENROUTER_API_KEY não estiver definida', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(service.isAvailable).toBe(false);
  });

  it('deve indicar isAvailable = true quando OPENROUTER_API_KEY estiver configurada', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-token-key';
    expect(service.isAvailable).toBe(true);
  });

  it('deve lançar ServiceUnavailableException se chamado sem chave', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(
      service.chatCompletion([{ role: 'user', content: 'Olá' }]),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('deve executar requisição com sucesso e registrar em AiCallLog', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-token-key';
    process.env.OPENROUTER_MODEL = 'inclusionai/ling-3.0-flash-fin:free';
    process.env.OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
    process.env.OPENROUTER_HTTP_REFERER = 'http://localhost:4200';
    process.env.OPENROUTER_X_TITLE = 'Move Intelligence';

    const mockResponse = {
      id: 'chatcmpl-123',
      model: 'inclusionai/ling-3.0-flash-fin:free',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Análise de mercado fitness concluída.',
          },
        },
      ],
      usage: {
        prompt_tokens: 45,
        completion_tokens: 20,
        total_tokens: 65,
      },
    };

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce(mockResponse),
    } as any);

    const result = await service.chatCompletion(
      [{ role: 'user', content: 'Analise este produto fitness' }],
      { endpointName: 'test_endpoint' },
    );

    expect(result.content).toBe('Análise de mercado fitness concluída.');
    expect(result.model).toBe('inclusionai/ling-3.0-flash-fin:free');
    expect(result.usage?.totalTokens).toBe(65);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-test-token-key',
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:4200',
          'X-Title': 'Move Intelligence',
        }),
        body: expect.stringContaining('inclusionai/ling-3.0-flash-fin:free'),
      }),
    );
    expect(mockPrisma.aiCallLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endpoint: 'test_endpoint',
          status: 'SUCCESS',
          totalTokens: 65,
        }),
      }),
    );
  });

  it('usa timeoutMs das opções no AbortSignal', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-token-key';
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    });
    await service.chatCompletion([{ role: 'user', content: 'oi' }], { timeoutMs: 120_000 });
    expect(timeoutSpy).toHaveBeenCalledWith(120_000);
  });
});
