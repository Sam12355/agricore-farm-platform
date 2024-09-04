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
  createWorkerSchema,
  dataExportRequestSchema,
  endFieldOperationSchema,
  requestAccountDeletionSchema,
  startFieldOperationSchema,
  updatePrivacySettingsSchema,
  updateWorkerSchema,
  type CreateWorkerRequest,
  type DataExportRequest,
  type EndFieldOperationRequest,
  type RequestAccountDeletion,
  type StartFieldOperationRequest,
  type UpdatePrivacySettingsRequest,
  type UpdateWorkerRequest,
} from '@agricore/contracts';

import { PrivacyService } from '../../../application/services/privacy.service';
import { FieldOperationService } from '../../../application/services/field-operation.service';
import { WorkerService } from '../../../application/services/worker.service';
import {
  toPrivacySettingsDto,
  toFieldOperationDto,
  toWorkerDto,
} from '../dto-mappers';
import {
  CorrelationId,
  CurrentUser,
  RateLimit,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

@Controller(`api/${API_VERSION}/workers`)
export class WorkerController {
  constructor(private readonly workers: WorkerService) {}

  @Get()
  async list(@CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>) {
    const records = await this.workers.list(user.userId);
    return { items: records.map(toWorkerDto), nextCursor: null, hasMore: false };
  }

  @Post()
  @HttpCode(201)
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'subject' })
  async create(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(createWorkerSchema)) body: CreateWorkerRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.workers.create(user.userId, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toWorkerDto(result.value);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(updateWorkerSchema)) body: UpdateWorkerRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.workers.update(user.userId, id, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toWorkerDto(result.value);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.workers.remove(user.userId, id);
    if (!result.ok) throwDomain(result.error, correlationId);
  }
}

@Controller(`api/${API_VERSION}/field-operations`)
export class FieldOperationController {
  constructor(private readonly sessions: FieldOperationService) {}

  @Get()
  async list(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ) {
    const page = await this.sessions.list(user.userId, limit ? Number(limit) : undefined, cursor);
    return {
      items: page.items.map(toFieldOperationDto),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Post()
  @HttpCode(201)
  async start(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(startFieldOperationSchema)) body: StartFieldOperationRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sessions.start(user.userId, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toFieldOperationDto(result.value);
  }

  @Post(':id/end')
  @HttpCode(200)
  async end(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(endFieldOperationSchema)) body: EndFieldOperationRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.sessions.end(user.userId, id, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toFieldOperationDto(result.value);
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
