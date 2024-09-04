import { Inject, Injectable } from '@nestjs/common';

import {
  ENTITLEMENTS,
  type CreateWorkerRequest,
  type UpdateWorkerRequest,
} from '@agricore/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  err,
  ok,
} from '@agricore/shared-types';

import { PORTS } from '../tokens';
import type {
  IdGenerator,
  StructuredLogger,
  SubscriptionRepository,
  WorkerRecord,
  WorkerRepository,
} from '../ports';

@Injectable()
export class WorkerService {
  constructor(
    @Inject(PORTS.WorkerRepository) private readonly workers: WorkerRepository,
    @Inject(PORTS.SubscriptionRepository) private readonly subscriptions: SubscriptionRepository,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async list(userId: string): Promise<WorkerRecord[]> {
    const all = await this.workers.listForUser(userId);
    return all
      .slice()
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async create(
    userId: string,
    input: CreateWorkerRequest,
  ): Promise<Result<WorkerRecord, DomainError>> {
    // The worker cap is an entitlement, and entitlements are enforced server-side. A
    // client that has been told it is on the paid tier is not evidence of anything.
    const subscription = await this.subscriptions.findForUser(userId);
    const tier = subscription?.status === 'active' ? subscription.tier : 'free';
    const limit = ENTITLEMENTS[tier].features.maxWorkers;

    const existing = await this.workers.countForUser(userId);
    if (existing >= limit) {
      return err(
        DomainErrors.preconditionFailed(
          `Your plan allows up to ${limit} assigned workers. Remove one or upgrade to add more.`,
        ),
      );
    }

    const now = this.clock.now();
    const record: WorkerRecord = {
      id: this.ids.next(),
      userId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      jobRole: input.jobRole ?? null,
      priority: input.priority,
      preferredChannel: input.preferredChannel,
      canViewLiveLocation: input.canViewLiveLocation,
      // Verification is a separate flow that is not implemented; the field exists so the
      // notification path can already prefer verified addresses. See known limitations.
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await this.workers.insert(record);
    this.logger.info('assigned worker added', { userId, workerId: record.id });
    return ok(record);
  }

  async update(
    userId: string,
    workerId: string,
    input: UpdateWorkerRequest,
  ): Promise<Result<WorkerRecord, DomainError>> {
    const existing = await this.workers.findById(workerId);
    if (existing === null || existing.deletedAt !== null) {
      return err(DomainErrors.notFound('Assigned worker'));
    }
    // Not-found rather than forbidden, so the response cannot confirm that an id exists
    // under someone else's account.
    if (existing.userId !== userId) return err(DomainErrors.notFound('Assigned worker'));

    const merged: WorkerRecord = {
      ...existing,
      name: input.name ?? existing.name,
      email: input.email === undefined ? existing.email : input.email,
      phone: input.phone === undefined ? existing.phone : input.phone,
      jobRole: input.jobRole === undefined ? existing.jobRole : input.jobRole,
      priority: input.priority ?? existing.priority,
      preferredChannel: input.preferredChannel ?? existing.preferredChannel,
      canViewLiveLocation: input.canViewLiveLocation ?? existing.canViewLiveLocation,
      updatedAt: this.clock.now(),
    };

    if (merged.email === null && merged.phone === null) {
      return err(
        DomainErrors.validation('An assigned worker needs an email address or a phone number.'),
      );
    }

    await this.workers.update(merged);
    return ok(merged);
  }

  async remove(userId: string, workerId: string): Promise<Result<void, DomainError>> {
    const existing = await this.workers.findById(workerId);
    if (existing === null || existing.deletedAt !== null) {
      return err(DomainErrors.notFound('Assigned worker'));
    }
    if (existing.userId !== userId) return err(DomainErrors.notFound('Assigned worker'));

    // Soft delete. A worker who was notified during a past alert has to stay
    // resolvable, or that alert's timeline turns into a list of orphan identifiers.
    await this.workers.softDelete(workerId, this.clock.now());
    this.logger.info('assigned worker removed', { userId, workerId });
    return ok();
  }
}
