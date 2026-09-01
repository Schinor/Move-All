import { Module } from '@nestjs/common';
import { TranslationModule } from '../translation/translation.module';
import { NormalizationService } from './normalization.service';

@Module({
  imports: [TranslationModule],
  providers: [NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}
