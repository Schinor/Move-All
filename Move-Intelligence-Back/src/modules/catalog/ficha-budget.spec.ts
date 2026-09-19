import { remainingFichaCalls, startOfUtcDay } from './ficha-budget';

describe('ficha-budget', () => {
  it('início do dia é 00:00 UTC', () => {
    expect(startOfUtcDay(new Date('2026-09-18T02:30:00-03:00')).toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('conta todas as chamadas do dia (todos os endpoints) e desconta do limite', async () => {
    const prisma = { aiCallLog: { count: jest.fn().mockResolvedValue(30) } };
    const now = new Date('2026-09-18T15:00:00Z');
    await expect(remainingFichaCalls(prisma, 35, now)).resolves.toBe(5);
    expect(prisma.aiCallLog.count).toHaveBeenCalledWith({ where: { createdAt: { gte: new Date('2026-09-18T00:00:00.000Z') } } });
  });

  it('nunca negativo', async () => {
    const prisma = { aiCallLog: { count: jest.fn().mockResolvedValue(80) } };
    await expect(remainingFichaCalls(prisma, 35)).resolves.toBe(0);
  });
});
