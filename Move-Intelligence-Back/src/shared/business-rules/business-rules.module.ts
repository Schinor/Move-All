import { Global, Module } from '@nestjs/common';
import { BusinessRulesService } from './business-rules.service';

@Global()
@Module({
  providers: [BusinessRulesService],
  exports: [BusinessRulesService],
})
export class BusinessRulesModule {}
