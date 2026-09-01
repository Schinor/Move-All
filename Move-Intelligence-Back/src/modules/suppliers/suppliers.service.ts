import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForProductCluster(productClusterId: string) {
    const snapshots = await this.prisma.productListingSnapshot.findMany({
      where: { productClusterId },
      distinct: ['marketplace', 'sellerId'],
      orderBy: { collectedAt: 'desc' },
      take: 200,
    });

    return snapshots.map((snapshot) => ({
      marketplace: snapshot.marketplace,
      seller_id: snapshot.sellerId,
      seller_name: snapshot.sellerName,
      last_seen_at: snapshot.collectedAt,
    }));
  }
}
