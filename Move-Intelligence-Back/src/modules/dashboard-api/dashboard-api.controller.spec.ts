import { DashboardApiController } from './dashboard-api.controller';
import { DashboardApiService } from './dashboard-api.service';

/**
 * P0-4: o controller do ranking roda sobre Fastify (`res.header`, sem
 * `setHeader` do Express). Regressão do 500 em `/trends/products?page=…`.
 */
describe('DashboardApiController — listTrendingProducts (P0-4)', () => {
  function buildController(serviceResult: unknown) {
    const dashboard = {
      listTrendingProducts: jest.fn().mockResolvedValue(serviceResult),
    } as unknown as DashboardApiService;
    const controller = new DashboardApiController(dashboard);
    return { controller, dashboard };
  }

  it('paginado: escreve X-Total-Count via res.header (Fastify) e devolve o corpo', async () => {
    const body = { items: [{ product_cluster_id: 'c1' }], total: 42, page: 2, page_size: 20 };
    const { controller, dashboard } = buildController(body);
    const res = { header: jest.fn(), setHeader: undefined };

    const result = await controller.listTrendingProducts('50', 'rating', 'desc', undefined, '2', '20', undefined, res);

    expect(dashboard.listTrendingProducts).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'rating', dir: 'desc', page: 2, pageSize: 20 }),
    );
    expect(res.header).toHaveBeenCalledWith('X-Total-Count', '42');
    expect(result).toBe(body);
  });

  it('lista simples (array): não toca no header e devolve o array', async () => {
    const body = [{ product_cluster_id: 'c1' }];
    const { controller } = buildController(body);
    const res = { header: jest.fn() };

    const result = await controller.listTrendingProducts('50', undefined, undefined, undefined, undefined, undefined, undefined, res);

    expect(res.header).not.toHaveBeenCalled();
    expect(result).toBe(body);
  });
});
