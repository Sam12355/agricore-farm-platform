import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

import {
  API_VERSION,
  DEMO_NOTICE_FULL,
  acknowledgeIncidentSchema,
  type AcknowledgeIncidentRequest,
} from '@guardianlink/contracts';

import { ContactViewService } from '../../../application/services/contact-view.service';
import { PORTS } from '../../../application/tokens';
import type { IncidentRepository, OutboxRepository, UserRepository } from '../../../application/ports';
import {
  CorrelationId,
  Public,
  RateLimit,
  ZodValidationPipe,
  throwDomain,
} from '../http-plumbing';

/**
 * The trusted-contact surface.
 *
 * Public in the sense of "no account", not "no authorisation". The token in the path is
 * the credential, and it is checked on every call. Rate limits are tighter here than
 * anywhere else in the API because these endpoints are the only ones an unauthenticated
 * caller can reach with a resource identifier in hand.
 */
@Controller(`api/${API_VERSION}/contact-view`)
export class ContactViewController {
  constructor(private readonly contactView: ContactViewService) {}

  @Get(':token')
  @Public()
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip' })
  async view(@Param('token') token: string, @CorrelationId() correlationId: string) {
    const result = await this.contactView.view(token);
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post(':token/acknowledge')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 60, by: 'ip' })
  async acknowledge(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(acknowledgeIncidentSchema)) body: AcknowledgeIncidentRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.contactView.acknowledge(token, body.note ?? null);
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }
}

/**
 * Liveness and readiness are genuinely different questions and are answered differently.
 *
 * Liveness asks "is this process wedged" and must not depend on anything external.
 * Wiring a database check into it means a database blip restarts every task, which turns
 * a recoverable incident into an outage.
 *
 * Readiness asks "should traffic be sent here" and does check dependencies, so a task
 * that cannot reach its database leaves the load balancer pool without dying.
 */
@Controller()
export class OpsController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.OutboxRepository) private readonly outbox: OutboxRepository,
  ) {}

  @Get('health')
  @Public()
  health() {
    return {
      status: 'ok' as const,
      version: process.env['APP_VERSION'] ?? '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) response: Response) {
    const checks = [];

    for (const [name, probe] of [
      ['users', () => this.users.findById('readiness-probe')],
      ['incidents', () => this.incidents.countByStatus('active')],
      ['outbox', () => this.outbox.pendingCount()],
    ] as const) {
      const started = Date.now();
      try {
        await probe();
        checks.push({ name, status: 'up' as const, latencyMs: Date.now() - started });
      } catch (error) {
        checks.push({
          name,
          status: 'down' as const,
          // The message, not the stack, and never the connection string.
          detail: error instanceof Error ? error.message : 'unknown error',
          latencyMs: Date.now() - started,
        });
      }
    }

    const ready = checks.every((check) => check.status === 'up');
    // The status code is what a load balancer reads. A body saying "not_ready" behind a
    // 200 keeps traffic coming to a task that cannot serve it.
    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: ready ? ('ready' as const) : ('not_ready' as const), checks };
  }

  @Get('notice')
  @Public()
  notice() {
    return { notice: DEMO_NOTICE_FULL };
  }
}
