import { IsOptional, IsString } from 'class-validator';

export class CreateWatchlistItemDto {
  @IsString()
  productClusterId!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}
