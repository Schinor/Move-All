import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { MARKETPLACE_SOURCES } from './run-intelligence-collection.dto';

export const INTELLIGENCE_CLUSTERS = [
  'resistance_bands',
  'dumbbells',
  'vibration_plate',
  'compact_cardio',
  'kettlebells',
  'ab_wheel',
  'rowing_machine',
  'pull_up_equipment',
  'recovery_massage',
  'yoga_pilates',
  'yoga_mat',
  'weight_bench',
  'push_up_equipment',
  'jump_rope',
  'home_gym_station',
  'home_fitness_equipment',
] as const;

export class RunWeeklyIntelligenceCollectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsIn(MARKETPLACE_SOURCES, { each: true })
  sources: string[] = [...MARKETPLACE_SOURCES];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 10;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(['BR', 'US', 'GLOBAL'], { each: true })
  geos: string[] = ['BR', 'US'];

  @IsBoolean()
  includeDemand = true;

  @IsIn(['canonical', 'all'])
  keywordDepth: 'canonical' | 'all' = 'all';

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(7)
  windowDays = 7;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsIn(INTELLIGENCE_CLUSTERS, { each: true })
  clusters?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  maxTerms?: number;
}
