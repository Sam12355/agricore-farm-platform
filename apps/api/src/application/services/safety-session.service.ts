import { Inject, Injectable } from '@nestjs/common';

import type { EndSafetySessionRequest, StartSafetySessionRequest } from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Page,
  type Result,
  err,
  minutes,
  normaliseLimit,
  ok,
} from '@guardianlink/shared-types';

import { PORTS } from '../tokens';
import type {
  IdGenerator,
  SafetySessionRecord,
  SafetySessionRepository,
  StructuredLogger,
} from '../ports';

/**
 * A safety session is the "I am walking home, check on me if I do not arrive" case.
 *
 * One active session per user at a time. Allowing several sounds harmless until an
 * overdue sweep has to decide which one the user meant, and the answer is always the one
 * they last started, so the constraint may as well be explicit.
 */
@Injectable()
export class SafetySessionService {
  constructor(
    @Inject(PORTS.SafetySessionRepository) private readonly sessions: SafetySessionRepository,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async start(
    userId: string,
    input: StartSafetySessionRequest,
  ): Promise<Result<SafetySessionRecord, DomainError>> {
    const active = await this.sessions.findActiveForUser(userId);
    if (active !== null) {
      return err(
        DomainErrors.conflict('You already have a safety session running.', {
          sessionId: active.id,
        }),
      );
    }

    const now = this.clock.now();
    const record: SafetySessionRecord = {
      id: this.ids.next(),
      userId,
      status: 'active',
      startedAt: now,
      expectedEndAt: new Date(now.getTime() + minutes(input.expectedDurationMinutes)),
      endedAt: null,
      note: input.note ?? null,
      destinationLabel: input.destinationLabel ?? null,
      shareLiveLocation: input.shareLiveLocation,
    };

    await this.sessions.insert(record);
    this.logger.info('safety session started', { userId, sessionId: record.id });
    return ok(record);
  }

  async end(
    userId: string,
    sessionId: string,
    input: EndSafetySessionRequest,
  ): Promise<Result<SafetySessionRecord, DomainError>> {
    const session = await this.sessions.findById(sessionId);
    if (session === null || session.userId !== userId) {
      return err(DomainErrors.notFound('Safety session'));
    }
    if (session.status !== 'active') {
      return err(DomainErrors.invalidState(`This session is already ${session.status}.`));
    }

    const updated: SafetySessionRecord = {
      ...session,
      status: input.outcome === 'arrived_safely' ? 'completed' : 'expired',
      endedAt: this.clock.now(),
    };
    await this.sessions.update(updated);
    return ok(updated);
  }

  async list(userId: string, limit?: number, cursor?: string): Promise<Page<SafetySessionRecord>> {
    return this.sessions.listForUser(userId, { limit: normaliseLimit(limit), cursor });
  }

  /**
   * Finds sessions that ran past their expected end without being closed.
   *
   * The scheduled job that calls this is what turns "she said she would be home by ten"
   * into an incident. It is deliberately a separate step from creating the incident, so
   * the sweep can be run, inspected and tested on its own.
   */
  async findOverdue(limit = 100): Promise<SafetySessionRecord[]> {
    return this.sessions.findOverdue(this.clock.now(), limit);
  }

  async markEscalated(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (session === null) return;
    await this.sessions.update({ ...session, status: 'escalated' });
  }
}
