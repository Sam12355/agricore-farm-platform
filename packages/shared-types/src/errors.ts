/**
 * The complete set of failures a use case is allowed to return.
 *
 * Keeping this closed matters: the HTTP layer maps every code to a status in one place
 * (see apps/api/src/infrastructure/http/error-mapper.ts) and the mapping is exhaustive,
 * so adding a code without deciding its status is a compile error rather than an
 * accidental 500 in production.
 */
export const DomainErrorCode = {
  ValidationFailed: 'VALIDATION_FAILED',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  PreconditionFailed: 'PRECONDITION_FAILED',
  RateLimited: 'RATE_LIMITED',
  IdempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  StaleVersion: 'STALE_VERSION',
  InvalidState: 'INVALID_STATE',
  DependencyUnavailable: 'DEPENDENCY_UNAVAILABLE',
} as const;

export type DomainErrorCode = (typeof DomainErrorCode)[keyof typeof DomainErrorCode];

export interface DomainError {
  readonly code: DomainErrorCode;
  /** Safe to show a user. Must never contain personal data or internal identifiers. */
  readonly message: string;
  /** Structured detail for clients. Also must not contain personal data. */
  readonly details?: Readonly<Record<string, unknown>>;
}

function makeError(
  code: DomainErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError {
  return details === undefined ? { code, message } : { code, message, details };
}

export const DomainErrors = {
  validation: (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
    makeError(DomainErrorCode.ValidationFailed, message, details),

  unauthenticated: (message = 'Authentication is required.'): DomainError =>
    makeError(DomainErrorCode.Unauthenticated, message),

  forbidden: (message = 'You do not have access to this resource.'): DomainError =>
    makeError(DomainErrorCode.Forbidden, message),

  notFound: (resource: string): DomainError =>
    makeError(DomainErrorCode.NotFound, `${resource} was not found.`),

  conflict: (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
    makeError(DomainErrorCode.Conflict, message, details),

  preconditionFailed: (message: string): DomainError =>
    makeError(DomainErrorCode.PreconditionFailed, message),

  rateLimited: (retryAfterSeconds: number): DomainError =>
    makeError(DomainErrorCode.RateLimited, 'Too many requests. Try again shortly.', {
      retryAfterSeconds,
    }),

  idempotencyKeyReused: (): DomainError =>
    makeError(
      DomainErrorCode.IdempotencyKeyReused,
      'This idempotency key was already used with a different request body.',
    ),

  staleVersion: (expected: number, actual: number): DomainError =>
    makeError(DomainErrorCode.StaleVersion, 'This record changed since you loaded it.', {
      expectedVersion: expected,
      currentVersion: actual,
    }),

  invalidState: (message: string, details?: Readonly<Record<string, unknown>>): DomainError =>
    makeError(DomainErrorCode.InvalidState, message, details),

  dependencyUnavailable: (dependency: string): DomainError =>
    makeError(DomainErrorCode.DependencyUnavailable, `${dependency} is temporarily unavailable.`),
} as const;
