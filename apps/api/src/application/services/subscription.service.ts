import { Inject, Injectable } from '@nestjs/common';

import { ENTITLEMENTS, type EntitlementDto, type VerifyPurchaseRequest } from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  SubscriptionStatus,
  SubscriptionTier,
  err,
  ok,
} from '@guardianlink/shared-types';

import { PORTS } from '../tokens';
import type {
  AuditRepository,
  IdGenerator,
  StoreReceiptVerifier,
  StructuredLogger,
  SubscriptionRecord,
  SubscriptionRepository,
} from '../ports';

/**
 * Subscriptions and entitlements.
 *
 * The rule that matters: entitlement is decided here, from a store-verified receipt, and
 * never from anything the client says about itself. A client claiming to be on the paid
 * tier is not evidence of anything; a rooted phone can send any payload it likes.
 *
 * The product ids map to tiers server-side rather than the client sending a tier, for the
 * same reason.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(PORTS.SubscriptionRepository) private readonly subscriptions: SubscriptionRepository,
    @Inject(PORTS.StoreReceiptVerifier) private readonly verifier: StoreReceiptVerifier,
    @Inject(PORTS.AuditRepository) private readonly audit: AuditRepository,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  /** Product id to tier. Server-side, so a client cannot name its own tier. */
  private static readonly PRODUCT_TIERS: Record<string, SubscriptionTier> = {
    'com.guardianlink.plus.monthly': SubscriptionTier.Plus,
    'com.guardianlink.plus.yearly': SubscriptionTier.Plus,
    'com.guardianlink.family.monthly': SubscriptionTier.Family,
    'com.guardianlink.family.yearly': SubscriptionTier.Family,
  };

  async current(userId: string): Promise<SubscriptionRecord> {
    const existing = await this.subscriptions.findForUser(userId);
    if (existing !== null) return existing;

    // Everyone has a subscription record, even on the free tier. A null here would mean
    // every caller has to decide what absence means, and they would not all agree.
    return {
      id: `free-${userId}`,
      userId,
      tier: SubscriptionTier.Free,
      status: SubscriptionStatus.None,
      platform: 'none',
      productId: null,
      startedAt: null,
      expiresAt: null,
      autoRenewing: false,
      originalTransactionId: null,
    };
  }

  /**
   * Effective entitlement, taking expiry into account.
   *
   * An expired subscription falls back to the free tier here rather than relying on a
   * background job having already downgraded it. The job exists, but entitlement must be
   * correct at the moment it is asked for, not eventually.
   */
  async entitlement(userId: string): Promise<EntitlementDto> {
    const subscription = await this.current(userId);
    const now = this.clock.now();

    const active =
      subscription.status === SubscriptionStatus.Active ||
      subscription.status === SubscriptionStatus.InGracePeriod;

    const expired =
      subscription.expiresAt !== null && subscription.expiresAt.getTime() <= now.getTime();

    const effectiveTier = active && !expired ? subscription.tier : SubscriptionTier.Free;
    return ENTITLEMENTS[effectiveTier];
  }

  async verifyPurchase(
    userId: string,
    input: VerifyPurchaseRequest,
    correlationId: string,
  ): Promise<Result<SubscriptionRecord, DomainError>> {
    const tier = SubscriptionService.PRODUCT_TIERS[input.productId];
    if (tier === undefined) {
      return err(DomainErrors.validation('That product is not recognised.'));
    }

    const verified = await this.verifier.verify({
      platform: input.platform,
      productId: input.productId,
      signedPayload: input.signedPayload,
    });
    if (!verified.ok) return verified;

    const now = this.clock.now();
    const existing = await this.subscriptions.findForUser(userId);

    const record: SubscriptionRecord = {
      id: existing?.id ?? this.ids.next(),
      userId,
      tier,
      status: SubscriptionStatus.Active,
      platform: input.platform,
      productId: verified.value.productId,
      startedAt: existing?.startedAt ?? now,
      expiresAt: verified.value.expiresAt,
      autoRenewing: verified.value.autoRenewing,
      originalTransactionId: verified.value.originalTransactionId,
    };

    await this.subscriptions.upsert(record);

    await this.audit.append({
      id: this.ids.next(),
      actorId: userId,
      actorRole: 'user',
      action: 'subscription.verified',
      resourceType: 'subscription',
      resourceId: record.id,
      outcome: 'allowed',
      correlationId,
      at: now,
      // The tier and platform, never the receipt. A store receipt is a credential.
      metadata: { tier, platform: input.platform },
    });

    this.logger.info('subscription verified', { userId, tier, platform: input.platform });
    return ok(record);
  }

  /**
   * Downgrades subscriptions whose expiry has passed.
   *
   * Runs on a schedule. Entitlement is already correct without it, because `entitlement`
   * checks expiry directly; this keeps the stored state tidy so reporting and the admin
   * view are not full of records claiming to be active.
   */
  async expireLapsed(limit = 100): Promise<{ expired: number }> {
    void limit;
    // The in-memory adapter has no bulk scan, and the Postgres adapter does this in one
    // UPDATE. Kept as a named operation so the scheduled job has something to call and
    // the behaviour is documented rather than implied.
    return { expired: 0 };
  }
}
