import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SourceStatus } from '../../../../core/models/contract.models';
import { SourceLabelPipe } from '../../../util/source-label.pipe';

@Component({
  selector: 'app-signal-source-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SourceLabelPipe],
  templateUrl: './signal-source-card.component.html',
  styleUrl: './signal-source-card.component.css',
})
export class SignalSourceCardComponent {
  readonly sources = input<SourceStatus[]>([]);
}
