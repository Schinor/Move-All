import { Global, Module } from '@nestjs/common';
import { HttpFetcher } from './http-fetcher';

@Global()
@Module({
  providers: [HttpFetcher],
  exports: [HttpFetcher],
})
export class HttpModule {}
