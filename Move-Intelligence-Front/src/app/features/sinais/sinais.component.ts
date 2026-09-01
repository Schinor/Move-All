import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { toAsyncState } from '../../core/api/async-state';
import { SignalsService } from '../../core/services/signals.service';
import { TrendsService } from '../../core/services/trends.service';
import { DEFAULT_WINDOW, TimeWindow } from '../../core/models/contract.models';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card/kpi-card.component';
import { RiskBadgeComponent } from '../../shared/ui/risk-badge/risk-badge.component';
import { WindowSelectorComponent } from '../../shared/ui/window-selector/window-selector.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'app-sinais',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    PageHeaderComponent,
    StatePanelComponent,
    RiskBadgeComponent,
    WindowSelectorComponent,
    IconComponent,
  ],
  templateUrl: './sinais.component.html',
  styleUrl: './sinais.component.css',
})
export class SinaisComponent implements OnInit {
  private readonly signals = inject(SignalsService);
  private readonly trends = inject(TrendsService);

  readonly window = signal<TimeWindow>(DEFAULT_WINDOW);
  readonly feed = toAsyncState(
    toObservable(this.window).pipe(switchMap((w) => this.signals.feed({ window: w }))),
  );
  readonly sources = toAsyncState(this.signals.sources());

  // Webhook & Alertas State
  readonly webhookUrl = signal('');
  readonly webhookChannel = signal<'slack' | 'telegram' | 'generic'>('slack');
  readonly telegramChatId = signal('');
  readonly minTrendScore = signal(80);
  readonly minGrowthPct = signal(40);
  readonly alertsEnabled = signal(true);
  readonly alertsHistory = signal<any[]>([]);

  readonly testStatus = signal<string | null>(null);
  readonly scanStatus = signal<string | null>(null);
  readonly isSaving = signal(false);

  ngOnInit(): void {
    this.loadAlertsRules();
    this.loadAlertsHistory();
  }

  loadAlertsRules(): void {
    this.trends.getAlertRules().subscribe({
      next: (rules) => {
        if (rules) {
          this.webhookUrl.set(rules.webhookUrl || '');
          this.webhookChannel.set(rules.webhookChannel || 'slack');
          this.telegramChatId.set(rules.telegramChatId || '');
          this.minTrendScore.set(rules.minTrendScore || 80);
          this.minGrowthPct.set(rules.minGrowthPct || 40);
          this.alertsEnabled.set(rules.enabled !== false);
        }
      },
    });
  }

  loadAlertsHistory(): void {
    this.trends.getAlerts().subscribe({
      next: (list) => {
        this.alertsHistory.set(list || []);
      },
    });
  }

  saveRules(): void {
    this.isSaving.set(true);
    const payload = {
      webhookUrl: this.webhookUrl(),
      webhookChannel: this.webhookChannel(),
      telegramChatId: this.telegramChatId(),
      minTrendScore: Number(this.minTrendScore()),
      minGrowthPct: Number(this.minGrowthPct()),
      enabled: this.alertsEnabled(),
    };
    this.trends.saveAlertRules(payload).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.testStatus.set('Regras de alerta salvas com sucesso!');
        setTimeout(() => this.testStatus.set(null), 4000);
      },
      error: () => {
        this.isSaving.set(false);
        this.testStatus.set('Erro ao salvar regras de alerta.');
      },
    });
  }

  testWebhook(): void {
    if (!this.webhookUrl().trim()) {
      this.testStatus.set('Preencha a URL do Webhook antes de testar.');
      return;
    }
    this.testStatus.set('Enviando notificação de teste...');
    this.trends
      .testAlertWebhook({
        webhookUrl: this.webhookUrl(),
        channel: this.webhookChannel(),
        telegramChatId: this.telegramChatId(),
      })
      .subscribe({
        next: () => {
          this.testStatus.set('Webhook disparado com sucesso! Verifique seu canal.');
          setTimeout(() => this.testStatus.set(null), 5000);
        },
        error: (err) => {
          this.testStatus.set(`Falha no webhook: ${err?.message || 'Erro de conexão'}`);
        },
      });
  }

  scanNow(): void {
    this.scanStatus.set('Executando varredura de oportunidades...');
    this.trends.scanAlerts().subscribe({
      next: (res) => {
        this.scanStatus.set(
          `Varredura concluída: ${res.alertsCreated} novos alertas gerados e ${res.dispatchedCount} notificações enviadas.`,
        );
        this.loadAlertsHistory();
        setTimeout(() => this.scanStatus.set(null), 6000);
      },
      error: () => {
        this.scanStatus.set('Erro ao executar varredura.');
      },
    });
  }

  setWindow(w: TimeWindow): void {
    this.window.set(w);
  }
}
