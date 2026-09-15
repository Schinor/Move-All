import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { HintComponent } from '../hint/hint.component';

/**
 * D3: cabeçalho padrão com botão voltar opcional (dossiê, comparador, sourcing
 * de um produto). Usa Location.back() com histórico; senão vai ao fallback
 * (Ranking, que guarda estado na URL e restaura o scroll).
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, HintComponent],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.css',
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly showBack = input(false);
  readonly backFallback = input('/ranking');
  readonly backLabel = input('Voltar');
  /** P1-6: texto do "?" ao lado do título (sem mudar quem não passa hint). */
  readonly hint = input('');

  private readonly location = inject(Location);
  private readonly router = inject(Router);

  goBack(): void {
    if (window.history.length > 1) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(this.backFallback());
  }
}
