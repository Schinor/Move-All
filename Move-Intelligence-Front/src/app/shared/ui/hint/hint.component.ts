import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';

let hintSeq = 0;

/**
 * P1-1: "?" pequeno com tooltip de verdade (não o `title` nativo, que demora
 * e não funciona no toque). Abre em hover, foco e toque; fecha com Esc,
 * mouse fora e toque fora. Estilo igual ao `.explain-popover`.
 */
@Component({
  selector: 'app-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hint.component.html',
  styleUrl: './hint.component.css',
})
export class HintComponent {
  readonly text = input.required<string>();
  readonly label = input('Mais informações');
  readonly open = signal(false);
  readonly below = signal(false);
  /** Abre para a direita quando o "?" está na metade esquerda (ex.: ao lado do título). */
  readonly alignStart = signal(false);
  readonly tooltipId = `hint-tip-${++hintSeq}`;
  private readonly host = inject(ElementRef<HTMLElement>);

  toggle(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.open()) {
      this.hide();
      return;
    }
    this.place();
    this.open.set(true);
  }

  show(): void {
    if (this.open()) return;
    this.place();
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.hide();
    }
  }

  @HostListener('document:touchend', ['$event'])
  onDocumentTouch(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.hide();
    }
  }

  private place(): void {
    try {
      const rect = this.host.nativeElement.getBoundingClientRect();
      this.below.set(rect.top < 220);
      this.alignStart.set(rect.left + rect.width / 2 < window.innerWidth / 2);
    } catch {
      this.below.set(false);
      this.alignStart.set(false);
    }
  }
}
