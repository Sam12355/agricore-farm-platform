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
  addOperatorNoteSchema,
  changePrioritySchema,
  claimIncidentSchema,
  incidentQuerySchema,
  recordLocationSchema,
  releaseIncidentSchema,
  resolveIncidentSchema,
  type AddOperatorNoteRequest,
  type ChangePriorityRequest,
  type ClaimIncidentRequest,
  type IncidentQuery,
  type RecordLocationRequest,
  type ResolveIncidentRequest,
} from '@guardianlink/contracts';
import { UserRole } from '@guardianlink/shared-types';

import { IncidentService } from '../../../application/services/incident.service';
import { toIncidentDto, toIncidentEventDto } from '../dto-mappers';
import {
  CorrelationId,
  CurrentUser,
  RateLimit,
  Roles,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

@Controller(`api/${API_VERSION}/incidents`)
export class IncidentController {
  constructor(private readonly incidents: IncidentService) {}

  @Get()
  @RateLimit({ limit: 240, windowSeconds: 60, by: 'subject' })
  async list(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Query(new ZodValidationPipe(incidentQuerySchema)) query: IncidentQuery,
  ) {
    const page = await this.incidents.list({ userId: user.userId, role: user.role }, query);
    return {
      items: page.items.map(toIncidentDto),
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
    const result = await this.incidents.get(id, { userId: user.userId, role: user.role });
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }

  @Get(':id/timeline')
  async timeline(
    @Param('id') id: string,
    @Query('after') after: string | undefined,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const afterSequence = Number.isFinite(Number(after)) ? Number(after) : 0;
    const result = await this.incidents.timeline(
      id,
      { userId: user.userId, role: user.role },
      afterSequence,
    );
    if (!result.ok) throwDomain(result.error, correlationId);

    return {
      incident: toIncidentDto(result.value.incident),
      events: result.value.events.map(toIncidentEventDto),
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
    const result = await this.incidents.recordLocation(
      id,
      { userId: user.userId, role: user.role },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post(':id/claim')
  @HttpCode(200)
  @Roles(UserRole.Operator, UserRole.Admin)
  async claim(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(claimIncidentSchema)) body: ClaimIncidentRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.incidents.claim(
      id,
      { userId: user.userId, role: user.role },
      body.expectedVersion,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }

  @Post(':id/release')
  @HttpCode(200)
  @Roles(UserRole.Operator, UserRole.Admin)
  async release(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(releaseIncidentSchema)) body: ClaimIncidentRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.incidents.release(
      id,
      { userId: user.userId, role: user.role },
      body.expectedVersion,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }

  @Post(':id/notes')
  @HttpCode(201)
  @Roles(UserRole.Operator, UserRole.Admin)
  async addNote(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(addOperatorNoteSchema)) body: AddOperatorNoteRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.incidents.addNote(id, { userId: user.userId, role: user.role }, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }

  @Post(':id/priority')
  @HttpCode(200)
  @Roles(UserRole.Operator, UserRole.Admin)
  async changePriority(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(changePrioritySchema)) body: ChangePriorityRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.incidents.changePriority(
      id,
      { userId: user.userId, role: user.role },
      body,
    );
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id') id: string,
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @Body(new ZodValidationPipe(resolveIncidentSchema)) body: ResolveIncidentRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.incidents.resolve(id, { userId: user.userId, role: user.role }, body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return toIncidentDto(result.value);
  }
}
