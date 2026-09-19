export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function remainingFichaCalls(
  prisma: { aiCallLog: { count(args: unknown): Promise<number> } },
  limit: number,
  now: Date = new Date(),
): Promise<number> {
  const used = await prisma.aiCallLog.count({ where: { createdAt: { gte: startOfUtcDay(now) } } });
  return Math.max(0, limit - used);
}
