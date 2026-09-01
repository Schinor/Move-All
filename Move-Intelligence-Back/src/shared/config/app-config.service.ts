import { Injectable, Logger } from '@nestjs/common';
import { configuration } from './configuration';

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly values = configuration();

  get<T>(path: string): T | undefined {
    return this.readPath(this.values, path.split('.')) as T | undefined;
  }

  validateRuntime(): void {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL é obrigatória.');
    }
    if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET é obrigatória em produção.');
    }
    if (!process.env.JWT_SECRET) {
      this.logger.warn('JWT_SECRET ausente; usando chave efêmera exclusiva de desenvolvimento.');
    }
    if (!process.env.NVIDIA_API_KEY) {
      this.logger.warn('NVIDIA_API_KEY ausente — recursos de IA ficarão indisponíveis.');
    }
  }

  private readPath(source: unknown, segments: string[]): unknown {
    let current = source;

    for (const segment of segments) {
      if (!this.isRecord(current)) {
        return undefined;
      }

      current = current[segment];
    }

    return current;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
