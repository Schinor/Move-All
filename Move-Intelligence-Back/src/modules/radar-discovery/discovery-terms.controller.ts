import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { DiscoveryTermsService } from './discovery-terms.service';
import { DiscoveryTermsQueryDto } from './dto/discovery-terms.dto';

type AuthedRequest = { user: { sub: string } };

@Controller('discovery')
@UseGuards(AdminGuard)
export class DiscoveryTermsController {
  constructor(private readonly terms: DiscoveryTermsService) {}

  @Get('terms')
  list(@Query() query: DiscoveryTermsQueryDto) {
    return this.terms.list(query);
  }

  @Get('terms/counts')
  counts() {
    return this.terms.counts();
  }

  @Post('terms/:id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.approve(id, req.user.sub);
  }

  @Post('terms/:id/ignore')
  ignore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.ignore(id, req.user.sub);
  }

  @Post('terms/:id/restore')
  restore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.terms.restore(id, req.user.sub);
  }
}
