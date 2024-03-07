import { z } from 'zod';

import { Limits, emailSchema, isoDateTimeSchema, phoneSchema, uuidSchema } from './common';

export const contactChannelPreferenceSchema = z.enum(['email', 'sms', 'push', 'any']);

/**
 * A contact needs at least one way to be reached. Enforcing that here rather than in the
 * use case means the web form, the mobile clients and the API all reject the same thing
 * with the same message.
 */
const atLeastOneChannel = <T extends { email?: string | undefined; phone?: string | undefined }>(
  value: T,
): boolean => Boolean(value.email ?? value.phone);

export const createTrustedContactSchema = z
  .object({
    name: z.string().trim().min(1).max(Limits.contactName),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    relationship: z.string().trim().max(Limits.relationship).optional(),
    /** 1 is contacted first. Ties are broken by creation order. */
    priority: z.number().int().min(1).max(10).default(1),
    preferredChannel: contactChannelPreferenceSchema.default('any'),
    canViewLiveLocation: z.boolean().default(true),
  })
  .refine(atLeastOneChannel, {
    message: 'Give the contact an email address or a phone number.',
    path: ['email'],
  });

export const updateTrustedContactSchema = z
  .object({
    name: z.string().trim().min(1).max(Limits.contactName).optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    relationship: z.string().trim().max(Limits.relationship).nullable().optional(),
    priority: z.number().int().min(1).max(10).optional(),
    preferredChannel: contactChannelPreferenceSchema.optional(),
    canViewLiveLocation: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const trustedContactSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  relationship: z.string().nullable(),
  priority: z.number().int(),
  preferredChannel: contactChannelPreferenceSchema,
  canViewLiveLocation: z.boolean(),
  verifiedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type CreateTrustedContactRequest = z.infer<typeof createTrustedContactSchema>;
export type UpdateTrustedContactRequest = z.infer<typeof updateTrustedContactSchema>;
export type TrustedContactDto = z.infer<typeof trustedContactSchema>;
export type ContactChannelPreference = z.infer<typeof contactChannelPreferenceSchema>;

/**
 * What a trusted contact sees when they open the link they were sent. No account, no
 * password. The token in the URL is single-incident, single-contact and time-boxed, and
 * the payload is trimmed to what someone needs in order to help.
 */
export const contactIncidentViewSchema = z.object({
  incidentId: uuidSchema,
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

export const acknowledgeIncidentSchema = z.object({
  note: z.string().trim().max(Limits.reason).optional(),
});

export type ContactIncidentView = z.infer<typeof contactIncidentViewSchema>;
export type AcknowledgeIncidentRequest = z.infer<typeof acknowledgeIncidentSchema>;
