import { Injectable, inject, signal } from '@angular/core';
import { CopilotService } from './copilot.service';
import { CopilotChatRequest } from '../models/contract.models';

export type CopilotStreamStatus = 'idle' | 'thinking' | 'streaming' | 'error';

export interface CopilotStreamEntry {
  status: CopilotStreamStatus;
  partialContent: string;
  error: string | null;
  startedAt: number;
  /** Incrementado a cada conclusão: quem voltou de outra tela recarrega do banco. */
  version: number;
}

export interface CopilotStreamOutcome {
  ok: boolean;
  error?: string;
}

const EMPTY_ENTRY: CopilotStreamEntry = {
  status: 'idle',
  partialContent: '',
  error: null,
  startedAt: 0,
  version: 0,
};

/**
 * P0-5: o stream vive fora do componente, indexado por conversa.
 *
 * - Trocar de conversa ou sair da tela não mexe no stream da outra conversa;
 * - voltar mostra os tokens em andamento ou recarrega a resposta salva;
 * - só o botão "Parar" cancela (navegação nunca cancela);
 * - uma pergunta por conversa (a guarda é por chave, não global).
 */
@Injectable({ providedIn: 'root' })
export class CopilotStreamStore {
  private readonly copilot = inject(CopilotService);
  private readonly controllers = new Map<string, AbortController>();
  private readonly states = signal(new Map<string, CopilotStreamEntry>());

  stateFor(key: string): CopilotStreamEntry {
    return this.states().get(key) ?? EMPTY_ENTRY;
  }

  isBusy(key: string): boolean {
    const status = this.stateFor(key).status;
    return status === 'thinking' || status === 'streaming';
  }

  async run(options: {
    key: string;
    request: CopilotChatRequest;
    onConversationId?: (id: string) => void;
  }): Promise<CopilotStreamOutcome> {
    const { key, request, onConversationId } = options;
    if (this.isBusy(key)) return { ok: false, error: 'Já há uma resposta em andamento nesta conversa.' };

    const controller = new AbortController();
    this.controllers.set(key, controller);
    this.patch(key, { status: 'thinking', partialContent: '', error: null, startedAt: Date.now() });
    // A chave muda quando chega o conversationId real (conversa nova).
    let activeKey = key;

    try {
      await this.copilot.chatStream(
        request,
        (token) => {
          this.patch(activeKey, (entry) => ({
            status: 'streaming' as const,
            partialContent: entry.partialContent + token,
          }));
        },
        (id) => {
          this.rekey(activeKey, id);
          activeKey = id;
          onConversationId?.(id);
        },
        { signal: controller.signal },
      );
      this.finish(activeKey);
      return { ok: true };
    } catch (err) {
      if (controller.signal.aborted) {
        // Parado pelo botão: volta a aceitar pergunta, sem erro na tela.
        this.patch(activeKey, { status: 'idle', partialContent: '', error: null });
        return { ok: false, error: '' };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.patch(activeKey, { status: 'error', error: message || 'Falha na geração.' });
      return { ok: false, error: message };
    } finally {
      if (this.controllers.get(activeKey) === controller) this.controllers.delete(activeKey);
      this.controllers.delete(key);
    }
  }

  /** Botão "Parar": cancela a geração desta conversa (o backend salva o parcial). */
  abort(key: string): void {
    this.controllers.get(key)?.abort();
  }

  /** Migra o stream de uma chave temporária para o conversationId real. */
  rekey(oldKey: string, newKey: string): void {
    if (oldKey === newKey) return;
    const controller = this.controllers.get(oldKey);
    if (controller) {
      this.controllers.delete(oldKey);
      this.controllers.set(newKey, controller);
    }
    this.states.update((states) => {
      const next = new Map(states);
      const entry = next.get(oldKey);
      if (entry) {
        next.delete(oldKey);
        next.set(newKey, entry);
      }
      return next;
    });
  }

  private finish(key: string): void {
    this.states.update((states) => {
      const next = new Map(states);
      const entry = next.get(key) ?? EMPTY_ENTRY;
      next.set(key, { ...entry, status: 'idle', partialContent: '', version: entry.version + 1 });
      return next;
    });
  }

  private patch(key: string, partial: Partial<CopilotStreamEntry> | ((entry: CopilotStreamEntry) => Partial<CopilotStreamEntry>)): void {
    this.states.update((states) => {
      const next = new Map(states);
      const entry = next.get(key) ?? { ...EMPTY_ENTRY };
      next.set(key, { ...entry, ...(typeof partial === 'function' ? partial(entry) : partial) });
      return next;
    });
  }
}
