import { Inject, Injectable } from '@nestjs/common';

import {
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  defaultPrivacySettings,
} from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  UserRole,
  days,
  err,
  ok,
} from '@guardianlink/shared-types';

import { PORTS } from '../tokens';
import type {
  IdGenerator,
  PasswordHasher,
  PrivacySettingsRepository,
  RefreshTokenRepository,
  StructuredLogger,
  TokenService,
  UserRecord,
  UserRepository,
} from '../ports';

const REFRESH_TOKEN_TTL_DAYS = 30;

/**
 * Registration, login and token rotation.
 *
 * The interesting part is refresh-token handling. Access tokens are short-lived and
 * stateless; refresh tokens are opaque, stored only as a hash, single-use, and belong to
 * a family. When a refresh token is presented a second time, that means either a client
 * bug or a stolen token, and we cannot tell which from the request. So we revoke the
 * whole family. The legitimate user has to log in again, which is a small cost compared
 * with leaving a thief with a working session.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.RefreshTokenRepository) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(PORTS.PrivacySettingsRepository) private readonly privacy: PrivacySettingsRepository,
    @Inject(PORTS.PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async register(input: RegisterRequest): Promise<Result<AuthResponse, DomainError>> {
    const now = this.clock.now();
    const existing = await this.users.findByEmail(input.email);
    if (existing !== null) {
      // Deliberately the same wording a caller would get for any other conflict, and no
      // hint about whether the address is registered. Enumerating accounts through the
      // registration form is the cheapest attack there is.
      return err(DomainErrors.conflict('That email address cannot be registered.'));
    }

    const user: UserRecord = {
      id: this.ids.next(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: await this.hasher.hash(input.password),
      role: UserRole.User,
      createdAt: now,
      deletedAt: null,
      deletionScheduledFor: null,
    };

    const inserted = await this.users.insert(user);
    if (!inserted.ok) return inserted;

    // Privacy defaults exist from the first second of the account, so there is never a
    // window where retention is undefined and a background job has to guess.
    const defaults = defaultPrivacySettings(now.toISOString());
    await this.privacy.upsert({
      userId: user.id,
      shareLocationWithContacts: defaults.shareLocationWithContacts,
      shareLocationWithOperators: defaults.shareLocationWithOperators,
      storePreciseLocationHistory: defaults.storePreciseLocationHistory,
      incidentRetentionDays: defaults.incidentRetentionDays,
      locationRetentionDays: defaults.locationRetentionDays,
      notificationLogRetentionDays: defaults.notificationLogRetentionDays,
      allowAnonymisedProductAnalytics: defaults.allowAnonymisedProductAnalytics,
      updatedAt: now,
    });

    this.logger.info('user registered', { userId: user.id });
    return ok(await this.issueSession(user, null));
  }

  async login(input: LoginRequest): Promise<Result<AuthResponse, DomainError>> {
    const user = await this.users.findByEmail(input.email);

    if (user === null) {
      // Hash anyway so a missing account and a wrong password take comparable time.
      // Without this the response time alone tells an attacker which addresses exist.
      await this.hasher.hash(input.password);
      return err(DomainErrors.unauthenticated('Email address or password is incorrect.'));
    }

    if (user.deletedAt !== null) {
      return err(DomainErrors.unauthenticated('Email address or password is incorrect.'));
    }

    const valid = await this.hasher.verify(input.password, user.passwordHash);
    if (!valid) {
      this.logger.warn('failed login', { userId: user.id });
      return err(DomainErrors.unauthenticated('Email address or password is incorrect.'));
    }

    // Opportunistic upgrade: if the stored hash used older parameters, replace it now
    // that we have the plaintext in hand. Nobody has to run a migration.
    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.users.update({ ...user, passwordHash: await this.hasher.hash(input.password) });
    }

    return ok(await this.issueSession(user, input.deviceName ?? null));
  }

  async refresh(refreshToken: string): Promise<Result<AuthResponse, DomainError>> {
    const now = this.clock.now();
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const record = await this.refreshTokens.findByHash(hash);

    if (record === null) {
      return err(DomainErrors.unauthenticated('That refresh token is not valid.'));
    }

    if (record.revokedAt !== null) {
      return err(DomainErrors.unauthenticated('That session has been ended.'));
    }

    if (record.usedAt !== null) {
      // Reuse. Either the client replayed, or somebody else has a copy. We cannot tell,
      // so the whole family goes.
      const revoked = await this.refreshTokens.revokeFamily(record.familyId, now);
      this.logger.warn('refresh token reuse detected, family revoked', {
        userId: record.userId,
        familyId: record.familyId,
        revokedCount: revoked,
      });
      return err(DomainErrors.unauthenticated('That session has been ended for security reasons.'));
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      return err(DomainErrors.unauthenticated('That session has expired.'));
    }

    const user = await this.users.findById(record.userId);
    if (user === null || user.deletedAt !== null) {
      return err(DomainErrors.unauthenticated('That session is no longer valid.'));
    }

    await this.refreshTokens.markUsed(record.id, now);
    return ok(await this.issueSession(user, record.deviceName, record.familyId));
  }

  async logout(refreshToken: string): Promise<Result<void, DomainError>> {
    const now = this.clock.now();
    const record = await this.refreshTokens.findByHash(this.tokens.hashRefreshToken(refreshToken));

    // Logging out with an unknown token still reports success. There is nothing useful a
    // caller can do with the distinction and answering honestly leaks token validity.
    if (record !== null) {
      await this.refreshTokens.revokeFamily(record.familyId, now);
    }
    return ok();
  }

  async me(userId: string): Promise<Result<UserRecord, DomainError>> {
    const user = await this.users.findById(userId);
    if (user === null || user.deletedAt !== null) return err(DomainErrors.notFound('Account'));
    return ok(user);
  }

  private async issueSession(
    user: UserRecord,
    deviceName: string | null,
    existingFamilyId?: string,
  ): Promise<AuthResponse> {
    const now = this.clock.now();
    const familyId = existingFamilyId ?? this.ids.next();

    const access = this.tokens.issueAccessToken({
      userId: user.id,
      role: user.role,
      familyId,
    });
    const refresh = this.tokens.issueRefreshToken();

    await this.refreshTokens.insert({
      id: this.ids.next(),
      userId: user.id,
      familyId,
      tokenHash: refresh.hash,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + days(REFRESH_TOKEN_TTL_DAYS)),
      usedAt: null,
      revokedAt: null,
      deviceName,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
      tokens: {
        accessToken: access.token,
        expiresIn: access.expiresInSeconds,
        refreshToken: refresh.token,
        refreshExpiresIn: refresh.expiresInSeconds,
        tokenType: 'Bearer',
      },
    };
  }
}
