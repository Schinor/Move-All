import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { CopilotService } from '../../core/services/copilot.service';
import { CopilotChatMessage } from '../../core/models/contract.models';

interface SuggestionPrompt {
  label: string;
  query: string;
}

@Component({
  selector: 'app-ai-copilot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeaderComponent, IconComponent],
  templateUrl: './ai-copilot.component.html',
  styleUrl: './ai-copilot.component.css',
})
export class AiCopilotComponent {
  private readonly copilot = inject(CopilotService);

  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  readonly available = true;
  readonly messages = signal<CopilotChatMessage[]>([]);
  readonly inputMessage = signal('');
  readonly isThinking = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly conversationId = signal<string | undefined>(undefined);

  readonly suggestions: SuggestionPrompt[] = [
    {
      label: 'Esteiras de Alta Oportunidade',
      query: 'Quais são os modelos de esteira ou walking pad com maior Opportunity Score no catálogo?',
    },
    {
      label: 'Fornecedores de Anilhas & Halteres',
      query: 'Quais fornecedores internacionais possuem mais registros de exportação para equipamentos de musculação?',
    },
    {
      label: 'Sinais de Demanda Recentes',
      query: 'Quais produtos e palavras-chave de fitness apresentaram maior aceleração de busca recentemente?',
    },
    {
      label: 'Status de Coletas e Scrapers',
      query: 'Qual é o status das últimas coletas de dados e pipelines de inteligência em execução?',
    },
  ];

  async sendMessage(textToSend?: string): Promise<void> {
    const raw = textToSend ?? this.inputMessage();
    const query = raw.trim();
    if (!query || this.isThinking()) return;

    this.errorMessage.set(null);
    this.inputMessage.set('');

    const userMessage: CopilotChatMessage = {
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const currentHistory = this.messages();
    this.messages.set([...currentHistory, userMessage]);
    this.isThinking.set(true);
    this.scrollToBottom();

    // Payload de mensagens históricas para manter contexto
    const messagesPayload = [...currentHistory, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Cria placeholder para mensagem do assistente em streaming
    const assistantIndex = this.messages().length;
    let assistantMessage: CopilotChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    try {
      let isFirstToken = true;
      await this.copilot.chatStream(
        {
          messages: messagesPayload,
          conversationId: this.conversationId(),
        },
        (token) => {
          if (isFirstToken) {
            this.isThinking.set(false);
            isFirstToken = false;
            this.messages.update((msgs) => [...msgs, assistantMessage]);
          }
          assistantMessage = {
            ...assistantMessage,
            content: assistantMessage.content + token,
          };
          this.messages.update((msgs) => {
            const updated = [...msgs];
            updated[assistantIndex] = assistantMessage;
            return updated;
          });
          this.scrollToBottom();
        },
        (convId) => {
          this.conversationId.set(convId);
        },
      );
      this.isThinking.set(false);
      this.scrollToBottom();
    } catch (err: any) {
      this.isThinking.set(false);
      const errorDetail =
        err?.error?.message ??
        err?.message ??
        'Não foi possível obter resposta do Move AI Copilot neste momento.';
      this.errorMessage.set(errorDetail);
      this.scrollToBottom();
    }
  }

  useSuggestion(suggestion: SuggestionPrompt): void {
    this.sendMessage(suggestion.query);
  }

  clearConversation(): void {
    this.messages.set([]);
    this.conversationId.set(undefined);
    this.errorMessage.set(null);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.messagesContainer?.nativeElement) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 50);
  }
}

