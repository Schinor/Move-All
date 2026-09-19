import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CopilotModule } from './modules/copilot/copilot.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { HealthModule } from './modules/health/health.module';
import { AiGatewayModule } from './modules/ai-gateway/ai-gateway.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { DashboardApiModule } from './modules/dashboard-api/dashboard-api.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { KeywordsModule } from './modules/keywords/keywords.module';
import { NormalizationModule } from './modules/normalization/normalization.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ProductsModule } from './modules/products/products.module';
import { SnapshotsModule } from './modules/snapshots/snapshots.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { BusinessRulesModule } from './shared/business-rules/business-rules.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';
import { HttpModule } from './shared/http/http.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    HttpModule,
    BusinessRulesModule,
    ConnectorsModule,
    NormalizationModule,
    CatalogModule,
    SnapshotsModule,
    AlertsModule,
    SuppliersModule,
    ProductsModule,
    DashboardApiModule,
    KeywordsModule,
    IngestionModule,
    ImportsModule,
    AuthModule,
    DiscoveryModule,
    CopilotModule,
    HealthModule,
    AiGatewayModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
