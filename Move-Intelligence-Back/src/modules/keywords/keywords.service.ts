import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { CreateKeywordDto } from './dto/create-keyword.dto';

@Injectable()
export class KeywordsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateKeywordDto) {
    return this.prisma.keywordTerm.upsert({
      where: {
        term_language_category: {
          term: dto.term,
          language: dto.language,
          category: dto.category ?? '',
        },
      },
      update: {
        priority: dto.priority ?? 100,
        active: true,
      },
      create: {
        term: dto.term,
        language: dto.language,
        category: dto.category ?? '',
        priority: dto.priority ?? 100,
      },
    });
  }
}
