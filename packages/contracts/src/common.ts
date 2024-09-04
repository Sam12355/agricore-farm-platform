import { z } from 'zod';

/**
 * Every schema here is used three ways: as the runtime validator in the API, as the
 * TypeScript type on both sides of the wire, and as the source of the OpenAPI document.
 *
 * The point is that a field cannot be renamed on the server without breaking the web
 * client's compile, and cannot drift from the published docs, because there is only one
 * place it is written down.
 */

export const API_VERSION = 'v1' as const;

/** Length caps exist so a client cannot post a megabyte into a text column. */
export const Limits = {
  displayName: 80,
  email: 254,
  password: { min: 12, max: 128 },
  workerName: 80,
  phone: 24,
  jobRole: 40,
  note: 2000,
  sessionNote: 500,
  reason: 280,
  idempotencyKey: { min: 8, max: 128 },
} as const;

export const uuidSchema = z.string().uuid();

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 timestamp with offset, always UTC on the wire');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(Limits.email)
  .email('A valid email address is required.');

/**
 * Deliberately permissive on format, strict on length and character set. Phone number
 * formats vary enough internationally that a tight regex creates more false rejections
 * than it prevents bad data. Normalisation to E.164 happens in the notification adapter.
 */
export const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(Limits.phone)
  .regex(/^[+()\d\s-]+$/, 'Phone number contains unsupported characters.');

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(Limits.idempotencyKey.min)
  .max(Limits.idempotencyKey.max)
  .regex(/^[A-Za-z0-9_:.-]+$/, 'Idempotency key must be url-safe.');

export const correlationIdSchema = z.string().trim().min(8).max(64);

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const geoPointSchema = coordinatesSchema.extend({
  accuracyMetres: z.number().min(0).max(100_000),
  capturedAt: isoDateTimeSchema,
});

export type Coordinates = z.infer<typeof coordinatesSchema>;
export type GeoPointDto = z.infer<typeof geoPointSchema>;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}

/**
 * The single error envelope. Every non-2xx response in the API has this shape, which is
 * why the mobile clients need one error decoder instead of one per endpoint.
 */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    correlationId: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  uptimeSeconds: z.number(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['up', 'down']),
      detail: z.string().optional(),
      latencyMs: z.number().optional(),
    }),
  ),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
