import { AdminGuard } from '../auth/admin.guard';
import { DiscoveryTermsController } from './discovery-terms.controller';

describe('DiscoveryTermsController', () => {
  it('é só para ADMIN (AdminGuard na classe)', () => {
    const guards = Reflect.getMetadata('__guards__', DiscoveryTermsController) as unknown[];
    expect(guards).toContain(AdminGuard);
  });

  it('passa o id do usuário do JWT nas decisões', async () => {
    const terms = { approve: jest.fn().mockResolvedValue({ id: 't1', status: 'approved' }) };
    const controller = new DiscoveryTermsController(terms as never);
    await controller.approve('t1', { user: { sub: 'u1' } });
    expect(terms.approve).toHaveBeenCalledWith('t1', 'u1');
  });
});
