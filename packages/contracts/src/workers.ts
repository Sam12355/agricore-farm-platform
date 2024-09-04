import { z } from 'zod';

import { Limits, emailSchema, isoDateTimeSchema, phoneSchema, uuidSchema } from './common';

export const workerChannelPreferenceSchema = z.enum(['email', 'sms', 'push', 'any']);

/**
 * A worker needs at least one way to be reached. Enforcing that here rather than in the
 * use case means the web form, the mobile clients and the API all reject the same thing
 * with the same message.
 */
const atLeastOneChannel = <T extends { email?: string | undefined; phone?: string | undefined }>(
  value: T,
): boolean => Boolean(value.email ?? value.phone);

export const createWorkerSchema = z
  .object({
    name: z.string().trim().min(1).max(Limits.workerName),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    jobRole: z.string().trim().max(Limits.jobRole).optional(),
    /** 1 is notified first. Ties are broken by creation order. */
    priority: z.number().int().min(1).max(10).default(1),
    preferredChannel: workerChannelPreferenceSchema.default('any'),
    canViewLiveLocation: z.boolean().default(true),
  })
  .refine(atLeastOneChannel, {
    message: 'Give the worker an email address or a phone number.',
    path: ['email'],
  });

export const updateWorkerSchema = z
  .object({
    name: z.string().trim().min(1).max(Limits.workerName).optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    jobRole: z.string().trim().max(Limits.jobRole).nullable().optional(),
    priority: z.number().int().min(1).max(10).optional(),
    preferredChannel: workerChannelPreferenceSchema.optional(),
    canViewLiveLocation: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const workerSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobRole: z.string().nullable(),
  priority: z.number().int(),
  preferredChannel: workerChannelPreferenceSchema,
  canViewLiveLocation: z.boolean(),
  verifiedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type CreateWorkerRequest = z.infer<typeof createWorkerSchema>;
export type UpdateWorkerRequest = z.infer<typeof updateWorkerSchema>;
export type WorkerDto = z.infer<typeof workerSchema>;
export type WorkerChannelPreference = z.infer<typeof workerChannelPreferenceSchema>;

/**
 * What an assigned worker sees when they open the link they were sent. No account, no
 * password. The token in the URL is single-alert, single-worker and time-boxed, and
 * the payload is trimmed to what someone needs in order to help.
 */
export const workerAlertViewSchema = z.object({
  alertId: uuidSchema,
  status: z.enum(['active', 'acknowledged', 'resolved', 'cancelled']),
  subjectDisplayName: z.string(),
  activatedAt: isoDateTimeSchema,
  lastKnownLocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      accuracyMetres: z.number(),
      capturedAt: isoDateTimeSchema,
    })
    .nullable(),
  acknowledgedAt: isoDateTimeSchema.nullable(),
  demoNotice: z.string(),
});

export const acknowledgeAlertSchema = z.object({
  note: z.string().trim().max(Limits.reason).optional(),
});

export type WorkerAlertView = z.infer<typeof workerAlertViewSchema>;
export type AcknowledgeAlertRequest = z.infer<typeof acknowledgeAlertSchema>;
