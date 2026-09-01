export const configuration = () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  security: {
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  imports: {
    storageDir:
      process.env.IMPORTS_STORAGE_DIR ??
      `${process.cwd()}/storage/imports`,
    maxUploadBytes: Number(process.env.IMPORTS_MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024),
    useQueue: (process.env.IMPORTS_USE_QUEUE ?? 'true') !== 'false',
  },
  sources: {
    aliexpress: {
      apiKey: process.env.ALIEXPRESS_API_KEY,
    },
    apify: {
      token: process.env.APIFY_TOKEN,
    },
    googleTrends: {
      providerUrl: process.env.GOOGLE_TRENDS_PROVIDER_URL,
    },
    googleShopping: {
      providerUrl: process.env.GOOGLE_SHOPPING_PROVIDER_URL,
    },
    amazon: {
      providerUrl: process.env.AMAZON_PROVIDER_URL,
    },
    xiaohongshu: {
      providerUrl: process.env.XIAOHONGSHU_PROVIDER_URL,
    },
    douyin: {
      providerUrl: process.env.DOUYIN_PROVIDER_URL,
    },
  },
});
