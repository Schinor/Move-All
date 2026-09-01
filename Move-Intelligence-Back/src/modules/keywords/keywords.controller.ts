import { Body, Controller, Post } from '@nestjs/common';
import { CreateKeywordDto } from './dto/create-keyword.dto';
import { KeywordsService } from './keywords.service';

@Controller('keywords')
export class KeywordsController {
  constructor(private readonly keywords: KeywordsService) {}

  @Post()
  create(@Body() dto: CreateKeywordDto) {
    return this.keywords.create(dto);
  }
}
