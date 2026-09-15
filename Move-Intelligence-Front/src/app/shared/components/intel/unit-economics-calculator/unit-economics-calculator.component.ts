import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
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
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) productClusterId!: string;

  readonly loading = signal(true);
  readonly result = signal<any | null>(null);
  /** Origem dos defaults (observado vs estimativa/default), vinda da API. */
  readonly premiseSources = signal<Record<string, string> | null>(null);

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

  private readonly recalculate$ = new Subject<void>();

  constructor() {
    this.recalculate$
      .pipe(
        debounceTime(120),
        switchMap(() => {
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

          return this.trends.simulateUnitEconomics(this.productClusterId, payload).pipe(
            catchError(() => of(null)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.loading.set(false);
        if (res !== null) {
          this.result.set(res);
        }
      });
  }

  ngOnInit(): void {
    this.loadDefaults();
  }

  loadDefaults(): void {
    this.loading.set(true);
    this.trends
      .unitEconomicsDefaults(this.productClusterId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (defaults) => {
          if (defaults) {
            this.precoVendaBrl.set(defaults.precoVendaBrl ?? 599);
            this.fobUsd.set(defaults.fobUsd ?? 28.0);
            this.cambioUsd.set(defaults.cambioUsd ?? 5.45);
            this.freteUnitarioUsd.set(defaults.freteUnitarioUsd ?? 6.5);
            this.impostoImportacaoPct.set(defaults.impostoImportacaoPct ?? 35.0);
            this.icmsPct.set(defaults.icmsPct ?? 18.0);
            this.comissaoMarketplacePct.set(defaults.comissaoMarketplacePct ?? 16.0);
            this.custoFulfillmentBrl.set(defaults.custoFulfillmentBrl ?? 32.0);
            this.custoFixoMensalBrl.set(defaults.custoFixoMensalBrl ?? 4500.0);
            this.elasticidadePreco.set(defaults.elasticidadePreco ?? -1.6);
            this.volumeBaseMensal.set(defaults.volumeBaseMensal ?? 250);
            this.premiseSources.set(defaults.premiseSources ?? defaults.premise_sources ?? null);
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
    this.recalculate$.next();
  }

  formatCurrency(value: number | null | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  formatNumber(value: number | null | undefined): string {
    if (value === undefined || value === null) return '—';
    return new Intl.NumberFormat('pt-BR').format(value);
  }

  /** Rótulo de origem de um default (observado vs estimativa/default). */
  premiseLabel(key: string): string | null {
    const source = this.premiseSources()?.[key];
    if (!source) return null;
    if (source === 'observado') return 'observado';
    if (source === 'estimativa_18pct_do_preco') return 'estimativa (18% do preço)';
    return 'default';
  }
}
