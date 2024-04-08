import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import {
  DomainErrors,
  type DomainError,
  type Result,
  type UserRole,
  err,
  ok,
} from '@guardianlink/shared-types';

import type { AccessTokenPayload, TokenService } from '../../application/ports';

export interface TokenConfig {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly contactViewSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
}

/**
 * Access tokens are JWTs. Refresh tokens are not.
 *
 * A refresh token has no reason to be self-describing. Making it an opaque random string
 * means the server decides when it stops working, which is the whole point of rotation
 * and reuse detection. A stateless refresh JWT cannot be revoked without a denylist,
 * which is a session store wearing a disguise.
 *
 * Only the SHA-256 of the refresh token is stored. A database dump therefore does not
 * hand anyone a working session. Hashing is unsalted and unstretched on purpose here:
 * the input is 32 bytes of CSPRNG output, so there is no dictionary to attack and a slow
 * KDF would only add latency to every refresh.
 */
export class JwtTokenService implements TokenService {
  constructor(private readonly config: TokenConfig) {}

  issueAccessToken(payload: AccessTokenPayload): { token: string; expiresInSeconds: number } {
    const token = jwt.sign(
      { sub: payload.userId, role: payload.role, fam: payload.familyId },
      this.config.accessSecret,
      {
        algorithm: 'HS256',
        expiresIn: this.config.accessTtlSeconds,
        issuer: this.config.issuer,
        audience: this.config.audience,
      },
    );
    return { token, expiresInSeconds: this.config.accessTtlSeconds };
  }

  verifyAccessToken(token: string): Result<AccessTokenPayload, DomainError> {
    try {
      const decoded = jwt.verify(token, this.config.accessSecret, {
        // Pinning the algorithm is not optional. Without it a token signed with "none",
        // or an RS256 token verified against a public key used as an HMAC secret, is
        // accepted. Both are old bugs that keep coming back.
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      if (typeof decoded === 'string') {
        return err(DomainErrors.unauthenticated('Malformed token.'));
      }

      const sub = decoded['sub'];
      const role = decoded['role'];
      const fam = decoded['fam'];

      if (typeof sub !== 'string' || typeof role !== 'string' || typeof fam !== 'string') {
        return err(DomainErrors.unauthenticated('Malformed token.'));
      }

      return ok({ userId: sub, role: role as UserRole, familyId: fam });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return err(DomainErrors.unauthenticated('Your session has expired.'));
      }
      return err(DomainErrors.unauthenticated('That token is not valid.'));
    }
  }

  issueRefreshToken(): { token: string; hash: string; expiresInSeconds: number } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresInSeconds: this.config.refreshTtlSeconds,
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * The link a trusted contact receives.
   *
   * It names exactly one incident and one contact, and it expires. There is no way to
   * widen it: the token has no role, no user id and no list scope, so the worst a leaked
   * link can do is show one incident that someone was already entitled to see.
   */
  issueContactViewToken(input: {
    incidentId: string;
    contactId: string;
    ttlSeconds: number;
  }): string {
    return jwt.sign(
      { inc: input.incidentId, con: input.contactId, typ: 'contact-view' },
      this.config.contactViewSecret,
      {
        algorithm: 'HS256',
        expiresIn: input.ttlSeconds,
        issuer: this.config.issuer,
        audience: 'contact-view',
      },
    );
  }

  verifyContactViewToken(token: string): Result<{ incidentId: string; contactId: string }, DomainError> {
    try {
      const decoded = jwt.verify(token, this.config.contactViewSecret, {
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: 'contact-view',
      });

      if (typeof decoded === 'string' || decoded['typ'] !== 'contact-view') {
        return err(DomainErrors.unauthenticated('That link is not valid.'));
      }

      const incidentId = decoded['inc'];
      const contactId = decoded['con'];
      if (typeof incidentId !== 'string' || typeof contactId !== 'string') {
        return err(DomainErrors.unauthenticated('That link is not valid.'));
      }

      return ok({ incidentId, contactId });
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return err(DomainErrors.unauthenticated('That link has expired.'));
      }
      return err(DomainErrors.unauthenticated('That link is not valid.'));
    }
  }
}
