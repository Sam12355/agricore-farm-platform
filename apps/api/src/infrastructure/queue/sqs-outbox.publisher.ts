import type { OutboxMessage, OutboxRepository, StructuredLogger } from '../../application/ports';

/**
 * The SQS side of the outbox.
 *
 * The relay reads unpublished rows and publishes them. Two orderings are possible and only
 * one is safe:
 *
 *   publish, then mark  -> a crash between them republishes. The consumer deduplicates.
 *   mark, then publish  -> a crash between them loses the message. Nothing recovers it.
 *
 * This does the first. At-least-once delivery with an idempotent consumer produces the
 * right outcome for the person at the end of it; at-most-once produces an alert that was
 * never sent, and nobody finds out.
 *
 * The SDK is behind an interface rather than imported directly. It keeps @aws-sdk out of
 * the dependency graph for anyone running the default in-process transport, and it means
 * this class is testable with a fake that records what was published.
 */

export interface SqsClientLike {
  sendMessageBatch(input: {
    queueUrl: string;
    entries: Array<{ id: string; body: string; deduplicationId?: string }>;
  }): Promise<{ failed: Array<{ id: string; message: string }> }>;
}

export class SqsOutboxRelay {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly sqs: SqsClientLike,
    private readonly queueUrl: string,
    private readonly logger: StructuredLogger,
    private readonly now: () => Date,
  ) {}

  /** SQS caps a batch at ten entries. Not a tuning choice. */
  private static readonly BATCH_SIZE = 10;

  async drain(maxBatches = 5): Promise<{ published: number; failed: number }> {
    let published = 0;
    let failed = 0;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const messages = await this.outbox.claimBatch(SqsOutboxRelay.BATCH_SIZE, this.now());
      if (messages.length === 0) break;

      const result = await this.publish(messages);
      published += result.published;
      failed += result.failed;

      // A short batch means the queue is drained. Stopping here rather than looping to
      // maxBatches keeps the relay from spinning on an empty outbox.
      if (messages.length < SqsOutboxRelay.BATCH_SIZE) break;
    }

    return { published, failed };
  }

  private async publish(
    messages: readonly OutboxMessage[],
  ): Promise<{ published: number; failed: number }> {
    const response = await this.sqs.sendMessageBatch({
      queueUrl: this.queueUrl,
      entries: messages.map((message) => ({
        id: message.id,
        body: JSON.stringify({
          topic: message.topic,
          payload: message.payload,
          correlationId: message.correlationId,
          dedupeKey: message.dedupeKey,
        }),
        // Only meaningful on a FIFO queue. On a standard queue it is ignored, and the
        // consumer's own dedupe key is what actually prevents a duplicate reaching a
        // person. Sent anyway so switching the queue type later needs no code change.
        ...(message.dedupeKey === null ? {} : { deduplicationId: message.dedupeKey }),
      })),
    });

    const failedIds = new Set(response.failed.map((failure) => failure.id));
    const at = this.now();

    for (const message of messages) {
      if (failedIds.has(message.id)) continue;
      // Marked only after SQS accepted it. A crash before this republishes, which the
      // consumer handles.
      await this.outbox.markPublished(message.id, at);
    }

    for (const failure of response.failed) {
      await this.outbox.markFailed(
        failure.id,
        failure.message,
        at,
        // Retried on the next pass rather than with a growing backoff. A publish failure
        // is an SQS or network problem, not a message problem, and delaying it would delay
        // every message behind it.
        at,
      );

      this.logger.warn('outbox publish failed', {
        outboxId: failure.id,
        reason: failure.message,
      });
    }

    return { published: messages.length - response.failed.length, failed: response.failed.length };
  }
}

/**
 * The in-process transport, used locally and in tests.
 *
 * It implements the same relay contract by handing the message straight to a consumer
 * function. `docker compose up` therefore produces a working system with no AWS account
 * and no LocalStack, and the code above it is identical either way.
 */
export class InProcessOutboxRelay {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly consume: (message: OutboxMessage) => Promise<void>,
    private readonly logger: StructuredLogger,
    private readonly now: () => Date,
  ) {}

  async drain(batchSize = 25): Promise<{ published: number; failed: number }> {
    const messages = await this.outbox.claimBatch(batchSize, this.now());

    let published = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        await this.consume(message);
        await this.outbox.markPublished(message.id, this.now());
        published += 1;
      } catch (error) {
        failed += 1;
        await this.outbox.markFailed(
          message.id,
          error instanceof Error ? error.message : String(error),
          this.now(),
          this.now(),
        );
        this.logger.warn('in-process outbox delivery failed', { outboxId: message.id });
      }
    }

    return { published, failed };
  }
}
