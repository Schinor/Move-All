import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MaiMarkComponent } from '../../shared/ui/mai-mark/mai-mark.component';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { CopilotService } from '../../core/services/copilot.service';
import { CopilotStreamStore } from '../../core/services/copilot-stream.store';
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
  imports: [FormsModule, PageHeaderComponent, IconComponent, MaiMarkComponent],
  templateUrl: './ai-copilot.component.html',
  styleUrl: './ai-copilot.component.css',
})
export class AiCopilotComponent implements OnInit {
  private readonly copilot = inject(CopilotService);
  private readonly injector = inject(Injector);
  readonly streamStore = inject(CopilotStreamStore);

  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLDivElement>;

  readonly available = true;
  readonly messages = signal<CopilotChatMessage[]>([]);
  readonly inputMessage = signal('');
  readonly lastQuery = signal('');
  /** P0-5: chave do stream desta vista (conversationId ou pendente). */
  readonly activeKey = signal<string | null>(null);
  private pendingSeq = 0;
  /** P0-5: ocupado vale por conversa — outra conversa pode perguntar. */
  readonly busyHere = computed(() => {
    const key = this.activeKey();
    return key !== null && this.streamStore.isBusy(key);
  });
  readonly streamPartial = computed(() => {
    const key = this.activeKey();
    return key ? this.streamStore.stateFor(key).partialContent : '';
  });
  /** Banco + parcial ao vivo (o parcial some ao concluir e o banco recarrega). */
  readonly displayMessages = computed(() => {
    const base = this.messages();
    const partial = this.streamPartial();
    if (!partial || !this.busyHere()) return base;
    return [...base, { role: 'assistant', content: partial } as CopilotChatMessage];
  });
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
  /** P1-8: menu "⋯" aberto (ações só no hover/click do item). */
  readonly openMenuId = signal<string | null>(null);
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
    // P0-5: guarda por conversa — outra conversa pode receber pergunta.
    const key = this.activeKey() ?? `pending:${++this.pendingSeq}`;
    if (!query || this.streamStore.isBusy(key)) return;

    this.errorMessage.set(null);
    this.inputMessage.set('');
    this.lastQuery.set(query);
    this.activeKey.set(key);

    const userMessage: CopilotChatMessage = {
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.messages.update((msgs) => [...msgs, userMessage]);
    this.scrollToBottom(true);

    // Payload com a pergunta otimista (o backend também salva antes de gerar).
    const messagesPayload = this.messages().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let finalKey = key;
    const outcome = await this.streamStore.run({
      key,
      request: { messages: messagesPayload, conversationId: this.conversationId() },
      onConversationId: (id) => {
        finalKey = id;
        this.conversationId.set(id);
        this.copilot.rememberConversation(id);
        this.activeKey.set(id);
      },
    });

    // Só recarrega se o usuário ainda está nesta conversa.
    if (this.activeKey() === finalKey) {
      await this.reloadCurrentMessages();
      if (!outcome.ok && outcome.error) {
        this.errorMessage.set(outcome.error);
      }
      this.scrollToBottom();
    }
    void this.refreshConversationList();
  }

  /** P0-5: botão "Parar" — só ele cancela; a navegação nunca cancela. */
  stopGeneration(): void {
    const key = this.activeKey();
    if (key) this.streamStore.abort(key);
  }

  useSuggestion(suggestion: SuggestionPrompt): void {
    this.sendMessage(suggestion.query);
  }

  /** P0-3: reenvia a última pergunta após erro/timeout do stream. */
  retryLastMessage(): void {
    const query = this.lastQuery().trim();
    const key = this.activeKey();
    if (!query || (key !== null && this.streamStore.isBusy(key))) return;
    // A tentativa com erro já anexou a pergunta sem resposta: remove para não duplicar.
    this.messages.update((msgs) => {
      const last = msgs.at(-1);
      if (last && last.role === 'user' && last.content === query) return msgs.slice(0, -1);
      return msgs;
    });
    this.errorMessage.set(null);
    void this.sendMessage(query);
  }

  clearConversation(): void {
    this.userChoseConversation = true;
    this.messages.set([]);
    this.conversationId.set(undefined);
    this.activeKey.set(null);
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
    // P0-5: trocar de conversa nunca espera nem mexe no stream da outra.
    if (this.openingConversationId() === id) return;

    this.activeKey.set(id);
    this.openingConversationId.set(id);
    this.conversationError.set(null);
    try {
      const conversation = await firstValueFrom(this.copilot.getConversation(id));
      this.applyConversation(conversation);
      this.copilot.rememberConversation(id);
      this.errorMessage.set(null);
      const entry = this.streamStore.stateFor(id);
      if (entry.status === 'error' && entry.error) {
        this.errorMessage.set(entry.error);
      }
      this.scrollToBottom(true);
    } catch (err: any) {
      this.conversationError.set(this.readError(err, 'Não foi possível carregar esta conversa.'));
    } finally {
      this.openingConversationId.set(null);
    }
  }

  /** Recarrega a conversa aberta do banco (resposta salva após o stream). */
  private async reloadCurrentMessages(): Promise<void> {
    const id = this.conversationId();
    if (!id) return;
    try {
      const conversation = await firstValueFrom(this.copilot.getConversation(id));
      // Só aplica se o usuário continua nesta conversa.
      if (this.conversationId() === id) {
        this.applyConversation(conversation);
        this.errorMessage.set(null);
      }
    } catch {
      // Mantém o estado local; o histórico atualiza na próxima entrada.
    }
  }

  async deleteConversation(conversation: CopilotConversationSummary, event: Event): Promise<void> {
    event.stopPropagation();
    this.openMenuId.set(null);
    // P0-5: excluir aborta o stream dela (o backend salva o parcial sozinho).
    this.streamStore.abort(conversation.id);
    if (this.deletingConversationId() === conversation.id) return;

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
    this.openMenuId.set(null);
    if (this.streamStore.isBusy(conversation.id) || this.savingConversationId() !== null) return;
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
    this.openMenuId.set(null);
    if (this.streamStore.isBusy(conversation.id) || this.savingConversationId() === conversation.id) return;

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

  /** P1-8: menu "⋯" do item (abre/fecha; fora fecha). */
  toggleItemMenu(conversation: CopilotConversationSummary, event: Event): void {
    event.stopPropagation();
    this.openMenuId.update((current) => (current === conversation.id ? null : conversation.id));
  }

  @HostListener('document:click')
  closeItemMenu(): void {
    if (this.openMenuId() !== null) this.openMenuId.set(null);
  }

  private userChoseConversation = false;

  private async loadConversations(): Promise<void> {
    this.isLoadingConversations.set(true);
    this.conversationError.set(null);
    try {
      const conversations = await firstValueFrom(this.copilot.listConversations());
      this.conversations.set(conversations);

      // O usuário já escolheu (nova conversa, abriu outra ou perguntou) enquanto a
      // lista carregava: não sobrescrever a escolha reabrindo a conversa lembrada.
      if (this.userChoseConversation || this.activeKey() !== null) return;

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
