import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateKeywordDto {
  @IsString()
  term!: string;

  @IsString()
  language!: 'pt' | 'en' | 'zh';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}
