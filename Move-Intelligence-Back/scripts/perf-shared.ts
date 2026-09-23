import { INestApplicationContext } from '@nestjs/common';
import { PrismaService } from '../src/shared/database/prisma.service';
import { DashboardApiService } from '../src/modules/dashboard-api/dashboard-api.service';

/** Até a Tarefa 9 não existe CardRollupsService: devolve undefined sem quebrar. */
export function cardRollupsIfAvailable(app: INestApplicationContext): never {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../src/shared/card-rollups/card-rollups.service');
    return app.get(mod.CardRollupsService, { strict: false }) as never;
  } catch {
    return undefined as never;
  }
}

/** Monta o DashboardApiService sem cache e sem OpenRouter; o 6º argumento (CardRollupsService) só existe a partir da Tarefa 9. */
export function newDashboard(prisma: PrismaService, connectors: unknown, taxonomy: unknown, cardRollups: unknown): DashboardApiService {
  const Ctor = DashboardApiService as unknown as new (...args: unknown[]) => DashboardApiService;
  return new Ctor(prisma, connectors, undefined, undefined, taxonomy, cardRollups);
}

/** 3 cards fixos: maior, do meio e menor em número de anúncios contados (desempate por id). */
export async function pickProbeCards(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cluster_id: string }>>(
    `select cluster_id from product_cluster_items where status in ('confirmed','auto')
     group by cluster_id order by count(*) desc, cluster_id asc`,
  );
  const ids = rows.map((r) => r.cluster_id);
  return [ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]];
}
