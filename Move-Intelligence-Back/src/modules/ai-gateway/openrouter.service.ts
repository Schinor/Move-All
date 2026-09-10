// OpenRouter gateway for the Move AI provider.
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenRouterChatOptions {
  endpointName?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: { type: 'json_object' };
  tools?: ChatTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  metadata?: Record<string, unknown>;
}

export interface OpenRouterChatResponse {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
}

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly defaultApiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly defaultModel = 'inclusionai/ling-3.0-flash-fin:free';

  constructor(private readonly prisma: PrismaService) {}

  get apiKey(): string | undefined {
    return process.env.OPENROUTER_API_KEY;
  }

  get isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Executa uma chamada de chat completion à API do OpenRouter com retry,
   * timeout e registro em AiCallLog.
   */
  async chatCompletion(
    messages: ChatMessage[],
    options: OpenRouterChatOptions = {},
  ): Promise<OpenRouterChatResponse> {
    if (!this.isAvailable) {
      throw new ServiceUnavailableException(
        'OPENROUTER_API_KEY não configurada no servidor Move.',
      );
    }

    const endpointName = options.endpointName ?? 'chat_completion';
    const model = options.model ?? process.env.OPENROUTER_MODEL ?? this.defaultModel;
    const apiUrl = process.env.OPENROUTER_API_URL ?? this.defaultApiUrl;
    const maxRetries = 2;

    // Keep the request body compatible with OpenRouter's OpenAI-compatible API.
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.topP !== undefined) {
      requestBody.top_p = options.topP;
    }

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice ?? 'auto';
    }

    if (options.responseFormat) {
      requestBody.response_format = options.responseFormat;
    }

    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: this.requestHeaders(),
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(35_000),
        });

        const latencyMs = Date.now() - attemptStart;

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          const errorMsg = `OpenRouter API HTTP ${response.status}: ${errorBody.slice(0, 500)}`;
          
          if (attempt <= maxRetries && response.status >= 500) {
            this.logger.warn(`OpenRouter tentativa ${attempt} falhou (${response.status}). Retentando...`);
            await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
            continue;
          }

          await this.logCall({
            endpoint: endpointName,
            model,
            latencyMs,
            status: 'ERROR',
            error: errorMsg,
            metadata: options.metadata,
          });

          throw new ServiceUnavailableException(`Falha na API do OpenRouter: ${errorMsg}`);
        }

        const data = (await response.json()) as {
          id?: string;
          model?: string;
          choices?: Array<{
            message?: {
              role?: string;
              content?: string | null;
              tool_calls?: Array<{
                id: string;
                type: 'function';
                function: {
                  name: string;
                  arguments: string;
                };
              }>;
            };
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const choice = data.choices?.[0];
        const message = choice?.message;
        const promptTokens = data.usage?.prompt_tokens;
        const completionTokens = data.usage?.completion_tokens;
        const totalTokens = data.usage?.total_tokens;

        await this.logCall({
          endpoint: endpointName,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          latencyMs,
          status: 'SUCCESS',
          metadata: options.metadata,
        });

        return {
          content: message?.content?.trim() ?? null,
          toolCalls: message?.tool_calls,
          model: data.model ?? model,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens,
          },
          latencyMs,
        };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt <= maxRetries) {
          this.logger.warn(`Erro na tentativa ${attempt} contra OpenRouter: ${lastError.message}. Retentando...`);
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    }

    const totalLatency = Date.now() - startTime;
    await this.logCall({
      endpoint: endpointName,
      model,
      latencyMs: totalLatency,
      status: 'ERROR',
      error: lastError?.message ?? 'Unknown timeout/network error',
      metadata: options.metadata,
    });

    throw new ServiceUnavailableException(
      `Move AI / OpenRouter indisponível após retentativas: ${lastError?.message}`,
    );
  }

  /**
   * Executa uma chamada de chat completion em streaming (SSE) à API do OpenRouter.
   */
  async *chatStream(
    messages: ChatMessage[],
    options: OpenRouterChatOptions = {},
  ): AsyncGenerator<string, void, unknown> {
    if (!this.isAvailable) {
      throw new ServiceUnavailableException('OPENROUTER_API_KEY não configurada no servidor Move.');
    }

    const model = options.model ?? process.env.OPENROUTER_MODEL ?? this.defaultModel;
    const apiUrl = process.env.OPENROUTER_API_URL ?? this.defaultApiUrl;

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new ServiceUnavailableException(`OpenRouter stream error (${response.status}): ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') return;

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        } catch {
          // Ignora fragmentos parciais
        }
      }
    }
  }

  private async logCall(params: {
    endpoint: string;
    model: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    status: 'SUCCESS' | 'ERROR';
    error?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.aiCallLog.create({
        data: {
          endpoint: params.endpoint,
          model: params.model,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          totalTokens: params.totalTokens,
          latencyMs: params.latencyMs,
          status: params.status,
          error: params.error,
          metadata: (params.metadata as unknown as object) ?? undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao registrar log da chamada OpenRouter: ${err}`);
    }
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (process.env.OPENROUTER_HTTP_REFERER) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
    }
    if (process.env.OPENROUTER_X_TITLE) {
      headers['X-Title'] = process.env.OPENROUTER_X_TITLE;
    }

    return headers;
  }
}
