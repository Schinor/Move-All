import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RunIntelligenceCollectionDto } from './dto/run-intelligence-collection.dto';
import { RunWeeklyIntelligenceCollectionDto } from './dto/run-weekly-intelligence-collection.dto';
import { RunCollectionDto } from './dto/run-collection.dto';
import { IngestionService } from './ingestion.service';
import { IntelligenceCollectionService } from './intelligence-collection.service';

@Controller('collections')
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly intelligence: IntelligenceCollectionService,
  ) {}

  @Post('run')
  runCollection(@Body() dto: RunCollectionDto) {
    return this.ingestion.runCollection(dto);
  }

  @Post('intelligence')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(202)
  runIntelligenceCollection(@Body() dto: RunIntelligenceCollectionDto) {
    return this.intelligence.start(dto);
  }

  @Post('intelligence/weekly')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @HttpCode(202)
  runWeeklyIntelligenceCollection(@Body() dto: RunWeeklyIntelligenceCollectionDto) {
    return this.intelligence.startWeekly(dto);
  }

  @Get('jobs')
  listIntelligenceJobs(@Query('limit') limit?: string) {
    return this.intelligence.list(Number(limit ?? 20));
  }

  @Get('jobs/:id')
  getIntelligenceJob(@Param('id') id: string) {
    return this.intelligence.get(id);
  }
}
