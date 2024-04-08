import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { type Observable, of, tap } from 'rxjs';

import { idempotencyKeySchema } from '@guardianlink/contracts';
import { type Clock, DomainErrors, seconds } from '@guardianlink/shared-types';

import type { IdempotencyStore, StructuredLogger } from '../../application/ports';
import { PORTS } from '../../application/tokens';
import { toErrorBody } from './error-mapper';
import type { AuthenticatedRequest } from './http-plumbing';

export const IDEMPOTENT_KEY = 'guardianlink:idempotent';
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotentSpec {
  /** When true the route refuses to run without a key, rather than silently allowing duplicates. */
  readonly required: boolean;
  readonly ttlSeconds: number;
}

export const Idempotent = (spec: IdempotentSpec = { required: true, ttlSeconds: 86_400 }) =>
  SetMetadata(IDEMPOTENT_KEY, spec);

/**
 * HTTP-level idempotency.
 *
 * A phone on a bad connection retries. Sometimes it retries a request that actually
 * succeeded and whose response was lost on the way back. Without this, that turns into
 * two incidents, two sets of notifications, and two very confused trusted contacts.
 *
 * The stored key is the client key plus the authenticated subject plus the route.
 * Scoping by subject stops one user replaying another user's key; scoping by route stops
 * a key reused across endpoints from returning the wrong body.
 *
 * A replay with the same key and a different body is a 409 rather than a silent success.
 * That combination always means a client bug, and hiding it makes the bug harder to find
 * rather than making anything safer.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PORTS.IdempotencyStore) private readonly store: IdempotencyStore,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const spec = this.reflector.getAllAndOverride<IdempotentSpec>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (spec === undefined) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const rawKey = request.header(IDEMPOTENCY_HEADER);

    if (rawKey === undefined) {
      if (!spec.required) return next.handle();
      throw new HttpException(
        toErrorBody(
          DomainErrors.validation('This endpoint requires an Idempotency-Key header.'),
          request.correlationId,
        ),
        HttpStatus.BAD_REQUEST,
      );
    }

    const parsedKey = idempotencyKeySchema.safeParse(rawKey);
    if (!parsedKey.success) {
      throw new HttpException(
        toErrorBody(
          DomainErrors.validation('The Idempotency-Key header is not in an acceptable format.'),
          request.correlationId,
        ),
        HttpStatus.BAD_REQUEST,
      );
    }

    const subjectId = request.auth?.userId ?? `anon:${request.ip ?? 'unknown'}`;
    const route = `${request.method} ${request.route?.path ?? request.path}`;
    const fingerprint = this.fingerprint(request.body);

    const existing = await this.store.find(parsedKey.data, subjectId, route);

    if (existing !== null) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new HttpException(
          toErrorBody(DomainErrors.idempotencyKeyReused(), request.correlationId),
          HttpStatus.CONFLICT,
        );
      }

      this.logger.info('idempotent replay served from store', {
        correlationId: request.correlationId,
        route,
      });
      response.status(existing.statusCode);
      response.setHeader('Idempotency-Replayed', 'true');
      return of(existing.responseBody);
    }

    const now = this.clock.now();

    return next.handle().pipe(
      tap({
        next: async (body: unknown) => {
          await this.store.save({
            key: parsedKey.data,
            subjectId,
            route,
            requestFingerprint: fingerprint,
            statusCode: response.statusCode,
            responseBody: body,
            createdAt: now,
            expiresAt: new Date(now.getTime() + seconds(spec.ttlSeconds)),
          });
        },
        // Failures are deliberately not stored. A 500 caused by a transient database
        // problem should be retryable; caching it would turn one bad moment into a
        // permanently broken key.
      }),
    );
  }

  private fingerprint(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  }
}
