import { RedisCacheService } from './redis-cache.service';

describe('RedisCacheService', () => {
  it('wrap junta pedidos simultâneos da mesma chave (uma execução)', async () => {
    const cache = new RedisCacheService();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: calls };
    };
    const [a, b, c] = await Promise.all([
      cache.wrap('k', 60, factory),
      cache.wrap('k', 60, factory),
      cache.wrap('k', 60, factory),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('wrap libera a chave quando a factory falha', async () => {
    const cache = new RedisCacheService();
    await expect(cache.wrap('x', 60, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(cache.wrap('x', 60, async () => 'ok')).resolves.toBe('ok');
  });

  it('delPattern usa SCAN (não KEYS)', async () => {
    const cache = new RedisCacheService();
    const client = {
      scan: jest.fn()
        .mockResolvedValueOnce(['5', ['a:1', 'a:2']])
        .mockResolvedValueOnce(['0', ['a:3']]),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn(),
    };
    (cache as any).client = client;
    (cache as any).isConnected = true;
    await cache.delPattern('a:*');
    expect(client.keys).not.toHaveBeenCalled();
    expect(client.scan).toHaveBeenCalledWith('0', 'MATCH', 'a:*', 'COUNT', 200);
    expect(client.del).toHaveBeenCalledWith('a:1', 'a:2');
    expect(client.del).toHaveBeenCalledWith('a:3');
  });
});
