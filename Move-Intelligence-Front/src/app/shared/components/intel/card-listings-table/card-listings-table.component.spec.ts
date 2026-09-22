import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CatalogService } from '../../../../core/services/catalog.service';
import { CardListingsTableComponent } from './card-listings-table.component';

describe('CardListingsTableComponent', () => {
  it('lista anúncios com variação e status', () => {
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { marketplace: 'mercado_livre', externalProductId: 'A', title: 'Bike 13kg', url: 'https://x', price: 1520, currency: 'BRL',
          rating: 4.6, status: 'confirmed', variation: 'cor: preto', brand: null },
        { marketplace: 'alibaba', externalProductId: 'B', title: 'Spin bike', url: null, price: 90, currency: 'USD',
          rating: null, status: 'provisional', variation: null, brand: null },
        { marketplace: 'shopee_br', externalProductId: 'C', title: 'Bike automática', url: null, price: 1200, currency: 'BRL',
          rating: null, status: 'auto', variation: null, brand: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Bike 13kg');
    expect(text).toContain('cor: preto');
    expect(text).toContain('provisório');
    expect(text).toContain('confirmado');
    expect(text).toContain('automático');
  });

  it('formata preço com 2 casas e filtra por marketplace', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { marketplace: 'mercado_livre', externalProductId: 'A', title: 'Remo ML', url: null, price: 3748.493, currency: 'BRL', rating: 4.3, status: 'confirmed', variation: null, brand: null },
        { marketplace: 'alibaba', externalProductId: 'B', title: 'Rower Ali 1', url: null, price: 79.733, currency: 'USD', rating: 4.2, status: 'confirmed', variation: null, brand: null },
        { marketplace: 'alibaba', externalProductId: 'C', title: 'Rower Ali 2', url: null, price: 81, currency: 'USD', rating: null, status: 'auto', variation: null, brand: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('R$ 3.748,49');
    expect(el.textContent).toContain('USD 79,73');
    const chip = [...el.querySelectorAll<HTMLButtonElement>('.mp-chip')].find((button) => button.textContent?.includes('Alibaba'))!;
    expect(chip.textContent).toContain('(2)');
    chip.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(el.textContent).not.toContain('Remo ML');
  });

  it('mostra a coluna Acompanhamento', () => {
    TestBed.resetTestingModule();
    const base = { url: null, currency: 'BRL', rating: null, status: 'confirmed', variation: null, brand: null };
    TestBed.configureTestingModule({
      imports: [CardListingsTableComponent],
      providers: [{ provide: CatalogService, useValue: { cardListings: () => of([
        { ...base, marketplace: 'amazon_br', externalProductId: 'A', title: 'Bike A', price: 100,
          tracking: { status: 'ACTIVE', tier: 1, reason: 'top50', cadenceDays: 3.5, lastSuccessAt: '2026-09-20T12:00:00.000Z' } },
        { ...base, marketplace: 'alibaba', externalProductId: 'B', title: 'Bike B', price: 90,
          tracking: { status: 'ACTIVE', tier: 3, reason: 'demais', cadenceDays: 30, lastSuccessAt: null } },
        { ...base, marketplace: 'shopee_br', externalProductId: 'C', title: 'Bike C', price: 80,
          tracking: { status: 'IGNORED', tier: 3, reason: 'demais', cadenceDays: 30, lastSuccessAt: null } },
        { ...base, marketplace: 'mercado_livre', externalProductId: 'D', title: 'Bike D', price: 70, tracking: null },
      ]) } }],
    });
    const fixture = TestBed.createComponent(CardListingsTableComponent);
    fixture.componentRef.setInput('productClusterId', 'c1');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Acompanhamento');
    expect(text).toContain('Nível 1 · a cada 3,5 dias');
    expect(text).toContain('última: 20/09');
    expect(text).toContain('Nível 3 · mensal');
    expect(text).toContain('Fora do acompanhamento');
    expect(el.querySelector('[title="Entre os 50 cards de maior score"]')).not.toBeNull();
  });
});
