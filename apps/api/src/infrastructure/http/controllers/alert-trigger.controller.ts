import { Body, Controller, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';

import {
  API_VERSION,
  activateAlertSchema,
  cancelCountdownSchema,
  startCountdownSchema,
  type ActivateAlertRequest,
  type CancelCountdownRequest,
  type StartCountdownRequest,
} from '@agricore/contracts';

import { AlertTriggerService } from '../../../application/services/alert-trigger.service';
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
import { toCountdownDto, toAlertDto } from '../dto-mappers';

@Controller(`api/${API_VERSION}/alerts`)
export class AlertTriggerController {
  constructor(private readonly alertTrigger: AlertTriggerService) {}

  @Post('countdown')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'subject' })
  async startCountdown(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(startCountdownSchema)) body: StartCountdownRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alertTrigger.startCountdown(user.userId, body);
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
    const result = await this.alertTrigger.cancelCountdown(user.userId, id, body.reason);
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
    @Body(new ZodValidationPipe(activateAlertSchema)) body: ActivateAlertRequest,
    @CorrelationId() correlationId: string,
    @IdempotencyKey() idempotencyKey: string,
  ) {
    const result = await this.alertTrigger.activate(
      { userId: user.userId, correlationId, idempotencyKey },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return { alert: toAlertDto(result.value.alert), deduplicated: result.value.deduplicated };
  }
}
