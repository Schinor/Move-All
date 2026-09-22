import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { CatalogService } from '../../core/services/catalog.service';
import { DiscoveryTermsService } from '../../core/services/discovery-terms.service';
import { RevisaoComponent } from './revisao.component';

describe('RevisaoComponent', () => {
  const typeItem = {
    id: 't1', kind: 'suggested_type' as const, reason: 'tipo novo', suggestedTypeKey: 'pilates_reformer',
    aliases: [], listingCount: 1, samples: [], similarTypes: [],
  };

  const createCatalog = (overrides: Record<string, unknown> = {}) => ({
    reviewCounts: vi.fn().mockReturnValue(of({ provisionalListing: 1, suggestedType: 0 })),
    reviewList: vi.fn().mockReturnValue(of({ total: 1, items: [{
      id: 'r1', kind: 'provisional_listing', reason: 'falta a especificação: resistência', marketplace: 'alibaba',
      externalProductId: 'X', title: 'Bicicleta Spinning Compacta', url: null, price: 1390, currency: 'BRL',
      suggestedCard: { id: 'c1', name: 'Bike spinning magnética', category: 'spinning_bike' },
      ficha: { typeKey: 'spin_bike', cardKeyValues: {}, missingKeyAttrs: ['resistencia'], comparisonValues: {}, brand: null },
    }] })),
    families: vi.fn().mockReturnValue(of([{ key: 'fitness', namePt: 'Fitness' }])),
    confirm: vi.fn().mockReturnValue(of({ decisionId: 'd1' })),
    approveType: vi.fn().mockReturnValue(of({ decisionId: 'd2', typeId: 'type-1' })),
    ...overrides,
  });

  it('mostra o item e confirma pelo botão', () => {
    const catalog = createCatalog();
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Bicicleta Spinning Compacta');
    expect(el.textContent).toContain('falta a especificação: resistência');
    (el.querySelector('[data-action="confirm"]') as HTMLButtonElement).click();
    expect(catalog.confirm).toHaveBeenCalledWith('r1');
  });

  it('sugere o nome em português ao abrir o formulário de tipo', () => {
    const catalog = createCatalog();
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);

    fixture.componentInstance.openApprove(typeItem);

    expect(fixture.componentInstance.approveForm.namePt).toBe('Pilates reformer');
  });

  it('exibe a validação junto ao botão de salvar tipo', () => {
    const catalog = createCatalog();
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.componentInstance.tab.set('suggested_type');
    fixture.componentInstance.typeItems.set([typeItem]);
    fixture.componentInstance.openApprove(typeItem);
    fixture.componentInstance.approveForm.namePt = '';

    fixture.componentInstance.approve(typeItem);
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-role="approve-error"]') as HTMLElement;
    expect(error?.textContent).toContain('Preencha família, chave e nome.');
    expect(fixture.nativeElement.querySelector('.review-message')).toBeNull();
  });

  it('exibe erro de contagem em vez de zero quando reviewCounts falha', () => {
    const catalog = createCatalog({ reviewCounts: vi.fn().mockReturnValue(throwError(() => ({ status: 500 }))) });
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Não foi possível carregar a fila (erro 500).');
    expect(text).not.toContain('Anúncios provisórios (0)');
  });

  it('exibe erro de fila em vez do estado vazio quando reviewList retorna 403', () => {
    const catalog = createCatalog({
      reviewCounts: vi.fn().mockReturnValue(of({ provisionalListing: 0, suggestedType: 0 })),
      reviewList: vi.fn().mockReturnValue(throwError(() => ({ status: 403 }))),
    });
    TestBed.configureTestingModule({ imports: [RevisaoComponent], providers: [{ provide: CatalogService, useValue: catalog }] });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Não foi possível carregar a fila (erro 403).');
    expect(text).not.toContain('Nenhum anúncio aguardando revisão.');
  });

  it('tem a aba Termos em alta', () => {
    const catalog = createCatalog();
    TestBed.configureTestingModule({
      imports: [RevisaoComponent],
      providers: [
        { provide: CatalogService, useValue: catalog },
        { provide: DiscoveryTermsService, useValue: {
          counts: () => of({ new: 0, approved: 0, searched: 0, ignored: 0 }), list: () => of([]),
        } },
      ],
    });
    const fixture = TestBed.createComponent(RevisaoComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tab = [...el.querySelectorAll('.review-tabs button')].find((b) => b.textContent?.includes('Termos em alta')) as HTMLButtonElement;
    expect(tab).toBeTruthy();
    tab.click();
    fixture.detectChanges();
    expect(el.querySelector('app-discovery-terms')).not.toBeNull();
  });
});
