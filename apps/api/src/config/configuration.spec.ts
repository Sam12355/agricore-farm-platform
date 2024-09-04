import { ConfigurationError, developmentConfig, corsOrigins, loadConfig } from './configuration';

const secrets = {
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  JWT_WORKER_VIEW_SECRET: 'c'.repeat(40),
};

describe('loadConfig', () => {
  it('applies defaults for everything optional', () => {
    const config = loadConfig({ ...secrets });
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3001);
    expect(config.PERSISTENCE).toBe('memory');
  });

  it('refuses to start without signing secrets', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
  });

  it('names the offending variable in the error', () => {
    try {
      loadConfig({ ...secrets, JWT_ACCESS_SECRET: 'short' });
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).message).toContain('JWT_ACCESS_SECRET');
    }
  });

  it('rejects a placeholder secret even if it is long enough', () => {
    expect(() => loadConfig({ ...secrets, JWT_ACCESS_SECRET: 'changeme' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects the same secret being reused across token types', () => {
    const shared = 'z'.repeat(40);
    expect(() =>
      loadConfig({
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
        JWT_WORKER_VIEW_SECRET: 'c'.repeat(40),
      }),
    ).toThrow(/must all be different/);
  });

  it('requires DATABASE_URL when persistence is postgres', () => {
    expect(() => loadConfig({ ...secrets, PERSISTENCE: 'postgres' })).toThrow(/DATABASE_URL/);
  });

  it('accepts postgres persistence once DATABASE_URL is set', () => {
    const config = loadConfig({
      ...secrets,
      PERSISTENCE: 'postgres',
      DATABASE_URL: 'postgres://localhost:5432/agricore',
    });
    expect(config.PERSISTENCE).toBe('postgres');
  });

  it('requires MONGODB_URI when telemetry is mongodb', () => {
    expect(() => loadConfig({ ...secrets, TELEMETRY_STORE: 'mongodb' })).toThrow(/MONGODB_URI/);
  });

  it('requires REDIS_URL when cache is redis', () => {
    expect(() => loadConfig({ ...secrets, CACHE: 'redis' })).toThrow(/REDIS_URL/);
  });

  it('requires a queue url when the transport is sqs', () => {
    expect(() => loadConfig({ ...secrets, NOTIFICATION_TRANSPORT: 'sqs' })).toThrow(
      /SQS_QUEUE_URL/,
    );
  });

  it('will not let production run on the in-memory adapters', () => {
    expect(() => loadConfig({ ...secrets, NODE_ENV: 'production' })).toThrow(
      /Production must not run on the in-memory adapters/,
    );
  });

  it('allows production once real adapters are configured', () => {
    const config = loadConfig({
      ...secrets,
      NODE_ENV: 'production',
      PERSISTENCE: 'postgres',
      DATABASE_URL: 'postgres://db/agricore',
      CACHE: 'redis',
      REDIS_URL: 'redis://cache:6379',
    });
    expect(config.NODE_ENV).toBe('production');
  });

  it('coerces numeric variables from strings, because env vars are always strings', () => {
    const config = loadConfig({ ...secrets, PORT: '8080', ACCESS_TOKEN_TTL_SECONDS: '600' });
    expect(config.PORT).toBe(8080);
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(600);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...secrets, PORT: '70000' })).toThrow(ConfigurationError);
  });

  it('caps the access token lifetime, so a typo cannot mint a year-long token', () => {
    expect(() => loadConfig({ ...secrets, ACCESS_TOKEN_TTL_SECONDS: '31536000' })).toThrow(
      ConfigurationError,
    );
  });
});

describe('developmentConfig', () => {
  it('generates a distinct secret per token type on every call', () => {
    const first = developmentConfig();
    const second = developmentConfig();
    expect(first.JWT_ACCESS_SECRET).not.toBe(first.JWT_REFRESH_SECRET);
    expect(first.JWT_ACCESS_SECRET).not.toBe(second.JWT_ACCESS_SECRET);
  });

  it('leaves background workers off, so tests drive them explicitly', () => {
    expect(developmentConfig().ENABLE_BACKGROUND_WORKERS).toBe(false);
  });
});

describe('corsOrigins', () => {
  it('splits and trims a comma separated list', () => {
    const config = loadConfig({
      ...secrets,
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000, https://console.example.com ',
    });
    expect(corsOrigins(config)).toEqual([
      'http://localhost:3000',
      'https://console.example.com',
    ]);
  });

  it('drops empty entries left by a trailing comma', () => {
    const config = loadConfig({ ...secrets, CORS_ALLOWED_ORIGINS: 'http://localhost:3000,' });
    expect(corsOrigins(config)).toEqual(['http://localhost:3000']);
  });
});
