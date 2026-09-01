import { Module } from '@nestjs/common';
import { ProductMatchingService } from './product-matching.service';

@Module({
  providers: [ProductMatchingService],
  exports: [ProductMatchingService],
})
export class ProductMatchingModule {}
