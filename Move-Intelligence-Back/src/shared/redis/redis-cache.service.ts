import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private isConnected = false;
  private readonly memoryCache = new Map<string, { value: string; expiresAt: number }>();

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

    try {
      this.client = new IORedis(redisUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 4000,
        lazyConnect: false,
        enableOfflineQueue: false,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 1000, 5000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log('RedisCacheService conectado ao Redis com sucesso.');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        this.logger.warn(`Redis indisponível (${err.message}). Utilizando cache in-memory fallback.`);
      });
    } catch (err) {
      this.isConnected = false;
      this.logger.warn(`Falha ao inicializar IORedis: ${err}. Usando cache fallback.`);
    }
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  get isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.isAvailable && this.client) {
        const data = await this.client.get(key);
        if (!data) return null;
        return JSON.parse(data) as T;
      }
    } catch (err) {
      this.logger.debug(`Erro ao ler cache Redis (chave ${key}): ${err}`);
    }

    // Fallback in-memory
    const cached = this.memoryCache.get(key);
    if (cached) {
      if (Date.now() > cached.expiresAt) {
        this.memoryCache.delete(key);
        return null;
      }
      return JSON.parse(cached.value) as T;
    }
    return null;
  }

  async set(key: string, value: unknown, ttlSeconds = 3600): Promise<void> {
    const serialized = JSON.stringify(value);
    try {
      if (this.isAvailable && this.client) {
        await this.client.setex(key, ttlSeconds, serialized);
        return;
      }
    } catch (err) {
      this.logger.debug(`Erro ao salvar cache Redis (chave ${key}): ${err}`);
    }

    // Fallback in-memory
    this.memoryCache.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    // Limpeza periódica da memória se ultrapassar 500 chaves
    if (this.memoryCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of this.memoryCache.entries()) {
        if (now > v.expiresAt) this.memoryCache.delete(k);
      }
    }
  }

  async del(key: string): Promise<void> {
    try {
      if (this.isAvailable && this.client) {
        await this.client.del(key);
      }
    } catch (err) {
      this.logger.debug(`Erro ao deletar cache Redis (chave ${key}): ${err}`);
    }
    this.memoryCache.delete(key);
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      if (this.isAvailable && this.client) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      }
    } catch (err) {
      this.logger.debug(`Erro ao limpar padrão Redis (${pattern}): ${err}`);
    }

    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    for (const k of this.memoryCache.keys()) {
      if (regex.test(k)) this.memoryCache.delete(k);
    }
  }

  /**
   * Helper pattern: busca do cache ou executa factory, salvando com TTL.
   */
  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const fresh = await factory();
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }
}
