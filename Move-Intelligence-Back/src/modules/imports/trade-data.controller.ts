import { Controller, Get, Query } from '@nestjs/common';
import { TradeDataService } from './trade-data.service';

@Controller()
export class TradeDataController {
  constructor(private readonly tradeData: TradeDataService) {}

  @Get('trade-exports')
  listTradeExports(
    @Query('ncm') ncm?: string,
    @Query('year') year?: string,
    @Query('country') country?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.tradeData.listTradeExports({
      ncm,
      year: year ? Number(year) : undefined,
      country,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('shipments')
  listShipments(
    @Query('hsCode') hsCode?: string,
    @Query('importerCountry') importerCountry?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.tradeData.listShipments({
      hsCode,
      importerCountry,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }
}
