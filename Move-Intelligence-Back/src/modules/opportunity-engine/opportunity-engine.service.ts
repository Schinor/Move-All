import { Injectable } from '@nestjs/common';
import { BusinessRulesService } from '../../shared/business-rules/business-rules.service';
import { OpportunityScoreBreakdown } from '../../shared/types/scoring.types';

@Injectable()
export class OpportunityEngineService {
  constructor(private readonly rules: BusinessRulesService) {}

  calculate(params: {
    trendScore: number;
    marginScore: number;
    westernSaturationScore: number;
  }): OpportunityScoreBreakdown {
    const trendScore = this.rules.clamp(params.trendScore);
    const marginScore = this.rules.clamp(params.marginScore);
    const westernSaturationScore = this.rules.clamp(
      params.westernSaturationScore,
    );

    return {
      trendScore,
      marginScore,
      westernSaturationScore,
      opportunityScore: this.rules.clamp(
        trendScore * marginScore * (1 - westernSaturationScore),
      ),
    };
  }
}
