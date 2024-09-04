import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';

import {
  API_VERSION,
  verifyPurchaseSchema,
  type VerifyPurchaseRequest,
} from '@agricore/contracts';
import { UserRole, normaliseLimit } from '@agricore/shared-types';

import { SubscriptionService } from '../../../application/services/subscription.service';
import { PORTS } from '../../../application/tokens';
import type { AuditRepository, UserRepository } from '../../../application/ports';
import {
  CorrelationId,
  CurrentUser,
  RateLimit,
  Roles,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

@Controller(`api/${API_VERSION}/subscriptions`)
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('current')
  async current(@CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>) {
    const record = await this.subscriptions.current(user.userId);
    return {
      id: record.id,
      tier: record.tier,
      status: record.status,
      platform: record.platform,
      startedAt: record.startedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      autoRenewing: record.autoRenewing,
      productId: record.productId,
      // originalTransactionId is deliberately not returned. It is a store identifier the
      // client has no use for, and it is the sort of value that ends up in a bug report.
    };
  }

  @Get('entitlement')
  async entitlement(@CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>) {
    return this.subscriptions.entitlement(user.userId);
  }

  @Post('verify')
  @HttpCode(200)
  // Verification calls a store. A tight limit keeps a broken client from turning a retry
  // loop into a rate-limit problem with Apple or Google rather than with us.
  @RateLimit({ limit: 20, windowSeconds: 300, by: 'subject' })
  async verify(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(verifyPurchaseSchema)) body: VerifyPurchaseRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.subscriptions.verifyPurchase(user.userId, body, correlationId);
    if (!result.ok) throwDomain(result.error, correlationId);

    return {
      id: result.value.id,
      tier: result.value.tier,
      status: result.value.status,
      platform: result.value.platform,
      startedAt: result.value.startedAt?.toISOString() ?? null,
      expiresAt: result.value.expiresAt?.toISOString() ?? null,
      autoRenewing: result.value.autoRenewing,
      productId: result.value.productId,
    };
  }
}

/**
 * Administration.
 *
 * Only the audit log and a user listing. Deliberately not alert content: an admin role
 * exists to answer "who did what", not to be a second manager console with fewer
 * restrictions. Roles that quietly accumulate read access to everything are how a
 * privilege boundary stops meaning anything.
 */
@Controller(`api/${API_VERSION}/admin`)
@Roles(UserRole.Admin)
export class AdminController {
  constructor(
    @Inject(PORTS.AuditRepository) private readonly audit: AuditRepository,
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
  ) {}

  @Get('audit-log')
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'subject' })
  async auditLog(
    @Query('actorId') actorId: string | undefined,
    @Query('resourceId') resourceId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    const page = await this.audit.query(
      {
        ...(actorId === undefined ? {} : { actorId }),
        ...(resourceId === undefined ? {} : { resourceId }),
      },
      { limit: normaliseLimit(limit === undefined ? undefined : Number(limit)), cursor },
    );

    return {
      items: page.items.map((record) => ({
        id: record.id,
        actorId: record.actorId,
        actorRole: record.actorRole,
        action: record.action,
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        outcome: record.outcome,
        correlationId: record.correlationId,
        at: record.at.toISOString(),
        // Metadata holds field names and identifiers by construction. It is passed
        // through rather than filtered, because filtering here would hide a bug where
        // something sensitive got in, instead of surfacing it.
        metadata: record.metadata,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Get('users')
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'subject' })
  async listUsers() {
    // No alert data, no workers, no location. Enough to administer an account and
    // nothing more.
    const all = 'all' in this.users ? (this.users as unknown as { all: () => unknown[] }).all() : [];

    return {
      items: (all as Array<{
        id: string;
        email: string;
        displayName: string;
        role: string;
        createdAt: Date;
        deletedAt: Date | null;
        deletionScheduledFor: Date | null;
      }>).map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        deleted: user.deletedAt !== null,
        deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null,
      })),
      nextCursor: null,
      hasMore: false,
    };
  }
}
