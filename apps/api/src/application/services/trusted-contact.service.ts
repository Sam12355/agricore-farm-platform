import { Inject, Injectable } from '@nestjs/common';

import {
  ENTITLEMENTS,
  type CreateTrustedContactRequest,
  type UpdateTrustedContactRequest,
} from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  err,
  ok,
} from '@guardianlink/shared-types';

import { PORTS } from '../tokens';
import type {
  IdGenerator,
  StructuredLogger,
  SubscriptionRepository,
  TrustedContactRecord,
  TrustedContactRepository,
} from '../ports';

@Injectable()
export class TrustedContactService {
  constructor(
    @Inject(PORTS.TrustedContactRepository) private readonly contacts: TrustedContactRepository,
    @Inject(PORTS.SubscriptionRepository) private readonly subscriptions: SubscriptionRepository,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async list(userId: string): Promise<TrustedContactRecord[]> {
    const all = await this.contacts.listForUser(userId);
    return all
      .slice()
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async create(
    userId: string,
    input: CreateTrustedContactRequest,
  ): Promise<Result<TrustedContactRecord, DomainError>> {
    // The contact cap is an entitlement, and entitlements are enforced server-side. A
    // client that has been told it is on the paid tier is not evidence of anything.
    const subscription = await this.subscriptions.findForUser(userId);
    const tier = subscription?.status === 'active' ? subscription.tier : 'free';
    const limit = ENTITLEMENTS[tier].features.maxTrustedContacts;

    const existing = await this.contacts.countForUser(userId);
    if (existing >= limit) {
      return err(
        DomainErrors.preconditionFailed(
          `Your plan allows up to ${limit} trusted contacts. Remove one or upgrade to add more.`,
        ),
      );
    }

    const now = this.clock.now();
    const record: TrustedContactRecord = {
      id: this.ids.next(),
      userId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      relationship: input.relationship ?? null,
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

    await this.contacts.insert(record);
    this.logger.info('trusted contact added', { userId, contactId: record.id });
    return ok(record);
  }

  async update(
    userId: string,
    contactId: string,
    input: UpdateTrustedContactRequest,
  ): Promise<Result<TrustedContactRecord, DomainError>> {
    const existing = await this.contacts.findById(contactId);
    if (existing === null || existing.deletedAt !== null) {
      return err(DomainErrors.notFound('Trusted contact'));
    }
    // Not-found rather than forbidden, so the response cannot confirm that an id exists
    // under someone else's account.
    if (existing.userId !== userId) return err(DomainErrors.notFound('Trusted contact'));

    const merged: TrustedContactRecord = {
      ...existing,
      name: input.name ?? existing.name,
      email: input.email === undefined ? existing.email : input.email,
      phone: input.phone === undefined ? existing.phone : input.phone,
      relationship: input.relationship === undefined ? existing.relationship : input.relationship,
      priority: input.priority ?? existing.priority,
      preferredChannel: input.preferredChannel ?? existing.preferredChannel,
      canViewLiveLocation: input.canViewLiveLocation ?? existing.canViewLiveLocation,
      updatedAt: this.clock.now(),
    };

    if (merged.email === null && merged.phone === null) {
      return err(
        DomainErrors.validation('A trusted contact needs an email address or a phone number.'),
      );
    }

    await this.contacts.update(merged);
    return ok(merged);
  }

  async remove(userId: string, contactId: string): Promise<Result<void, DomainError>> {
    const existing = await this.contacts.findById(contactId);
    if (existing === null || existing.deletedAt !== null) {
      return err(DomainErrors.notFound('Trusted contact'));
    }
    if (existing.userId !== userId) return err(DomainErrors.notFound('Trusted contact'));

    // Soft delete. A contact who was notified during a past incident has to stay
    // resolvable, or that incident's timeline turns into a list of orphan identifiers.
    await this.contacts.softDelete(contactId, this.clock.now());
    this.logger.info('trusted contact removed', { userId, contactId });
    return ok();
  }
}
