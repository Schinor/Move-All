import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { environment } from '../../../environments/environment';
import {
  CopilotChatRequest,
  CopilotChatResponse,
  CopilotConversationDetail,
  CopilotConversationSummary,
  CopilotConversationUpdate,
} from '../models/contract.models';

const CLIENT_ID_KEY = 'move-intelligence:copilot-client-id';
const ACTIVE_CONVERSATION_KEY = 'move-intelligence:copilot-active-conversation';

@Injectable({ providedIn: 'root' })
export class CopilotService {
  private readonly api = inject(ApiClient);
  private readonly clientId = this.getOrCreateClientId();

  chat(request: CopilotChatRequest): Observable<CopilotChatResponse> {
    return this.api.post<CopilotChatResponse>('/copilot/chat', this.withClientContext(request));
  }

  listConversations(): Observable<CopilotConversationSummary[]> {
    return this.api.get<CopilotConversationSummary[]>('/copilot/conversations', {
      client_id: this.clientId,
    });
  }

  getConversation(id: string): Observable<CopilotConversationDetail> {
    return this.api.get<CopilotConversationDetail>(`/copilot/conversations/${id}`, {
      client_id: this.clientId,
    });
  }

  deleteConversation(id: string): Observable<{ deleted: boolean; conversationId: string }> {
    return this.api.delete<{ deleted: boolean; conversationId: string }>(
      `/copilot/conversations/${id}`,
      { client_id: this.clientId },
    );
  }

  updateConversation(
    id: string,
    changes: CopilotConversationUpdate,
  ): Observable<CopilotConversationSummary> {
    return this.api.patch<CopilotConversationSummary>(
      `/copilot/conversations/${id}`,
      changes,
      { client_id: this.clientId },
    );
  }

  getRememberedConversationId(): string | undefined {
    try {
      return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY) || undefined;
    } catch {
      return undefined;
    }
  }

  rememberConversation(id: string): void {
    try {
      window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    } catch {
      // A conversa continua persistida no banco mesmo quando o armazenamento local está indisponível.
    }
  }

  clearRememberedConversation(): void {
    try {
      window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    } catch {
      // Ignore falhas de armazenamento local.
    }
  }

  async chatStream(
    request: CopilotChatRequest,
    onToken: (token: string) => void,
    onConversationId?: (id: string) => void,
  ): Promise<string> {
    const response = await fetch(`${environment.apiBaseUrl}/copilot/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.withClientContext(request)),
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

  private withClientContext(request: CopilotChatRequest): CopilotChatRequest {
    return { ...request, clientId: this.clientId };
  }

  private getOrCreateClientId(): string {
    try {
      const stored = window.localStorage.getItem(CLIENT_ID_KEY)?.trim();
      if (stored) return stored;

      const generated = this.generateClientId();
      window.localStorage.setItem(CLIENT_ID_KEY, generated);
      return generated;
    } catch {
      return this.generateClientId();
    }
  }

  private generateClientId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
