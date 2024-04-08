import type { StructuredLogger } from '../../application/ports';

/**
 * A small JSON logger with a redaction pass built in.
 *
 * I wrote this rather than reaching for pino because the redaction behaviour is the
 * point, and it needed to be something I could test directly. In a location-sharing
 * product the log pipeline is a genuine privacy surface: coordinates in CloudWatch are
 * coordinates retained for as long as the log group lives, read by anyone with logs
 * access, and outside every retention control the product offers the user.
 *
 * So the rule here is that sensitive keys are redacted on the way out, at any depth,
 * regardless of what the caller passed. A developer logging an entire request body by
 * mistake is normal; that should be a redacted line, not an incident.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Matched case-insensitively against key names, at every level of nesting.
 * Latitude and longitude are on this list deliberately, and it is the entry I would
 * defend hardest if someone asked to remove it for debugging convenience.
 */
const REDACTED_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'signedpayload',
  'email',
  'phone',
  'latitude',
  'longitude',
  'coordinates',
  'address',
  'displayname',
  'name',
  'note',
  'body',
] as const;

const REDACTION = '[redacted]';
const MAX_DEPTH = 6;

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_KEYS.some((candidate) => lower === candidate || lower.endsWith(candidate));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = shouldRedact(key) ? REDACTION : redact(nested, depth + 1);
    }
    return output;
  }

  return value;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly service: string;
  readonly environment: string;
  /** Injected so tests can capture output without touching stdout. */
  readonly sink?: (line: string) => void;
}

export class JsonLogger implements StructuredLogger {
  private readonly bindings: Record<string, unknown>;

  constructor(
    private readonly options: LoggerOptions,
    bindings: Record<string, unknown> = {},
  ) {
    this.bindings = bindings;
  }

  child(bindings: Record<string, unknown>): StructuredLogger {
    return new JsonLogger(this.options, { ...this.bindings, ...bindings });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.options.level]) return;

    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: this.options.service,
      env: this.options.environment,
      msg: message,
      ...(redact(this.bindings) as Record<string, unknown>),
      ...(context ? (redact(context) as Record<string, unknown>) : {}),
    });

    const sink = this.options.sink ?? ((output: string) => process.stdout.write(`${output}\n`));
    sink(line);
  }
}

/** Discards everything. Used by tests that do not care about log output. */
export class SilentLogger implements StructuredLogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): StructuredLogger {
    return this;
  }
}
