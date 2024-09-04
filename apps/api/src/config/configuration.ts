import { randomBytes } from 'node:crypto';

import { z } from 'zod';

/**
 * Configuration is parsed once, at startup, through a schema.
 *
 * If something is missing or malformed the process refuses to start and says which
 * variable is wrong. The alternative is discovering that JWT_ACCESS_SECRET was undefined
 * when a token verification silently fails in production at three in the morning.
 *
 * The secret-length check is not decoration. An HS256 secret shorter than the hash it
 * feeds does not add security, and "changeme" in a deployed environment is a real
 * failure mode, so it is rejected outright outside development.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

const secretSchema = z
  .string()
  .min(32, 'Signing secrets must be at least 32 characters.')
  .refine(
    (value) => !/^(changeme|secret|password|test)$/i.test(value),
    'Refusing to start with a placeholder signing secret.',
  );

export const configSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    SERVICE_NAME: z.string().default('agricore-api'),

    PUBLIC_WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

    JWT_ACCESS_SECRET: secretSchema,
    JWT_REFRESH_SECRET: secretSchema,
    JWT_WORKER_VIEW_SECRET: secretSchema,
    JWT_ISSUER: z.string().default('agricore'),
    JWT_AUDIENCE: z.string().default('agricore-clients'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().default(2_592_000),

    // Which adapter is bound to each port. The demo runs the production code path with
    // different bindings rather than a separate demo mode.
    PERSISTENCE: z.enum(['memory', 'postgres']).default('memory'),
    TELEMETRY_STORE: z.enum(['memory', 'mongodb']).default('memory'),
    CACHE: z.enum(['memory', 'redis']).default('memory'),
    NOTIFICATION_TRANSPORT: z.enum(['inprocess', 'sqs']).default('inprocess'),
    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'ses']).default('console'),
    SMS_PROVIDER: z.enum(['mock', 'sns']).default('mock'),
    PUSH_PROVIDER: z.enum(['mock', 'apns', 'fcm']).default('mock'),
    OBJECT_STORE: z.enum(['memory', 's3']).default('memory'),

    DATABASE_URL: z.string().optional(),
    MONGODB_URI: z.string().optional(),
    REDIS_URL: z.string().optional(),
    SQS_QUEUE_URL: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    AWS_REGION: z.string().default('eu-west-1'),

    RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_WRITE_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_READ_PER_MINUTE: z.coerce.number().int().min(1).default(240),

    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().default(86_400),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2_000),
    ENABLE_BACKGROUND_WORKERS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
  })
  /*
   * Cross-field rules. A misconfigured adapter selection is the kind of mistake that
   * looks fine at boot and then fails on the first write, so it is caught here instead.
   */
  .refine((config) => config.PERSISTENCE !== 'postgres' || Boolean(config.DATABASE_URL), {
    message: 'DATABASE_URL is required when PERSISTENCE is postgres.',
    path: ['DATABASE_URL'],
  })
  .refine((config) => config.TELEMETRY_STORE !== 'mongodb' || Boolean(config.MONGODB_URI), {
    message: 'MONGODB_URI is required when TELEMETRY_STORE is mongodb.',
    path: ['MONGODB_URI'],
  })
  .refine((config) => config.CACHE !== 'redis' || Boolean(config.REDIS_URL), {
    message: 'REDIS_URL is required when CACHE is redis.',
    path: ['REDIS_URL'],
  })
  .refine((config) => config.NOTIFICATION_TRANSPORT !== 'sqs' || Boolean(config.SQS_QUEUE_URL), {
    message: 'SQS_QUEUE_URL is required when NOTIFICATION_TRANSPORT is sqs.',
    path: ['SQS_QUEUE_URL'],
  })
  .refine((config) => config.OBJECT_STORE !== 's3' || Boolean(config.S3_BUCKET), {
    message: 'S3_BUCKET is required when OBJECT_STORE is s3.',
    path: ['S3_BUCKET'],
  })
  .refine(
    (config) =>
      config.NODE_ENV !== 'production' ||
      (config.PERSISTENCE === 'postgres' && config.CACHE === 'redis'),
    {
      message: 'Production must not run on the in-memory adapters.',
      path: ['PERSISTENCE'],
    },
  )
  .refine(
    (config) =>
      new Set([config.JWT_ACCESS_SECRET, config.JWT_REFRESH_SECRET, config.JWT_WORKER_VIEW_SECRET])
        .size === 3,
    {
      // Reusing one secret across token types means a worker-view link and an access
      // token are signed by the same key, and the only thing keeping them apart is a
      // claim check. Separate keys make that a structural boundary instead.
      message: 'Access, refresh and worker-view secrets must all be different.',
      path: ['JWT_ACCESS_SECRET'],
    },
  );

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigurationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(
      `Configuration is not valid:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`,
    );
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return parsed.data;
}

/**
 * Config for tests and for `pnpm dev` with no .env file.
 *
 * Secrets are generated per process. That means a restart invalidates every token, which
 * is mildly annoying in development and exactly right: it guarantees no fixed default
 * secret can ever end up deployed by accident.
 */
export function developmentConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const generate = () => randomBytes(32).toString('hex');
  return loadConfig({
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: generate(),
    JWT_REFRESH_SECRET: generate(),
    JWT_WORKER_VIEW_SECRET: generate(),
    ENABLE_BACKGROUND_WORKERS: 'false',
    ...(Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, String(value)]),
    ) as NodeJS.ProcessEnv),
  });
}

export function corsOrigins(config: AppConfig): string[] {
  return config.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
