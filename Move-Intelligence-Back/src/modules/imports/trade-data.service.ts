import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';

interface TradeExportsQuery {
  ncm?: string;
  year?: number;
  country?: string;
  skip?: number;
  take?: number;
}

interface ShipmentsQuery {
  hsCode?: string;
  importerCountry?: string;
  skip?: number;
  take?: number;
}

function clampTake(take?: number): number {
  return Math.min(Math.max(take ?? 50, 1), 200);
}

/** Leitura dos dados normalizados importados, para as telas consumirem. */
@Injectable()
export class TradeDataService {
  constructor(private readonly prisma: PrismaService) {}

  async listTradeExports(query: TradeExportsQuery) {
    const where: Prisma.TradeExportWhereInput = {};
    if (query.ncm) {
      where.ncmCode = { startsWith: query.ncm };
    }
    if (typeof query.year === 'number' && !Number.isNaN(query.year)) {
      where.year = query.year;
    }
    if (query.country) {
      where.country = { contains: query.country, mode: 'insensitive' };
    }

    const take = clampTake(query.take);
    const skip = Math.max(query.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.tradeExport.findMany({
        where,
        orderBy: [{ year: 'desc' }, { fobUsd: 'desc' }],
        skip,
        take,
      }),
      this.prisma.tradeExport.count({ where }),
    ]);
    return { items, total, skip, take };
  }

  async listShipments(query: ShipmentsQuery) {
    const where: Prisma.ShipmentWhereInput = {};
    if (query.hsCode) {
      where.hsCode = { contains: query.hsCode };
    }
    if (query.importerCountry) {
      where.importerCountry = {
        contains: query.importerCountry,
        mode: 'insensitive',
      };
    }

    const take = clampTake(query.take);
    const skip = Math.max(query.skip ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        orderBy: { arrivalDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total, skip, take };
  }
}
