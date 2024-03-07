import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './common';

export const subscriptionTierSchema = z.enum(['free', 'plus', 'family']);
export const subscriptionStatusSchema = z.enum([
  'none',
  'active',
  'in_grace_period',
  'expired',
  'cancelled',
]);
export const storePlatformSchema = z.enum(['apple', 'google', 'none']);

export const subscriptionSchema = z.object({
  id: uuidSchema,
  tier: subscriptionTierSchema,
  status: subscriptionStatusSchema,
  platform: storePlatformSchema,
  startedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  autoRenewing: z.boolean(),
  /** Never the raw store receipt. That stays server-side and is not exposed. */
  productId: z.string().nullable(),
});

/**
 * The client sends a signed payload from StoreKit or Play Billing. The server verifies
 * it with the store and never trusts the client's own view of entitlement. This shape
 * is the same for both platforms so the entitlement use case has one code path.
 */
export const verifyPurchaseSchema = z.object({
  platform: z.enum(['apple', 'google']),
  productId: z.string().min(1).max(120),
  /** Opaque to us: a StoreKit 2 JWS or a Play purchase token. */
  signedPayload: z.string().min(1).max(8192),
});

export const entitlementSchema = z.object({
  tier: subscriptionTierSchema,
  features: z.object({
    maxTrustedContacts: z.number().int().positive(),
    liveLocationSharing: z.boolean(),
    extendedIncidentHistoryDays: z.number().int().positive(),
    priorityOperatorQueue: z.boolean(),
  }),
});

export type SubscriptionDto = z.infer<typeof subscriptionSchema>;
export type VerifyPurchaseRequest = z.infer<typeof verifyPurchaseSchema>;
export type EntitlementDto = z.infer<typeof entitlementSchema>;
export type SubscriptionTierDto = z.infer<typeof subscriptionTierSchema>;

/**
 * Entitlements are defined here rather than in the API so the mobile clients can show
 * the right thing while offline without inventing their own copy of the rules.
 */
export const ENTITLEMENTS: Record<SubscriptionTierDto, EntitlementDto> = {
  free: {
    tier: 'free',
    features: {
      maxTrustedContacts: 3,
      liveLocationSharing: true,
      extendedIncidentHistoryDays: 30,
      priorityOperatorQueue: false,
    },
  },
  plus: {
    tier: 'plus',
    features: {
      maxTrustedContacts: 10,
      liveLocationSharing: true,
      extendedIncidentHistoryDays: 365,
      priorityOperatorQueue: true,
    },
  },
  family: {
    tier: 'family',
    features: {
      maxTrustedContacts: 25,
      liveLocationSharing: true,
      extendedIncidentHistoryDays: 730,
      priorityOperatorQueue: true,
    },
  },
};
