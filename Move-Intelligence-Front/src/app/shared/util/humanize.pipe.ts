import { Pipe, PipeTransform } from '@angular/core';
import { categoryLabel } from './format';

/** Exibe slugs da API (ex.: `musculacao_pesos_livres`) como texto legível. */
@Pipe({ name: 'humanize', standalone: true, pure: true })
export class HumanizePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return categoryLabel(value);
  }
}
