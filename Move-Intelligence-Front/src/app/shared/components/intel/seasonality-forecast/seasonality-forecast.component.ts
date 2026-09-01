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
  selector: 'app-seasonality-forecast',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './seasonality-forecast.component.html',
  styleUrl: './seasonality-forecast.component.css',
})
export class SeasonalityForecastComponent implements OnInit {
  private readonly trends = inject(TrendsService);

  @Input({ required: true }) productClusterId!: string;

  readonly loading = signal(true);
  readonly data = signal<any | null>(null);

  ngOnInit(): void {
    this.loadSeasonality();
  }

  loadSeasonality(): void {
    this.loading.set(true);
    this.trends.seasonalityForecast(this.productClusterId).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  formatNumber(value: number | undefined): string {
    if (!value) return '0';
    return new Intl.NumberFormat('pt-BR').format(value);
  }
}
