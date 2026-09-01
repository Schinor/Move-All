import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UnitEconomicsSimulateDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  precoVendaBrl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Type(() => Number)
  fobUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  cambioUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  freteUnitarioUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  impostoImportacaoPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(40)
  @Type(() => Number)
  icmsPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(40)
  @Type(() => Number)
  comissaoMarketplacePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  custoFulfillmentBrl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  custoFixoMensalBrl?: number;

  @IsOptional()
  @IsNumber()
  @Min(-5)
  @Max(0)
  @Type(() => Number)
  elasticidadePreco?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  volumeBaseMensal?: number;
}
