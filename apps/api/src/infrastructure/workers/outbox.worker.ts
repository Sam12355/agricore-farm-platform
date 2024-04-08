import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { NotificationDispatchService } from '../../application/services/notification-dispatch.service';
import { PORTS } from '../../application/tokens';
import type { StructuredLogger } from '../../application/ports';

/**
 * Drains the outbox on a timer.
 *
 * In a deployed environment this is an SQS consumer in its own task. Locally it is a
 * setInterval in the API process, which keeps `docker compose up` down to one container
 * for the application and needs no AWS account. Both call the same dispatch service, so
 * the thing being exercised locally is the thing that runs in production.
 *
 * The tests do not use this at all: they call drain() directly, which is why the suite
 * has no sleeps and no flakiness around timing.
 */
@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private draining: Promise<void> = Promise.resolve();

  constructor(
    private readonly dispatch: NotificationDispatchService,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  start(intervalMs: number): void {
    if (this.timer !== null) return;
    this.running = true;

    this.timer = setInterval(() => {
      // Skip a tick rather than overlapping runs. Two concurrent drains would both claim
      // work and the SKIP LOCKED semantics would keep them apart, but overlapping timers
      // in one process is just wasted contention.
      this.draining = this.draining.then(() => this.tick());
    }, intervalMs);

    // Do not keep the process alive purely because a timer is pending.
    this.timer.unref?.();
    this.logger.info('outbox worker started', { intervalMs });
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const result = await this.dispatch.drain();
      if (result.processed > 0 || result.failed > 0) {
        this.logger.info('outbox drained', result);
      }
    } catch (error) {
      // A worker that dies on the first unexpected error stops delivering every
      // subsequent notification. Log and carry on to the next tick.
      this.logger.error('outbox drain threw', {
        cause: error instanceof Error ? error : String(error),
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Let an in-flight drain finish so shutdown does not lose a message that has already
    // been claimed.
    await this.draining;
    this.logger.info('outbox worker stopped');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }
}
