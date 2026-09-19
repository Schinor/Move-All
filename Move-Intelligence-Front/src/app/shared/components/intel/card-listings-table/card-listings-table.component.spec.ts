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
});
