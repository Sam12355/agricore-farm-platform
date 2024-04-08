import { HttpStatus } from '@nestjs/common';

import { DomainErrorCode, type DomainError } from '@guardianlink/shared-types';

/**
 * One place where a domain error becomes a status code.
 *
 * The mapping is exhaustive over DomainErrorCode, and the `never` assignment at the end
 * is what enforces that. Adding a new error code without deciding its status is a
 * compile error, which is the only reliable way I have found to stop new failure modes
 * quietly turning into 500s.
 */
export function statusForDomainError(error: DomainError): number {
  switch (error.code) {
    case DomainErrorCode.ValidationFailed:
      return HttpStatus.BAD_REQUEST;
    case DomainErrorCode.Unauthenticated:
      return HttpStatus.UNAUTHORIZED;
    case DomainErrorCode.Forbidden:
      return HttpStatus.FORBIDDEN;
    case DomainErrorCode.NotFound:
      return HttpStatus.NOT_FOUND;
    case DomainErrorCode.Conflict:
      return HttpStatus.CONFLICT;
    case DomainErrorCode.IdempotencyKeyReused:
      return HttpStatus.CONFLICT;
    case DomainErrorCode.StaleVersion:
      // 409 rather than 412. The client did not send a precondition header; it sent a
      // version in the body and lost a race. Conflict describes that better, and the
      // response carries the current version so the UI can show what changed.
      return HttpStatus.CONFLICT;
    case DomainErrorCode.PreconditionFailed:
      return HttpStatus.PRECONDITION_FAILED;
    case DomainErrorCode.RateLimited:
      return HttpStatus.TOO_MANY_REQUESTS;
    case DomainErrorCode.InvalidState:
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case DomainErrorCode.DependencyUnavailable:
      return HttpStatus.SERVICE_UNAVAILABLE;
    default: {
      const exhaustive: never = error.code;
      void exhaustive;
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId: string;
  };
}

export function toErrorBody(error: DomainError, correlationId: string): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: { ...error.details } } : {}),
      correlationId,
    },
  };
}
