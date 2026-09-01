import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const config = app.get(AppConfigService);
  config.validateRuntime();

  await app.register(helmet);
  await app.register(cors, {
    origin: config.get<string[]>('security.corsOrigins') ?? [],
    credentials: true,
  });

  const maxUploadBytes =
    config.get<number>('imports.maxUploadBytes') ?? 20 * 1024 * 1024;
  await app.register(multipart, {
    limits: { fileSize: maxUploadBytes, files: 1 },
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const port = config.get<number>('app.port') ?? 3000;
  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap();
