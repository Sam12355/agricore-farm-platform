import { randomUUID } from 'node:crypto';

import {
  type ArgumentsHost,
  type CallHandler,
  type CanActivate,
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  type NestMiddleware,
  type PipeTransform,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';
import type { ZodSchema } from 'zod';

import { DomainErrors, type UserRole } from '@guardianlink/shared-types';

import type { RateLimiter, StructuredLogger, TokenService } from '../../application/ports';
import { PORTS } from '../../application/tokens';
import { statusForDomainError, toErrorBody } from './error-mapper';

export const CORRELATION_HEADER = 'x-correlation-id';

export interface AuthenticatedRequest extends Request {
  correlationId: string;
  auth?: { userId: string; role: UserRole; familyId: string };
}

/**
 * Correlation ids.
 *
 * Accepted from the caller when it looks like one of ours, generated otherwise. It goes
 * on the request, into every log line for that request, into outbox messages, and back
 * out on the response header, so a user can quote the id from an error screen and it can
 * be found in the logs.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_HEADER);
    // A caller-supplied value is only trusted if it is short and url-safe. Otherwise it
    // is a log-injection vector: a newline in here splits one log line into two.
    const usable =
      typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : null;

    req.correlationId = usable ?? randomUUID();
    res.setHeader(CORRELATION_HEADER, req.correlationId);
    next();
  }
}

/** Validates a request body or query against a Zod schema from the contracts package. */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const parsed = this.schema.safeParse(value ?? {});
    if (parsed.success) return parsed.data;

    const details: Record<string, unknown> = {};
    for (const issue of parsed.error.issues) {
      details[issue.path.join('.') || '(root)'] = issue.message;
    }

    throw new HttpException(
      toErrorBody(DomainErrors.validation('The request body is not valid.', details), 'pending'),
      HttpStatus.BAD_REQUEST,
    );
  }
}

export const ROLES_KEY = 'guardianlink:roles';
export const PUBLIC_KEY = 'guardianlink:public';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.auth === undefined) throw new UnauthorizedException();
  return request.auth;
});

export const CorrelationId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().correlationId;
});

/**
 * The Idempotency-Key header, already validated by IdempotencyInterceptor on any route
 * that declares @Idempotent. Falls back to the correlation id so a route that forgot the
 * decorator still deduplicates per request rather than not at all.
 */
export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.header('idempotency-key') ?? request.correlationId;
});

/**
 * Authentication and coarse role checks.
 *
 * This guard answers "are you logged in, and do you hold a role that could possibly do
 * this". It deliberately does not answer "is this particular record yours" - that lives
 * in the services, because only they can load the record. Keeping the two apart is what
 * stops the ownership check from being forgotten on a new route: the guard will not
 * silently make a route look protected when it is not.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');

    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new HttpException(
        toErrorBody(DomainErrors.unauthenticated(), request.correlationId),
        HttpStatus.UNAUTHORIZED,
      );
    }

    const verified = this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    if (!verified.ok) {
      throw new HttpException(
        toErrorBody(verified.error, request.correlationId),
        HttpStatus.UNAUTHORIZED,
      );
    }

    request.auth = {
      userId: verified.value.userId,
      role: verified.value.role,
      familyId: verified.value.familyId,
    };

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== undefined && required.length > 0 && !required.includes(verified.value.role)) {
      throw new HttpException(
        toErrorBody(DomainErrors.forbidden(), request.correlationId),
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}

export const RATE_LIMIT_KEY = 'guardianlink:rate-limit';

export interface RateLimitSpec {
  readonly limit: number;
  readonly windowSeconds: number;
  /** Auth routes key on the client address; everything else keys on the subject. */
  readonly by: 'ip' | 'subject';
}

export const RateLimit = (spec: RateLimitSpec) => SetMetadata(RATE_LIMIT_KEY, spec);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PORTS.RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RateLimitSpec>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (spec === undefined) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();

    const subject =
      spec.by === 'subject' && request.auth !== undefined
        ? `user:${request.auth.userId}`
        : `ip:${request.ip ?? 'unknown'}`;

    const bucketKey = `${request.method}:${request.route?.path ?? request.path}:${subject}`;
    const outcome = await this.limiter.consume(bucketKey, spec.limit, spec.windowSeconds);

    if (!outcome.allowed) {
      // Retry-After is not optional here. Without it a mobile client has no idea how
      // long to wait and will hammer the endpoint until it gives up.
      response.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      throw new HttpException(
        toErrorBody(DomainErrors.rateLimited(outcome.retryAfterSeconds), request.correlationId),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    response.setHeader('X-RateLimit-Remaining', String(outcome.remaining));
    return true;
  }
}

/** Puts the correlation id into every log line produced while handling the request. */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(@Inject(PORTS.Logger) private readonly logger: StructuredLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, started, context.switchToHttp().getResponse<Response>().statusCode),
        error: (error: unknown) =>
          this.log(
            request,
            started,
            error instanceof HttpException ? error.getStatus() : 500,
          ),
      }),
    );
  }

  private log(request: AuthenticatedRequest, started: number, status: number): void {
    this.logger.info('http request', {
      correlationId: request.correlationId,
      method: request.method,
      // The route pattern, not the concrete path. A path contains identifiers; the
      // pattern is what you want to group by anyway.
      route: request.route?.path ?? request.path,
      status,
      durationMs: Date.now() - started,
      userId: request.auth?.userId,
    });
  }
}

/**
 * Turns anything thrown into the single error envelope.
 *
 * A response that is not this shape is a bug, because both mobile clients have exactly
 * one error decoder. Unexpected exceptions are logged with their detail and answered
 * with a generic message: the caller gets a correlation id to quote, and nothing about
 * the internals of the process.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(@Inject(PORTS.Logger) private readonly logger: StructuredLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AuthenticatedRequest>();
    const response = ctx.getResponse<Response>();
    const correlationId = request.correlationId ?? 'unknown';

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();

      if (typeof body === 'object' && body !== null && 'error' in body) {
        const envelope = body as { error: { correlationId: string } };
        envelope.error.correlationId = correlationId;
        response.status(status).json(envelope);
        return;
      }

      response.status(status).json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED',
          message: exception.message,
          correlationId,
        },
      });
      return;
    }

    this.logger.error('unhandled exception', {
      correlationId,
      route: request.route?.path ?? request.path,
      cause: exception instanceof Error ? exception : String(exception),
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Quote the correlation id if you contact support.',
        correlationId,
      },
    });
  }
}

/** Converts a failed Result into the HttpException the filter knows how to render. */
export function throwDomain(error: import('@guardianlink/shared-types').DomainError, correlationId: string): never {
  throw new HttpException(toErrorBody(error, correlationId), statusForDomainError(error));
}
