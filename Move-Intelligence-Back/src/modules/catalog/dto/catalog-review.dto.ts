import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ReviewListQueryDto {
  @IsIn(['provisional_listing', 'suggested_type'])
  kind!: 'provisional_listing' | 'suggested_type';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  page_size?: number;
}

export class MoveListingDto {
  @IsUUID()
  targetClusterId!: string;
}

export class CreateCardDto {
  @IsString() @MinLength(2)
  typeKey!: string;

  @IsObject()
  cardKeyValues!: Record<string, string>;

  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  name?: string;
}

export class ApproveTypeDto {
  @IsString()
  familyKey!: string;

  @IsString() @Matches(/^[a-z][a-z0-9_]*$/)
  key!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  namePt!: string;

  @IsOptional() @IsString() @MaxLength(20)
  ncm?: string;
}

export class MergeTypeDto {
  @IsString()
  typeKey!: string;
}

export class RenameCardDto {
  @IsString() @MinLength(3) @MaxLength(120)
  name!: string;
}
