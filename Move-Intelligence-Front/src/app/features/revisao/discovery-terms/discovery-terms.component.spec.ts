import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { CatalogService } from '../../../core/services/catalog.service';
import { DiscoveryTermsService } from '../../../core/services/discovery-terms.service';
import { DiscoveryTermsComponent } from './discovery-terms.component';

const term = (over: Record<string, unknown> = {}) => ({
  id: 't1', term: 'adjustable aerobic step', geo: 'US', typeKey: 'aerobic_step', typeName: 'Step aeróbico',
  familyKey: 'accessories', risingLabel: '+500%', breakout: false,
  firstSeenAt: new Date(Date.now() - 10 * 86_400_000).toISOString(), lastSeenAt: new Date().toISOString(),
  status: 'new', searchedAt: null, newListings: null, searchError: null, ...over,
});

function setup(items: unknown[], overrides: Record<string, unknown> = {}) {
  const api = {
    counts: vi.fn().mockReturnValue(of({ new: 1, approved: 1, searched: 2, ignored: 4 })),
    list: vi.fn().mockReturnValue(of(items)),
    approve: vi.fn().mockReturnValue(of({ id: 't1', status: 'approved' })),
    ignore: vi.fn().mockReturnValue(of({ id: 't1', status: 'ignored' })),
    restore: vi.fn().mockReturnValue(of({ id: 't1', status: 'new' })),
    ...overrides,
  };
  TestBed.configureTestingModule({
    imports: [DiscoveryTermsComponent],
    providers: [
      { provide: DiscoveryTermsService, useValue: api },
      { provide: CatalogService, useValue: { families: () => of([{ key: 'accessories', namePt: 'Acessórios' }]) } },
    ],
  });
  const fixture = TestBed.createComponent(DiscoveryTermsComponent);
  fixture.detectChanges();
  return { api, fixture, el: fixture.nativeElement as HTMLElement };
}

describe('DiscoveryTermsComponent', () => {
  it('mostra chips com contagem e os termos novos', () => {
    const { el, api } = setup([term()]);
    expect(api.list).toHaveBeenCalledWith({ status: 'new', geo: undefined, family: undefined });
    const text = el.textContent ?? '';
    expect(text).toContain('Novos (1)');
    expect(text).toContain('Aprovados (3)');
    expect(text).toContain('Ignorados (4)');
    expect(text).toContain('adjustable aerobic step');
    expect(text).toContain('Step aeróbico');
    expect(text).toContain('+500%');
    expect(text).toContain('há 1 semana');
  });

  it('Buscar produtos aprova; Ignorar ignora; recarrega depois', () => {
    const { el, api } = setup([term()]);
    (el.querySelector('[data-action="approve"]') as HTMLButtonElement).click();
    expect(api.approve).toHaveBeenCalledWith('t1');
    (el.querySelector('[data-action="ignore"]') as HTMLButtonElement).click();
    expect(api.ignore).toHaveBeenCalledWith('t1');
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('aba Aprovados pede approved+searched e mostra a situação', () => {
    const { el, api, fixture } = setup([
      term({ id: 'a', status: 'approved' }),
      term({ id: 'b', status: 'searched', searchedAt: '2026-09-15T12:00:00.000Z', newListings: 14 }),
      term({ id: 'c', status: 'approved', searchError: 'Bright Data fora do ar' }),
    ]);
    (el.querySelector('[data-chip="approved"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api.list).toHaveBeenLastCalledWith({ status: 'approved,searched', geo: undefined, family: undefined });
    const text = el.textContent ?? '';
    expect(text).toContain('Na fila: entra na próxima coleta');
    expect(text).toContain('Buscado em 15/09: 14 anúncios novos');
    expect(text).toContain('Erro na última busca: Bright Data fora do ar');
  });

  it('aba Ignorados tem Restaurar', () => {
    const { el, api, fixture } = setup([term({ status: 'ignored' })]);
    (el.querySelector('[data-chip="ignored"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[data-action="restore"]') as HTMLButtonElement).click();
    expect(api.restore).toHaveBeenCalledWith('t1');
  });
});
