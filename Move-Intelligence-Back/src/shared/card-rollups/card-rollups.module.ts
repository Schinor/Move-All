import { Global, Module } from '@nestjs/common';
import { CardRollupsScheduler } from './card-rollups.scheduler';
import { CardRollupsService } from './card-rollups.service';

@Global()
@Module({ providers: [CardRollupsService, CardRollupsScheduler], exports: [CardRollupsService] })
export class CardRollupsModule {}
