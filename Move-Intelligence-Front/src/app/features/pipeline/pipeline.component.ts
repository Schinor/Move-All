import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toAsyncState } from '../../core/api/async-state';
import { PipelineService } from '../../core/services/pipeline.service';
import { PageHeaderComponent } from '../../shared/ui/page-header/page-header.component';
import { StatePanelComponent } from '../../shared/ui/state-panel/state-panel.component';

@Component({
  selector: 'app-pipeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeaderComponent, StatePanelComponent],
  templateUrl: './pipeline.component.html',
  styleUrl: './pipeline.component.css',
})
export class PipelineComponent {
  private readonly pipeline = inject(PipelineService);
  readonly board = toAsyncState(this.pipeline.board());
}
