import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RunCollectionDto {
  @IsString()
  term!: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  language?: 'pt' | 'en' | 'zh';

  @IsOptional()
  @IsString()
  market?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
