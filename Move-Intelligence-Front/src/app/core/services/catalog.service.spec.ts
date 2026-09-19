import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('confirma um item de revisão', () => {
    service.confirm('r1').subscribe();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/catalog/review/r1/confirm`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ decision_id: 'd1' });
  });

  it('lista sugestões de tipo com paginação', () => {
    service.reviewList('suggested_type').subscribe();
    const req = httpMock.expectOne((request) => request.url === `${environment.apiBaseUrl}/catalog/review`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('kind')).toBe('suggested_type');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('page_size')).toBe('20');
    req.flush({ total: 0, items: [] });
  });

  it('renomeia um card', () => {
    service.renameCard('c1', 'N').subscribe();
    const req = httpMock.expectOne(`${environment.apiBaseUrl}/catalog/cards/c1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'N' });
    req.flush({ decision_id: 'd2' });
  });
});
