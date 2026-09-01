import { Controller, Get, Query } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';

@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('search')
  search(@Query('q') query = '') {
    return this.discovery.search(query);
  }

  @Get('dashboard/quote')
  quote() {
    return this.discovery.quote();
  }
}
