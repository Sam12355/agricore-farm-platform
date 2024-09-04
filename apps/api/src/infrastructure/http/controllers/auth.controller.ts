import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

import {
  API_VERSION,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type LogoutRequest,
  type RefreshRequest,
  type RegisterRequest,
} from '@agricore/contracts';

import { IdentityService } from '../../../application/services/identity.service';
import {
  CorrelationId,
  CurrentUser,
  Public,
  RateLimit,
  ZodValidationPipe,
  throwDomain,
  type AuthenticatedRequest,
} from '../http-plumbing';

/**
 * Validation pipes are attached to the body parameter rather than declared with
 * @UsePipes on the handler. @UsePipes applies to every argument, including the ones
 * produced by custom decorators like @CorrelationId, so the schema ends up being run
 * against a bare string and every request fails validation. That cost me a debugging
 * session; binding the pipe to @Body is both correct and clearer about what it validates.
 */
@Controller(`api/${API_VERSION}/auth`)
export class AuthController {
  constructor(private readonly identity: IdentityService) {}

  @Post('register')
  @Public()
  // Rate limited by address rather than by subject, because there is no subject yet.
  // Ten a minute is generous for a person and hostile to a script.
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip' })
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.identity.register(body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.identity.login(body);
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'ip' })
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.identity.refresh(body.refreshToken);
    if (!result.ok) throwDomain(result.error, correlationId);
    return result.value;
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(logoutRequestSchema)) body: LogoutRequest) {
    await this.identity.logout(body.refreshToken);
  }

  @Get('me')
  async me(
    @CurrentUser() user: NonNullable<AuthenticatedRequest['auth']>,
    @CorrelationId() correlationId: string,
  ) {
    const result = await this.identity.me(user.userId);
    if (!result.ok) throwDomain(result.error, correlationId);
    return {
      id: result.value.id,
      email: result.value.email,
      displayName: result.value.displayName,
      role: result.value.role,
      createdAt: result.value.createdAt.toISOString(),
    };
  }
}
