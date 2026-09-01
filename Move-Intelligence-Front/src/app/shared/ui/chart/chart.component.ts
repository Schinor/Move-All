import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
} from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import * as echarts from 'echarts/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { BarChart, LineChart, RadarChart } from 'echarts/charts';
import { GridComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  RadarChart,
  GridComponent,
  RadarComponent,
  TooltipComponent,
  CanvasRenderer,
]);

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chart.component.html',
  styleUrl: './chart.component.css',
  host: {
    role: 'img',
    '[attr.aria-label]': 'label()',
  },
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  readonly options = input.required<EChartsCoreOption>();
  readonly label = input('Gráfico de dados');
  private readonly theme = inject(ThemeService);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart: ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    effect(() => {
      const options = this.options();
      this.theme.theme();
      if (this.chart) {
        this.chart.setOption(options, true);
      }
    });
  }

  ngAfterViewInit(): void {
    this.chart = echarts.init(this.element.nativeElement);
    this.chart.setOption(this.options(), true);
    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
