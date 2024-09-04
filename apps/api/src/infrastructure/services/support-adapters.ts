import { randomUUID } from 'node:crypto';

import {
  DeliveryStatus,
  DomainErrors,
  type DomainError,
  NotificationChannel,
  type Result,
  err,
  ok,
} from '@agricore/shared-types';

import type {
  DistributedLock,
  IdGenerator,
  NotificationChannelAdapter,
  NotificationMessage,
  ObjectStore,
  RateLimiter,
  StoreReceiptVerifier,
  StructuredLogger,
} from '../../application/ports';

export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}

/**
 * Predictable identifiers for tests.
 *
 * Still UUID-shaped, which matters: the contracts validate path and body identifiers
 * with z.string().uuid(), so a generator that emitted "id-0001" would make every test
 * fail validation for a reason that has nothing to do with what is under test. The
 * counter goes in the last group so the values stay readable in a failure message.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '0000') {}

  next(): string {
    this.counter += 1;
    const suffix = String(this.counter).padStart(12, '0');
    // Non-hex characters in the prefix would produce something that looks like a uuid
    // but fails uuid validation, which is a confusing way for a test to fail.
    const group = this.prefix.replace(/[^0-9a-f]/gi, '0').padStart(4, '0').slice(0, 4);
    return `${group}0000-0000-4000-8000-${suffix}`;
  }
}

/**
 * Fixed-window rate limiter.
 *
 * A sliding window would be smoother, but the failure mode of a fixed window here is a
 * caller getting up to double the limit across a boundary, which is acceptable for the
 * thing this protects: brute-force attempts against login and floods of writes. The
 * Redis adapter uses the same interface with INCR and EXPIRE.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }> {
    const now = this.now();
    const bucket = this.buckets.get(key);

    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1 };
    }

    if (bucket.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export class MemoryDistributedLock implements DistributedLock {
  private readonly held = new Map<string, number>();

  async acquire(key: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null> {
    const now = Date.now();
    const expiry = this.held.get(key);
    if (expiry !== undefined && expiry > now) return null;

    this.held.set(key, now + ttlMs);
    return {
      release: async () => {
        this.held.delete(key);
      },
    };
  }
}

export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { body: string; contentType: string }>();

  async put(key: string, body: string, contentType: string): Promise<{ url: string; sizeBytes: number }> {
    this.objects.set(key, { body, contentType });
    return { url: `memory://${key}`, sizeBytes: Buffer.byteLength(body, 'utf8') };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  read(key: string): string | null {
    return this.objects.get(key)?.body ?? null;
  }
}

/**
 * Local notification providers.
 *
 * These exist so `docker compose up` produces a working system with no AWS account, no
 * Twilio account and no APNs key. They implement the same adapter interface the SES, SNS
 * and FCM adapters do, so nothing above them knows the difference.
 */
export class ConsoleEmailAdapter implements NotificationChannelAdapter {
  readonly channel = NotificationChannel.Email;

  constructor(private readonly logger: StructuredLogger) {}

  async send(message: NotificationMessage): Promise<Result<{ providerRef: string }, DomainError>> {
    if (message.to.email === null) {
      return err(DomainErrors.validation('That worker has no email address.'));
    }
    // The address itself never reaches the log; the redaction layer would strip it
    // anyway, and the reference is what a manager actually needs to trace a delivery.
    this.logger.info('email delivered to local provider', {
      correlationId: message.correlationId,
      subject: message.subject,
    });
    return ok({ providerRef: `console-email-${randomUUID()}` });
  }
}

export class MockSmsAdapter implements NotificationChannelAdapter {
  readonly channel = NotificationChannel.Sms;

  constructor(private readonly logger: StructuredLogger) {}

  async send(message: NotificationMessage): Promise<Result<{ providerRef: string }, DomainError>> {
    if (message.to.phone === null) {
      return err(DomainErrors.validation('That worker has no phone number.'));
    }
    this.logger.info('sms delivered to mock provider', {
      correlationId: message.correlationId,
    });
    return ok({ providerRef: `mock-sms-${randomUUID()}` });
  }
}

export class MockPushAdapter implements NotificationChannelAdapter {
  readonly channel = NotificationChannel.Push;

  constructor(private readonly logger: StructuredLogger) {}

  async send(message: NotificationMessage): Promise<Result<{ providerRef: string }, DomainError>> {
    this.logger.info('push delivered to mock provider', {
      correlationId: message.correlationId,
    });
    return ok({ providerRef: `mock-push-${randomUUID()}` });
  }
}

/**
 * An adapter that fails on demand. Used by the retry and dead-letter tests, which are
 * the only way to show that the reliability code does what the README says it does.
 */
export class FailingChannelAdapter implements NotificationChannelAdapter {
  private calls = 0;

  constructor(
    readonly channel: NotificationChannel,
    private readonly failuresBeforeSuccess: number,
  ) {}

  get callCount(): number {
    return this.calls;
  }

  async send(): Promise<Result<{ providerRef: string }, DomainError>> {
    this.calls += 1;
    if (this.calls <= this.failuresBeforeSuccess) {
      return err(DomainErrors.dependencyUnavailable('notification provider'));
    }
    return ok({ providerRef: `recovered-${this.calls}` });
  }
}

/**
 * Store receipt verification.
 *
 * The real implementations call Apple's App Store Server API and Google's Play Developer
 * API, both of which need credentials this repository does not have and must not have.
 * This one accepts a documented sandbox payload shape so the subscription path can be
 * exercised end to end without an account. It refuses anything that does not carry the
 * sandbox marker, so it cannot be mistaken for a real verifier if it is ever bound in a
 * deployed environment by accident.
 */
export class SandboxReceiptVerifier implements StoreReceiptVerifier {
  async verify(input: {
    platform: 'apple' | 'google';
    productId: string;
    signedPayload: string;
  }): Promise<
    Result<
      { productId: string; expiresAt: Date | null; autoRenewing: boolean; originalTransactionId: string },
      DomainError
    >
  > {
    if (!input.signedPayload.startsWith('sandbox:')) {
      return err(
        DomainErrors.validation(
          'This build only accepts sandbox receipts. Real store verification needs credentials that are not in this repository.',
        ),
      );
    }

    const parts = input.signedPayload.split(':');
    const transactionId = parts[1] ?? 'sandbox-transaction';
    const daysValid = Number(parts[2] ?? '30');

    return ok({
      productId: input.productId,
      expiresAt: new Date(Date.now() + daysValid * 86_400_000),
      autoRenewing: true,
      originalTransactionId: transactionId,
    });
  }
}

export const DELIVERY_TERMINAL_STATES: readonly DeliveryStatus[] = [
  DeliveryStatus.Delivered,
  DeliveryStatus.DeadLettered,
  DeliveryStatus.Suppressed,
];
