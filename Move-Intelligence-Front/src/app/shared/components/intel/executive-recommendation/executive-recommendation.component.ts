import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toAsyncState } from '../../../../core/api/async-state';
import { TrendsService } from '../../../../core/services/trends.service';
import { ACTION_LABEL } from '../../../util/format';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { SkeletonComponent } from '../../../ui/skeleton/skeleton.component';
import { StatePanelComponent } from '../../../ui/state-panel/state-panel.component';

/** Item do bloco (o ApiClient converte as chaves da API para camelCase). */
interface ExecutiveItem {
  productClusterId: string;
  canonicalName: string;
  moveScore: number | null;
  action: string | null;
  text: string;
}

/**
 * D1/C6: bloco "Recomendação" no executivo. As regras escolhem os 5 produtos
 * com mais potencial (Decidir agora → Negociar custo → Testar demanda, por
 * Move Score); a IA escreve 2–3 frases por produto.
 */
@Component({
  selector: 'app-executive-recommendation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EmptyStateComponent, IconComponent, SkeletonComponent, StatePanelComponent],
  template: `
    <section class="reco-panel surface-panel" aria-labelledby="reco-title">
      <header class="panel-heading">
        <span class="eyebrow"><app-icon name="lightbulb" [size]="14" /> Recomendação</span>
        <h2 id="reco-title">Produtos com mais potencial</h2>
      </header>
      @switch (state().status) {
        @case ('loading') {
          <div class="reco-loading" role="status" aria-label="Carregando recomendação">
            <app-skeleton [width]="'70%'" />
            <app-skeleton [width]="'90%'" />
            <app-skeleton [width]="'80%'" />
          </div>
        }
        @case ('error') {
          <app-state-panel [state]="state()" emptyMessage="Recomendação indisponível agora." />
        }
        @default {
          @if (items().length) {
            <ol class="reco-list">
              @for (item of items(); track item.productClusterId; let index = $index) {
                <li class="reco-item" [class.lead]="index === 0">
                  <span class="reco-rank num" aria-hidden="true">{{ index + 1 }}</span>
                  <div class="reco-body">
                    <div class="reco-title">
                      <a [routerLink]="['/tendencia', item.productClusterId]">{{ item.canonicalName }}</a>
                      <span class="reco-meta">
                        @if (item.action) {
                          <span class="action-chip" [attr.data-action]="item.action">{{ actionText(item.action) }}</span>
                        }
                        @if (item.moveScore !== null && item.moveScore !== undefined) {
                          <span class="reco-score num">Move Score <strong>{{ item.moveScore }}</strong></span>
                        }
                      </span>
                    </div>
                    <p>{{ item.text }}</p>
                  </div>
                  <a class="reco-link" [routerLink]="['/tendencia', item.productClusterId]" [attr.aria-label]="'Ver dossiê de ' + item.canonicalName">
                    Ver dossiê <app-icon name="arrow-up-right" [size]="14" />
                  </a>
                </li>
              }
            </ol>
          } @else {
            <app-empty-state
              [compact]="true"
              icon="lightbulb"
              title="Sem recomendação"
              description="Aparece quando houver produtos classificados como “Decidir agora”, “Negociar custo” ou “Testar demanda”."
            />
          }
        }
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .reco-panel {
        display: grid;
        gap: var(--sp-4);
        padding: var(--sp-5);
        border-left: 4px solid var(--brand);
        border-radius: var(--r-md);
      }
      .panel-heading {
        display: grid;
        gap: var(--sp-1);
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        color: var(--brand-text);
        font-size: var(--fs-label);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .panel-heading h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--fs-h2);
        line-height: var(--lh-h2);
      }
      .reco-loading {
        display: grid;
        gap: var(--sp-2);
      }
      .reco-list {
        display: grid;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .reco-item {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--sp-3);
        padding: var(--sp-3) 0;
        border-bottom: 1px solid var(--border);
      }
      .reco-item:last-child {
        border-bottom: 0;
      }
      .reco-item.lead {
        margin-bottom: var(--sp-1);
        padding: var(--sp-3);
        background: var(--brand-weak);
        border: 1px solid color-mix(in srgb, var(--brand) 40%, var(--border));
        border-radius: var(--r-sm);
      }
      .reco-rank {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        color: var(--text-2);
        font-size: var(--fs-caption);
        font-weight: 700;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: 50%;
      }
      .reco-item.lead .reco-rank {
        color: var(--brand-ink);
        background: var(--brand);
        border-color: var(--brand);
      }
      .reco-body {
        display: grid;
        gap: var(--sp-1);
        min-width: 0;
      }
      .reco-title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-1) var(--sp-3);
      }
      .reco-title a {
        color: var(--text);
        font-size: var(--fs-body);
        font-weight: 600;
        text-decoration: none;
      }
      .reco-title a:hover {
        color: var(--brand-text);
      }
      .reco-meta {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
      }
      .action-chip {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        padding: 0 var(--sp-2);
        color: var(--text-2);
        font-size: var(--fs-caption);
        font-weight: 600;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--r-full);
      }
      .action-chip[data-action='DECIDIR_AGORA'] {
        color: var(--success);
        background: var(--success-bg);
      }
      .action-chip[data-action='NEGOCIAR_CUSTO'] {
        color: var(--warning);
        background: var(--warning-bg);
      }
      .action-chip[data-action='TESTAR_DEMANDA'] {
        color: var(--info);
        background: var(--info-bg);
      }
      .reco-score {
        color: var(--text-3);
        font-size: var(--fs-caption);
      }
      .reco-score strong {
        color: var(--text);
      }
      .reco-body p {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-sm);
        line-height: var(--lh-body);
      }
      .reco-link {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        min-height: 28px;
        color: var(--brand-text);
        font-size: var(--fs-caption);
        font-weight: 700;
        white-space: nowrap;
        text-decoration: none;
      }
      .reco-link:hover {
        color: var(--text);
      }
      @media (max-width: 767px) {
        .reco-panel {
          padding: var(--sp-4);
        }
        .reco-item {
          grid-template-columns: 28px minmax(0, 1fr);
        }
        .reco-link {
          grid-column: 2;
        }
      }
    `,
  ],
})
export class ExecutiveRecommendationComponent {
  private readonly trends = inject(TrendsService);
  readonly state = toAsyncState(this.trends.executiveRecommendation());

  readonly items = computed((): ExecutiveItem[] => {
    const s = this.state();
    if (s.status !== 'ready') return [];
    const data = s.data as unknown as { recommended?: ExecutiveItem | null; alternatives?: ExecutiveItem[] };
    return [data.recommended, ...(data.alternatives ?? [])].filter(
      (item): item is ExecutiveItem => Boolean(item?.productClusterId),
    );
  });

  actionText(action: string): string {
    return ACTION_LABEL[action] ?? action;
  }
}
