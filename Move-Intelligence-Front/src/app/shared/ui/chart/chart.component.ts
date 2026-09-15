import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import * as echarts from 'echarts/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { BarChart, LineChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  RadarChart,
  ScatterChart,
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
  readonly pointClick = output<unknown>();
  private readonly theme = inject(ThemeService);

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private chart: ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame = 0;
  private lastSize = '';

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
    this.chart.on('click', (params) => this.pointClick.emit(params));
    // Painéis deslizando (sidebar/histórico) disparam o observer a cada quadro:
    // no máximo um redraw por quadro, e só quando o tamanho mudou de fato.
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const size = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '';
      if (size === this.lastSize || this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        this.lastSize = size;
        this.chart?.resize();
      });
    });
    this.resizeObserver.observe(this.element.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.chart?.dispose();
  }
}
