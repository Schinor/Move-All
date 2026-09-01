import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import IORedis from 'ioredis';
import { PrismaService } from '../../shared/database/prisma.service';
import { AppConfigService } from '../../shared/config/app-config.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async check() {
    const checkedAt = new Date().toISOString();
    let database = false;
    let redis = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }

    const client = new IORedis(this.config.get<string>('redis.url') ?? 'redis://localhost:6379', {
      lazyConnect: true,
      connectTimeout: 1500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    try {
      await client.connect();
      redis = (await client.ping()) === 'PONG';
    } catch {
      redis = false;
    } finally {
      client.disconnect();
    }

    const result = { status: database && redis ? 'ok' : 'unhealthy', database, redis, checkedAt };
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
