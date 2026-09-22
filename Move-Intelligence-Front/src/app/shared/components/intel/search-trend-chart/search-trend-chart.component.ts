import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SearchTrendSeries } from '../../../../core/models/contract.models';
import { formatGrowth, trendPolyline } from '../../../util/search-trend-format';

@Component({
  selector: 'app-search-trend-chart',
  standalone: true,
  templateUrl: './search-trend-chart.component.html',
  styleUrl: './search-trend-chart.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchTrendChartComponent {
  readonly series = input<SearchTrendSeries[]>([]);
  readonly width = 640;
  readonly height = 160;
  readonly polyline = trendPolyline;
  readonly growth = formatGrowth;
}
