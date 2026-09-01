import { Injectable } from '@nestjs/common';
import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { MarginEstimate } from '../../shared/types/scoring.types';

export interface MarginInput {
  supplierPrice: number;
  estimatedSalePrice: number;
  exchangeRate: number;
  domesticFreightEstimate?: number;
  internationalFreightEstimate?: number;
  importTaxRate?: number;
  operationalFeeRate?: number;
  agentFee?: number;
}

@Injectable()
export class MarginEngineService {
  constructor(private readonly rules: BusinessRulesService) {}

  estimate(input: MarginInput): MarginEstimate {
    const originCost =
      input.supplierPrice +
      (input.domesticFreightEstimate ?? 0) +
      (input.agentFee ?? 0);
    const originCostBrl = originCost * input.exchangeRate;
    const freightBrl = (input.internationalFreightEstimate ?? 0) * input.exchangeRate;
    const taxableBase = originCostBrl + freightBrl;
    const taxes = taxableBase * (input.importTaxRate ?? 0);
    const operationalFees =
      input.estimatedSalePrice * (input.operationalFeeRate ?? 0);
    const landedCost = taxableBase + taxes + operationalFees;
    const margin = input.estimatedSalePrice - landedCost;
    const marginPct =
      input.estimatedSalePrice > 0 ? margin / input.estimatedSalePrice : 0;

    return {
      originCost,
      landedCost,
      estimatedSalePrice: input.estimatedSalePrice,
      margin,
      marginPct,
      marginScore: this.rules.clamp(
        marginPct / this.rules.getMinimumMarginPct(),
      ),
    };
  }
}
