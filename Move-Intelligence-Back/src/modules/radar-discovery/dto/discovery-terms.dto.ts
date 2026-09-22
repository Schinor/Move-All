import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class DiscoveryTermsQueryDto {
  /** Um ou mais status separados por vírgula (ex.: "approved,searched"). */
  @IsOptional()
  @Matches(/^(new|approved|searched|ignored)(,(new|approved|searched|ignored))*$/)
  status?: string;

  @IsOptional()
  @IsIn(['BR', 'US'])
  geo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  family?: string;
}
