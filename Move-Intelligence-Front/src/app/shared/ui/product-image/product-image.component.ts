import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** Imagem do produto com placeholder de fallback (achado da pesquisa). */
@Component({
  selector: 'app-product-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './product-image.component.html',
  styleUrl: './product-image.component.css',
})
export class ProductImageComponent {
  readonly src = input<string | null>(null);
  readonly alt = input('Produto');
  readonly failed = signal(false);

  onError(): void {
    this.failed.set(true);
  }
}
