import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { CopilotService } from '../../core/services/copilot.service';
import {
  CopilotChatMessage,
  CopilotConversationDetail,
  CopilotConversationSummary,
} from '../../core/models/contract.models';
import { renderCopilotMarkdown } from '../../shared/utils/markdown.util';

interface SuggestionPrompt {
  label: string;
  query: string;
}

const CONVERSATION_SIDEBAR_OPEN_KEY = 'move-intelligence:copilot-sidebar-open';

/** Folga em px para considerar que o usuário ainda está acompanhando o fim da conversa. */
const SCROLL_STICK_THRESHOLD_PX = 120;

@Component({
  selector: 'app-ai-copilot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeaderComponent, IconComponent],
  templateUrl: './ai-copilot.component.html',
  styleUrl: './ai-copilot.component.css',
})
export class AiCopilotComponent implements OnInit {
  private readonly copilot = inject(CopilotService);
  private readonly injector = inject(Injector);

  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  readonly available = true;
  readonly messages = signal<CopilotChatMessage[]>([]);
  readonly inputMessage = signal('');
  readonly isThinking = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly conversationId = signal<string | undefined>(undefined);
  readonly conversations = signal<CopilotConversationSummary[]>([]);
  readonly isLoadingConversations = signal(false);
  readonly conversationError = signal<string | null>(null);
  readonly openingConversationId = signal<string | null>(null);
  readonly deletingConversationId = signal<string | null>(null);
  readonly editingConversationId = signal<string | null>(null);
  readonly editingTitle = signal('');
  readonly savingConversationId = signal<string | null>(null);
  readonly isConversationSidebarOpen = signal(this.readConversationSidebarOpen());
  readonly sortedConversations = computed(() =>
    [...this.conversations()].sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      return this.toTimestamp(right.updatedAt) - this.toTimestamp(left.updatedAt);
    }),
  );

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

  ngOnInit(): void {
    void this.loadConversations();
  }

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
    this.scrollToBottom(true);

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
          this.copilot.rememberConversation(convId);
        },
      );
      this.isThinking.set(false);
      void this.refreshConversationList();
      this.scrollToBottom();
    } catch (err: any) {
      this.isThinking.set(false);
      const errorDetail =
        err?.error?.message ??
        err?.message ??
        'Não foi possível obter resposta do Move AI Copilot neste momento.';
      this.errorMessage.set(errorDetail);
      void this.refreshConversationList();
      this.scrollToBottom(true);
    }
  }

  useSuggestion(suggestion: SuggestionPrompt): void {
    this.sendMessage(suggestion.query);
  }

  clearConversation(): void {
    this.messages.set([]);
    this.conversationId.set(undefined);
    this.copilot.clearRememberedConversation();
    this.errorMessage.set(null);
  }

  toggleConversationSidebar(): void {
    const isOpen = !this.isConversationSidebarOpen();
    this.isConversationSidebarOpen.set(isOpen);
    try {
      window.localStorage.setItem(CONVERSATION_SIDEBAR_OPEN_KEY, String(isOpen));
    } catch {
      // A preferência visual continua válida apenas nesta sessão quando o storage está indisponível.
    }
  }

  async openConversation(id: string): Promise<void> {
    if (this.isThinking() || this.openingConversationId() === id) return;

    this.openingConversationId.set(id);
    this.conversationError.set(null);
    try {
      const conversation = await firstValueFrom(this.copilot.getConversation(id));
      this.applyConversation(conversation);
      this.copilot.rememberConversation(id);
      this.errorMessage.set(null);
      this.scrollToBottom(true);
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível carregar esta conversa.'));
    } finally {
      this.openingConversationId.set(null);
    }
  }

  async deleteConversation(conversation: CopilotConversationSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.isThinking() || this.deletingConversationId() === conversation.id) return;

    const confirmed = window.confirm(`Excluir a conversa “${conversation.title}”?`);
    if (!confirmed) return;

    this.deletingConversationId.set(conversation.id);
    this.conversationError.set(null);
    try {
      await firstValueFrom(this.copilot.deleteConversation(conversation.id));
      this.conversations.update((items) => items.filter((item) => item.id !== conversation.id));
      if (this.conversationId() === conversation.id) {
        this.clearConversation();
      }
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível excluir esta conversa.'));
    } finally {
      this.deletingConversationId.set(null);
    }
  }

  startRenameConversation(conversation: CopilotConversationSummary, event: Event): void {
    event.stopPropagation();
    if (this.isThinking() || this.savingConversationId() !== null) return;
    this.conversationError.set(null);
    this.editingConversationId.set(conversation.id);
    this.editingTitle.set(conversation.title);
  }

  cancelRename(event?: Event): void {
    event?.stopPropagation();
    this.editingConversationId.set(null);
    this.editingTitle.set('');
  }

  async saveConversationTitle(conversation: CopilotConversationSummary, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.savingConversationId() === conversation.id) return;

    const title = this.editingTitle().trim();
    if (!title) {
      this.conversationError.set('Digite um nome para a conversa.');
      return;
    }
    if (title === conversation.title) {
      this.cancelRename();
      return;
    }

    this.savingConversationId.set(conversation.id);
    this.conversationError.set(null);
    try {
      const updated = await firstValueFrom(
        this.copilot.updateConversation(conversation.id, { title }),
      );
      this.replaceConversation(updated);
      this.cancelRename();
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível renomear esta conversa.'));
    } finally {
      this.savingConversationId.set(null);
    }
  }

  async togglePinned(conversation: CopilotConversationSummary, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.isThinking() || this.savingConversationId() === conversation.id) return;

    this.savingConversationId.set(conversation.id);
    this.conversationError.set(null);
    try {
      const updated = await firstValueFrom(
        this.copilot.updateConversation(conversation.id, { isPinned: !conversation.isPinned }),
      );
      this.replaceConversation(updated);
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível atualizar a conversa fixada.'));
    } finally {
      this.savingConversationId.set(null);
    }
  }

  formatConversationDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  renderMarkdown(content: string): string {
    return renderCopilotMarkdown(content);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private async loadConversations(): Promise<void> {
    this.isLoadingConversations.set(true);
    this.conversationError.set(null);
    try {
      const conversations = await firstValueFrom(this.copilot.listConversations());
      this.conversations.set(conversations);

      const rememberedId = this.copilot.getRememberedConversationId();
      const targetId =
        (rememberedId && conversations.some((conversation) => conversation.id === rememberedId)
          ? rememberedId
          : conversations[0]?.id) ?? undefined;

      if (targetId) {
        await this.openConversation(targetId);
      } else {
        this.messages.set([]);
        this.conversationId.set(undefined);
      }
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível carregar o histórico de conversas.'));
    } finally {
      this.isLoadingConversations.set(false);
    }
  }

  private async refreshConversationList(): Promise<void> {
    try {
      this.conversations.set(await firstValueFrom(this.copilot.listConversations()));
    } catch {
      // A resposta já foi exibida; o histórico poderá ser atualizado na próxima entrada na aba.
    }
  }

  private replaceConversation(updated: CopilotConversationSummary): void {
    this.conversations.update((items) =>
      items.map((conversation) => (conversation.id === updated.id ? updated : conversation)),
    );
  }

  private applyConversation(conversation: CopilotConversationDetail): void {
    const messages = conversation.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        timestamp: this.formatMessageTime(message.createdAt),
        toolCallsExecuted: this.getToolCallCount(message.toolCalls),
      }));

    this.messages.set(messages);
    this.conversationId.set(conversation.id);
  }

  private formatMessageTime(value: string): string | undefined {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  private getToolCallCount(toolCalls: unknown): number | undefined {
    if (Array.isArray(toolCalls) && toolCalls.length > 0) return toolCalls.length;
    if (
      toolCalls &&
      typeof toolCalls === 'object' &&
      'count' in toolCalls &&
      typeof toolCalls.count === 'number' &&
      toolCalls.count > 0
    ) {
      return toolCalls.count;
    }
    return undefined;
  }

  private readError(err: any, fallback: string): string {
    return err?.error?.message ?? err?.message ?? fallback;
  }

  private readConversationSidebarOpen(): boolean {
    try {
      const stored = window.localStorage.getItem(CONVERSATION_SIDEBAR_OPEN_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  }

  private toTimestamp(value: string): number {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  /**
   * Rola a lista para o fim depois que o Angular pinta o novo conteúdo.
   * Durante o streaming isso roda a cada token, então respeita quem subiu para
   * reler uma resposta anterior: só acompanha quem já estava no fim.
   */
  private scrollToBottom(force = false): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;
    // A posição é lida antes do render: interessa se o usuário estava no fim
    // quando o novo conteúdo chegou, não depois de ele ser pintado.
    if (!force && !this.isPinnedToBottom(element)) return;

    afterNextRender(
      () => {
        element.scrollTop = element.scrollHeight;
      },
      { injector: this.injector },
    );
  }

  private isPinnedToBottom(element: HTMLElement): boolean {
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distanceFromBottom <= SCROLL_STICK_THRESHOLD_PX;
  }
}
