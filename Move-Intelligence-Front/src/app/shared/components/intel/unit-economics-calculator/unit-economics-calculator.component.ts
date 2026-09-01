import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TrendsService } from '../../../../core/services/trends.service';
import { IconComponent } from '../../../ui/icon/icon.component';

@Component({
  selector: 'app-unit-economics-calculator',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unit-economics-calculator.component.html',
  styleUrl: './unit-economics-calculator.component.css',
})
export class UnitEconomicsCalculatorComponent implements OnInit {
  private readonly trends = inject(TrendsService);

  @Input({ required: true }) productClusterId!: string;

  readonly loading = signal(true);
  readonly result = signal<any | null>(null);

  // Form Inputs
  readonly precoVendaBrl = signal(599);
  readonly fobUsd = signal(28.0);
  readonly cambioUsd = signal(5.45);
  readonly freteUnitarioUsd = signal(6.5);
  readonly impostoImportacaoPct = signal(35.0);
  readonly icmsPct = signal(18.0);
  readonly comissaoMarketplacePct = signal(16.0);
  readonly custoFulfillmentBrl = signal(32.0);
  readonly custoFixoMensalBrl = signal(4500.0);
  readonly elasticidadePreco = signal(-1.6);
  readonly volumeBaseMensal = signal(250);

  ngOnInit(): void {
    this.loadDefaults();
  }

  loadDefaults(): void {
    this.loading.set(true);
    this.trends.unitEconomicsDefaults(this.productClusterId).subscribe({
      next: (defaults) => {
        if (defaults) {
          this.precoVendaBrl.set(defaults.precoVendaBrl || 599);
          this.fobUsd.set(defaults.fobUsd || 28.0);
          this.cambioUsd.set(defaults.cambioUsd || 5.45);
          this.freteUnitarioUsd.set(defaults.freteUnitarioUsd || 6.5);
          this.impostoImportacaoPct.set(defaults.impostoImportacaoPct || 35.0);
          this.icmsPct.set(defaults.icmsPct || 18.0);
          this.comissaoMarketplacePct.set(defaults.comissaoMarketplacePct || 16.0);
          this.custoFulfillmentBrl.set(defaults.custoFulfillmentBrl || 32.0);
          this.custoFixoMensalBrl.set(defaults.custoFixoMensalBrl || 4500.0);
          this.elasticidadePreco.set(defaults.elasticidadePreco || -1.6);
          this.volumeBaseMensal.set(defaults.volumeBaseMensal || 250);
        }
        this.recalculate();
      },
      error: () => {
        this.recalculate();
      },
    });
  }

  recalculate(): void {
    this.loading.set(true);
    const payload = {
      precoVendaBrl: Number(this.precoVendaBrl()),
      fobUsd: Number(this.fobUsd()),
      cambioUsd: Number(this.cambioUsd()),
      freteUnitarioUsd: Number(this.freteUnitarioUsd()),
      impostoImportacaoPct: Number(this.impostoImportacaoPct()),
      icmsPct: Number(this.icmsPct()),
      comissaoMarketplacePct: Number(this.comissaoMarketplacePct()),
      custoFulfillmentBrl: Number(this.custoFulfillmentBrl()),
      custoFixoMensalBrl: Number(this.custoFixoMensalBrl()),
      elasticidadePreco: Number(this.elasticidadePreco()),
      volumeBaseMensal: Number(this.volumeBaseMensal()),
    };

    this.trends.simulateUnitEconomics(this.productClusterId, payload).subscribe({
      next: (res) => {
        this.result.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  formatCurrency(value: number | undefined): string {
    if (value === undefined || value === null) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  formatNumber(value: number | undefined): string {
    if (value === undefined || value === null) return '0';
    return new Intl.NumberFormat('pt-BR').format(value);
  }
}
