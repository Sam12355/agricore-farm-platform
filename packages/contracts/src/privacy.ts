import { z } from 'zod';

import { Limits, isoDateTimeSchema, uuidSchema } from './common';

/**
 * Retention is user-controllable within bounds the manager of the service can defend.
 * The floors stop someone setting retention to zero and then asking why their alert
 * history is empty; the ceilings stop the service hoarding location data indefinitely.
 */
export const RetentionBounds = {
  alertDays: { min: 30, max: 1095, default: 365 },
  locationDays: { min: 1, max: 90, default: 30 },
  notificationLogDays: { min: 7, max: 365, default: 90 },
} as const;

export const privacySettingsSchema = z.object({
  shareLocationWithWorkers: z.boolean(),
  shareLocationWithManagers: z.boolean(),
  /** When false, only the district-level coarsened position is stored for analytics. */
  storePreciseLocationHistory: z.boolean(),
  alertRetentionDays: z
    .number()
    .int()
    .min(RetentionBounds.alertDays.min)
    .max(RetentionBounds.alertDays.max),
  locationRetentionDays: z
    .number()
    .int()
    .min(RetentionBounds.locationDays.min)
    .max(RetentionBounds.locationDays.max),
  notificationLogRetentionDays: z
    .number()
    .int()
    .min(RetentionBounds.notificationLogDays.min)
    .max(RetentionBounds.notificationLogDays.max),
  allowAnonymisedProductAnalytics: z.boolean(),
  updatedAt: isoDateTimeSchema,
});

export const updatePrivacySettingsSchema = privacySettingsSchema
  .omit({ updatedAt: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one setting to update.',
  });

export const dataExportRequestSchema = z.object({
  format: z.enum(['json']).default('json'),
  includeLocationHistory: z.boolean().default(true),
});

export const dataExportStatusSchema = z.object({
  id: uuidSchema,
  status: z.enum(['pending', 'ready', 'failed', 'expired']),
  requestedAt: isoDateTimeSchema,
  readyAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  downloadUrl: z.string().url().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
});

/**
 * Deletion is a two-step confirmation with a grace period, not a single button.
 * Accidentally deleting the account that holds your alert history is not something
 * a person should be able to do by mistyping.
 */
export const requestAccountDeletionSchema = z.object({
  password: z.string().min(1).max(Limits.password.max),
  reason: z.string().trim().max(Limits.reason).optional(),
  confirmation: z.literal('DELETE MY ACCOUNT'),
});

export const accountDeletionStatusSchema = z.object({
  status: z.enum(['none', 'scheduled', 'completed']),
  requestedAt: isoDateTimeSchema.nullable(),
  scheduledFor: isoDateTimeSchema.nullable(),
  cancellableUntil: isoDateTimeSchema.nullable(),
});

export const ACCOUNT_DELETION_GRACE_DAYS = 14;

export type PrivacySettingsDto = z.infer<typeof privacySettingsSchema>;
export type UpdatePrivacySettingsRequest = z.infer<typeof updatePrivacySettingsSchema>;
export type DataExportRequest = z.infer<typeof dataExportRequestSchema>;
export type DataExportStatusDto = z.infer<typeof dataExportStatusSchema>;
export type RequestAccountDeletion = z.infer<typeof requestAccountDeletionSchema>;
export type AccountDeletionStatusDto = z.infer<typeof accountDeletionStatusSchema>;

export function defaultPrivacySettings(updatedAt: string): PrivacySettingsDto {
  return {
    shareLocationWithWorkers: true,
    shareLocationWithManagers: true,
    storePreciseLocationHistory: false,
    alertRetentionDays: RetentionBounds.alertDays.default,
    locationRetentionDays: RetentionBounds.locationDays.default,
    notificationLogRetentionDays: RetentionBounds.notificationLogDays.default,
    allowAnonymisedProductAnalytics: false,
    updatedAt,
  };
}
