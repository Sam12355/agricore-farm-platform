import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import {
  API_VERSION,
  DEMO_NOTICE_FULL,
  createTrustedContactSchema,
  dataExportRequestSchema,
  endSafetySessionSchema,
  requestAccountDeletionSchema,
  startSafetySessionSchema,
  updatePrivacySettingsSchema,
  updateTrustedContactSchema,
  type CreateTrustedContactRequest,
  type DataExportRequest,
  type EndSafetySessionRequest,
  type RequestAccountDeletion,
  type StartSafetySessionRequest,
  type UpdatePrivacySettingsRequest,
  type UpdateTrustedContactRequest,
} from '@guardianlink/contracts';

import { PrivacyService } from '../../../application/services/privacy.service';
import { SafetySessionService } from '../../../application/services/safety-session.service';
import { TrustedContactService } from '../../../application/services/trusted-contact.service';
import {
  toPrivacySettingsDto,
  toSafetySessionDto,
  toTrustedContactDto,
} from '../dto-mappers';
import {
  CorrelationId,
  CurrentUser,
  RateLimit,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

@Controller(`api/${API_VERSION}/trusted-contacts`)
export class TrustedContactController {
  constructor(private readonly contacts: TrustedContactService) {}

  @Get()
  async list(@CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>) {
    const records = await this.contacts.list(user.userId);
    return { items: records.map(toTrustedContactDto), nextCursor: null, hasMore: false };
  }

  @Post()
  @HttpCode(201)
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'subject' })
  async create(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(createTrustedContactSchema)) body: CreateTrustedContactRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.contacts.create(user.userId, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toTrustedContactDto(result.value);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(updateTrustedContactSchema)) body: UpdateTrustedContactRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.contacts.update(user.userId, id, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toTrustedContactDto(result.value);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.contacts.remove(user.userId, id);
    if (!result.ok) throwDomain(result.error, correlationId);
  }
}

@Controller(`api/${API_VERSION}/safety-sessions`)
export class SafetySessionController {
  constructor(private readonly sessions: SafetySessionService) {}

  @Get()
  async list(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    const page = await this.sessions.list(user.userId, limit ? Number(limit) : undefined, cursor);
    return {
      items: page.items.map(toSafetySessionDto),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Post()
  @HttpCode(201)
  async start(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(startSafetySessionSchema)) body: StartSafetySessionRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sessions.start(user.userId, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toSafetySessionDto(result.value);
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(endSafetySessionSchema)) body: EndSafetySessionRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sessions.end(user.userId, id, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toSafetySessionDto(result.value);
  }
}

@Controller(`api/${API_VERSION}/privacy`)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('settings')
  async getSettings(@CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>) {
    return toPrivacySettingsDto(await this.privacy.getSettings(user.userId));
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(updatePrivacySettingsSchema)) body: UpdatePrivacySettingsRequest,
  ) {
    return toPrivacySettingsDto(await this.privacy.updateSettings(user.userId, body));
  }

  @Post('export')
  @HttpCode(202)
  // Exports are expensive and sensitive. A low limit here is not about load, it is about
  // making bulk extraction of an account's history noisy and slow.
  @RateLimit({ limit: 3, windowSeconds: 3600, by: 'subject' })
  async requestExport(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(dataExportRequestSchema)) body: DataExportRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.privacy.requestExport(user.userId, body.includeLocationHistory);
    if (!result.ok) throwDomain(result.error, correlationId);
    return {
      id: result.value.id,
      status: 'ready' as const,
      requestedAt: new Date().toISOString(),
      readyAt: new Date().toISOString(),
      expiresAt: result.value.expiresAt.toISOString(),
      downloadUrl: result.value.url,
      sizeBytes: result.value.sizeBytes,
    };
  }

  @Get('deletion')
  async deletionStatus(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.privacy.deletionStatus(user.userId);
    if (!result.ok) throwDomain(result.error, correlationId);
    return {
      status: result.value.status,
      requestedAt: result.value.requestedAt?.toISOString() ?? null,
      scheduledFor: result.value.scheduledFor?.toISOString() ?? null,
      cancellableUntil: result.value.scheduledFor?.toISOString() ?? null,
    };
  }

  @Post('deletion')
  @HttpCode(202)
  @RateLimit({ limit: 5, windowSeconds: 3600, by: 'subject' })
  async requestDeletion(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(requestAccountDeletionSchema)) body: RequestAccountDeletion,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.privacy.requestDeletion(user.userId, body.password);
    if (!result.ok) throwDomain(result.error, correlationId);
    return {
      status: 'scheduled' as const,
      scheduledFor: result.value.scheduledFor.toISOString(),
      notice: DEMO_NOTICE_FULL,
    };
  }

  @Delete('deletion')
  @HttpCode(204)
  async cancelDeletion(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.privacy.cancelDeletion(user.userId);
    if (!result.ok) throwDomain(result.error, correlationId);
  }
}
