import { Body, Controller, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';

import {
  API_VERSION,
  activateIncidentSchema,
  cancelCountdownSchema,
  startCountdownSchema,
  type ActivateIncidentRequest,
  type CancelCountdownRequest,
  type StartCountdownRequest,
} from '@guardianlink/contracts';

import { SosService } from '../../../application/services/sos.service';
import { IdempotencyInterceptor, Idempotent } from '../idempotency.interceptor';
import {
  CorrelationId,
  CurrentUser,
  IdempotencyKey,
  RateLimit,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';
import { toCountdownDto, toIncidentDto } from '../dto-mappers';

@Controller(`api/${API_VERSION}/sos`)
export class SosController {
  constructor(private readonly sos: SosService) {}

  @Post('countdown')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'subject' })
  async startCountdown(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(startCountdownSchema)) body: StartCountdownRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sos.startCountdown(user.userId, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toCountdownDto(result.value);
  }

  @Post('countdown/:id/cancel')
  @HttpCode(200)
  async cancelCountdown(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(cancelCountdownSchema)) body: CancelCountdownRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sos.cancelCountdown(user.userId, id, body.reason);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toCountdownDto(result.value);
  }

  /**
   * The one endpoint where a duplicate request has a real-world cost, so the
   * Idempotency-Key header is mandatory rather than advisory. The interceptor replays a
   * stored response for a repeat, and the service deduplicates again at the data layer,
   * which covers the case where two retries arrive concurrently and neither has a
   * stored response yet.
   */
  @Post('activate')
  @HttpCode(201)
  @Idempotent({ required: true, ttlSeconds: 86_400 })
  @UseInterceptors(IdempotencyInterceptor)
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'subject' })
  async activate(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(activateIncidentSchema)) body: ActivateIncidentRequest,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const result = await this.sos.activate(
      { userId: user.userId, correlationId, idempotencyKey },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return { incident: toIncidentDto(result.value.incident), deduplicated: result.value.deduplicated };
  }
}
