import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { TrendsService } from '../../../../core/services/trends.service';
import { IconComponent } from '../../../ui/icon/icon.component';

@Component({
  selector: 'app-competitor-matrix',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './competitor-matrix.component.html',
  styleUrl: './competitor-matrix.component.css',
})
export class CompetitorMatrixComponent implements OnInit {
  private readonly trends = inject(TrendsService);

  @Input({ required: true }) productClusterId!: string;

  readonly loading = signal(true);
  readonly data = signal<any | null>(null);

  ngOnInit(): void {
    this.loadCompetitors();
  }

  loadCompetitors(): void {
    this.loading.set(true);
    this.trends.competitors(this.productClusterId).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  formatCurrency(value: number | undefined): string {
    if (!value) return 'R$ 0';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
  }

  formatNumber(value: number | undefined): string {
    if (!value) return '0';
    return new Intl.NumberFormat('pt-BR').format(value);
  }
}
