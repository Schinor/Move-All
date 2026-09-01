import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { CopilotChatRequest, CopilotChatResponse } from '../models/contract.models';

@Injectable({ providedIn: 'root' })
export class CopilotService {
  private readonly api = inject(ApiClient);

  chat(request: CopilotChatRequest): Observable<CopilotChatResponse> {
    return this.api.post<CopilotChatResponse>('/copilot/chat', request);
  }

  async chatStream(
    request: CopilotChatRequest,
    onToken: (token: string) => void,
    onConversationId?: (id: string) => void,
  ): Promise<string> {
    const response = await fetch('/api/copilot/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') {
          return fullText;
        }
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.conversation_id && onConversationId) {
            onConversationId(parsed.conversation_id);
          }
          if (parsed.token) {
            fullText += parsed.token;
            onToken(parsed.token);
          }
          if (parsed.done) {
            return fullText;
          }
        } catch {
          // Fragmentos parciais ignorados
        }
      }
    }
    return fullText;
  }
}
