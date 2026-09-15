import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const MARKETPLACE_SOURCES = [
  'alibaba',
  // A4: fonte de sourcing/custo (nunca preço de venda BR).
  'aliexpress',
  'amazon',
  'amazon_br',
  'mercado_livre',
  'shopee_br',
  'tiktok_shop',
  'taobao',
  '1688',
] as const;

export class RunIntelligenceCollectionDto {
  @IsString()
  @MaxLength(120)
  term!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsIn(MARKETPLACE_SOURCES, { each: true })
  sources!: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 2;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(['BR', 'US', 'GLOBAL'], { each: true })
  geos?: string[];

  @IsOptional()
  @IsBoolean()
  includeDemand?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(7)
  windowDays = 7;
}

export { MARKETPLACE_SOURCES };
