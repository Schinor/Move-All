import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TIME_WINDOWS, TimeWindow } from '../../../core/models/contract.models';

/** Seletor de janela temporal (achado da pesquisa: 24h é curto demais). */
@Component({
  selector: 'app-window-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './window-selector.component.html',
  styleUrl: './window-selector.component.css',
})
export class WindowSelectorComponent {
  readonly value = input.required<TimeWindow>();
  readonly changed = output<TimeWindow>();
  readonly windows = TIME_WINDOWS;
}
