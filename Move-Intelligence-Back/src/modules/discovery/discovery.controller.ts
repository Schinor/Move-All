import { Controller, Get } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';

@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('dashboard/quote')
  quote() {
    return this.discovery.quote();
  }
}
