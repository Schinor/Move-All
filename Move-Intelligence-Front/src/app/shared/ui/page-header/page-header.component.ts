import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Cabeçalho padrão de uma feature: título, subtítulo e slot de ações. */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.css',
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
