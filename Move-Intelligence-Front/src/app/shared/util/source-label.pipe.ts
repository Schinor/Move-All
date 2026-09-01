import { Pipe, PipeTransform } from '@angular/core';
import { sourceLabel } from './format';

/** Exibe a fonte de coleta pelo nome comercial (google_trends -> Google Trends). */
@Pipe({ name: 'sourceLabel', standalone: true, pure: true })
export class SourceLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return sourceLabel(value);
  }
}
