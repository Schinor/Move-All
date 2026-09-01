import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string) {
    const term = query.trim();
    if (term.length < 2) return { clusters: [], products: [] };
    const [clusters, products] = await Promise.all([
      this.prisma.productCluster.findMany({
        where: { canonicalName: { contains: term, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.intelligenceProduct.findMany({
        where: { title: { contains: term, mode: 'insensitive' } },
        orderBy: { capturedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          title: true,
          source: true,
          recordId: true,
          cluster: true,
          capturedAt: true,
        },
      }),
    ]);
    return { clusters, products };
  }

  quote() {
    return this.prisma.exchangeRate.findFirst({
      orderBy: { capturedAt: 'desc' },
    });
  }
}
