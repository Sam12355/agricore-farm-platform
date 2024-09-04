import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  API_VERSION,
  addManagerNoteSchema,
  changePrioritySchema,
  claimAlertSchema,
  alertQuerySchema,
  recordLocationSchema,
  releaseAlertSchema,
  resolveAlertSchema,
  type AddManagerNoteRequest,
  type ChangePriorityRequest,
  type ClaimAlertRequest,
  type AlertQuery,
  type RecordLocationRequest,
  type ResolveAlertRequest,
} from '@agricore/contracts';
import { UserRole } from '@agricore/shared-types';

import { AlertService } from '../../../application/services/alert.service';
import { toAlertDto, toAlertEventDto } from '../dto-mappers';
import {
  CorrelationId,
  CurrentUser,
  RateLimit,
  Roles,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

@Controller(`api/${API_VERSION}/alerts`)
export class AlertController {
  constructor(private readonly alerts: AlertService) {}

  @Get()
  @RateLimit({ limit: 240, windowSeconds: 60, by: 'subject' })
  async list(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Query(new ZodValidationPipe(alertQuerySchema)) query: AlertQuery,
  ) {
    const page = await this.alerts.list({ userId: user.userId, role: user.role }, query);
    return {
      items: page.items.map(toAlertDto),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.get(id, { userId: user.userId, role: user.role });
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }

  @Get(':id/timeline')
  async timeline(
    @Param('id') id: string,
    @Query('after') after: string | undefined,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const afterSequence = Number.isFinite(Number(after)) ? Number(after) : 0;
    const result = await this.alerts.timeline(
      id,
      { userId: user.userId, role: user.role },
      afterSequence,
    );
    if (!result.ok) throwDomain(result.error, correlationId);

    return {
      alert: toAlertDto(result.value.alert),
      events: result.value.events.map(toAlertEventDto),
      latestSequence: result.value.latestSequence,
    };
  }

  /**
   * Location comes in batches so an offline client can flush a backlog in one request
   * rather than one round trip per fix, which on a bad connection is the difference
   * between catching up and never catching up.
   */
  @Post(':id/location')
  @HttpCode(202)
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'subject' })
  async recordLocation(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(recordLocationSchema)) body: RecordLocationRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.recordLocation(
      id,
      { userId: user.userId, role: user.role },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post(':id/claim')
  @HttpCode(200)
  @Roles(UserRole.Manager, UserRole.Admin)
  async claim(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(claimAlertSchema)) body: ClaimAlertRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.claim(
      id,
      { userId: user.userId, role: user.role },
      body.expectedVersion,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }

  @Post(':id/release')
  @HttpCode(200)
  @Roles(UserRole.Manager, UserRole.Admin)
  async release(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(releaseAlertSchema)) body: ClaimAlertRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.release(
      id,
      { userId: user.userId, role: user.role },
      body.expectedVersion,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }

  @Post(':id/notes')
  @HttpCode(201)
  @Roles(UserRole.Manager, UserRole.Admin)
  async addNote(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(addManagerNoteSchema)) body: AddManagerNoteRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.addNote(id, { userId: user.userId, role: user.role }, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }

  @Post(':id/priority')
  @HttpCode(200)
  @Roles(UserRole.Manager, UserRole.Admin)
  async changePriority(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(changePrioritySchema)) body: ChangePriorityRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.changePriority(
      id,
      { userId: user.userId, role: user.role },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(resolveAlertSchema)) body: ResolveAlertRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.alerts.resolve(id, { userId: user.userId, role: user.role }, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toAlertDto(result.value);
  }
}
