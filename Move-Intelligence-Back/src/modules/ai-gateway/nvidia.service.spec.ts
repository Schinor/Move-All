import { ServiceUnavailableException } from '@nestjs/common';
import { NvidiaService } from './nvidia.service';
import { PrismaService } from '../../shared/database/prisma.service';

describe('NvidiaService', () => {
  let service: NvidiaService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      aiCallLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    };

    service = new NvidiaService(mockPrisma as unknown as PrismaService);
  });

  afterEach(() => {
    delete process.env.NVIDIA_API_KEY;
    jest.restoreAllMocks();
  });

  it('deve indicar isAvailable = false quando NVIDIA_API_KEY não estiver definida', () => {
    delete process.env.NVIDIA_API_KEY;
    expect(service.isAvailable).toBe(false);
  });

  it('deve indicar isAvailable = true quando NVIDIA_API_KEY estiver configurada', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test-token-key';
    expect(service.isAvailable).toBe(true);
  });

  it('deve lançar ServiceUnavailableException se chamado sem chave', async () => {
    delete process.env.NVIDIA_API_KEY;
    await expect(
      service.chatCompletion([{ role: 'user', content: 'Olá' }]),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('deve executar requisição com sucesso e registrar em AiCallLog', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-test-token-key';

    const mockResponse = {
      id: 'chatcmpl-123',
      model: 'z-ai/glm-5.2',
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
    expect(result.model).toBe('z-ai/glm-5.2');
    expect(result.usage?.totalTokens).toBe(65);
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
});
