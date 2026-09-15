import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class RunTrackListingsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  maxCalls = 50;
}
