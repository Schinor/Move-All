import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CatalogReviewService } from './catalog-review.service';
import { ApproveTypeDto, CreateCardDto, MergeTypeDto, MoveListingDto, RenameCardDto, ReviewListQueryDto } from './dto/catalog-review.dto';

type AuthedRequest = { user: { sub: string } };

@Controller('catalog')
@UseGuards(AdminGuard)
export class CatalogReviewController {
  constructor(private readonly review: CatalogReviewService) {}

  @Get('review')
  list(@Query() query: ReviewListQueryDto) {
    return this.review.list(query.kind, query.page ?? 1, query.page_size ?? 20);
  }

  @Get('review/counts')
  counts() {
    return this.review.counts();
  }

  @Get('families')
  families() {
    return this.review.families();
  }

  @Post('review/:id/confirm')
  confirm(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.confirm(id, req.user.sub);
  }

  @Post('review/:id/move')
  move(@Param('id') id: string, @Body() dto: MoveListingDto, @Req() req: AuthedRequest) {
    return this.review.move(id, dto.targetClusterId, req.user.sub);
  }

  @Post('review/:id/create-card')
  createCard(@Param('id') id: string, @Body() dto: CreateCardDto, @Req() req: AuthedRequest) {
    return this.review.createCard(id, dto, req.user.sub);
  }

  @Post('review/:id/out-of-scope')
  outOfScope(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.outOfScope(id, req.user.sub);
  }

  @Post('types/suggestions/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveTypeDto, @Req() req: AuthedRequest) {
    return this.review.approveType(id, dto, req.user.sub);
  }

  @Post('types/suggestions/:id/merge')
  merge(@Param('id') id: string, @Body() dto: MergeTypeDto, @Req() req: AuthedRequest) {
    return this.review.mergeType(id, dto.typeKey, req.user.sub);
  }

  @Post('types/suggestions/:id/discard')
  discard(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.discardType(id, req.user.sub);
  }

  @Patch('cards/:id')
  rename(@Param('id') id: string, @Body() dto: RenameCardDto, @Req() req: AuthedRequest) {
    return this.review.renameCard(id, dto.name, req.user.sub);
  }

  @Post('decisions/:id/undo')
  undo(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.review.undo(id, req.user.sub);
  }
}
