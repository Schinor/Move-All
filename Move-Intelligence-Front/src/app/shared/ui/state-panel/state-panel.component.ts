import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AsyncState } from '../../../core/api/async-state';
import { IconComponent } from '../icon/icon.component';

/**
 * Renderiza os estados não-prontos de um AsyncState (loading | empty | error).
 * A feature renderiza o conteúdo real só quando status === 'ready'.
 */
@Component({
  selector: 'app-state-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './state-panel.component.html',
  styleUrl: './state-panel.component.css',
})
export class StatePanelComponent {
  readonly state = input.required<AsyncState<unknown>>();
  readonly emptyMessage = input('Sem dados para exibir ainda.');
}
