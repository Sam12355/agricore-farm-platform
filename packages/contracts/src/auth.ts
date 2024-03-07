import { z } from 'zod';

import { Limits, emailSchema, isoDateTimeSchema, uuidSchema } from './common';

/**
 * Password rules follow NIST 800-63B rather than the older complexity-class advice:
 * length is what matters, composition rules mostly push people towards Passw0rd!.
 * A breached-password check belongs here too and is listed as future work.
 */
export const passwordSchema = z
  .string()
  .min(Limits.password.min, `Use at least ${Limits.password.min} characters.`)
  .max(Limits.password.max)
  .refine((value) => value.trim().length > 0, 'Password cannot be only whitespace.');

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(Limits.displayName),
  acceptedDemoNotice: z.literal(true, {
    errorMap: () => ({
      message: 'You must acknowledge that GuardianLink is a demonstration, not an emergency service.',
    }),
  }),
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(Limits.password.max),
  deviceName: z.string().trim().min(1).max(80).optional(),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

export const logoutRequestSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

export const userRoleSchema = z.enum(['user', 'operator', 'admin']);

export const authenticatedUserSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  displayName: z.string(),
  role: userRoleSchema,
  createdAt: isoDateTimeSchema,
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. Clients refresh before this elapses. */
  expiresIn: z.number().int().positive(),
  refreshToken: z.string(),
  refreshExpiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
});

export const authResponseSchema = z.object({
  user: authenticatedUserSchema,
  tokens: tokenPairSchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type UserRoleDto = z.infer<typeof userRoleSchema>;

/**
 * Claims carried in the access token. Kept minimal on purpose: an access token ends up
 * in logs, proxies and crash reports more often than anyone plans for, so it holds a
 * subject and a role and nothing that identifies a person.
 */
export const accessTokenClaimsSchema = z.object({
  sub: uuidSchema,
  role: userRoleSchema,
  /** Token family, so a refresh-reuse detection can revoke every sibling at once. */
  fam: uuidSchema,
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string(),
  aud: z.string(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
