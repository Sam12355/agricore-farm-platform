import jwt from 'jsonwebtoken';

import { JwtTokenService, type TokenConfig } from './token.service';

const config: TokenConfig = {
  accessSecret: 'access-secret-for-tests-only-not-a-real-secret',
  refreshSecret: 'refresh-secret-for-tests-only-not-a-real-secret',
  workerViewSecret: 'worker-view-secret-for-tests-only-not-a-real-secret',
  issuer: 'agricore-test',
  audience: 'agricore-clients',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 2_592_000,
};

const service = new JwtTokenService(config);

describe('access tokens', () => {
  it('round-trips the subject, role and family', () => {
    const { token } = service.issueAccessToken({
      userId: 'user-1',
      role: 'manager',
      familyId: 'family-1',
    });

    const verified = service.verifyAccessToken(token);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value).toEqual({ userId: 'user-1', role: 'manager', familyId: 'family-1' });
  });

  it('carries nothing that identifies a person', () => {
    const { token } = service.issueAccessToken({
      userId: 'user-1',
      role: 'user',
      familyId: 'family-1',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    // Access tokens end up in logs, proxies and crash reports. Anything in here should
    // be safe to find in all three.
    expect(Object.keys(decoded).sort()).toEqual(['aud', 'exp', 'fam', 'iat', 'iss', 'role', 'sub']);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'user-1', role: 'admin', fam: 'f' }, 'some-other-secret', {
      algorithm: 'HS256',
      issuer: config.issuer,
      audience: config.audience,
      expiresIn: 900,
    });
    expect(service.verifyAccessToken(forged).ok).toBe(false);
  });

  it('rejects an unsigned token claiming the none algorithm', () => {
    // The classic JWT bug. Pinning algorithms at verify time is what stops it.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        role: 'admin',
        fam: 'f',
        iss: config.issuer,
        aud: config.audience,
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');

    expect(service.verifyAccessToken(`${header}.${body}.`).ok).toBe(false);
  });

  it('rejects a token issued for a different audience', () => {
    const wrongAudience = jwt.sign({ sub: 'u', role: 'user', fam: 'f' }, config.accessSecret, {
      algorithm: 'HS256',
      issuer: config.issuer,
      audience: 'somebody-else',
      expiresIn: 900,
    });
    expect(service.verifyAccessToken(wrongAudience).ok).toBe(false);
  });

  it('rejects a token from a different issuer', () => {
    const wrongIssuer = jwt.sign({ sub: 'u', role: 'user', fam: 'f' }, config.accessSecret, {
      algorithm: 'HS256',
      issuer: 'not-us',
      audience: config.audience,
      expiresIn: 900,
    });
    expect(service.verifyAccessToken(wrongIssuer).ok).toBe(false);
  });

  it('reports an expired token distinctly, so the client knows to refresh', () => {
    const expired = jwt.sign({ sub: 'u', role: 'user', fam: 'f' }, config.accessSecret, {
      algorithm: 'HS256',
      issuer: config.issuer,
      audience: config.audience,
      expiresIn: -10,
    });
    const result = service.verifyAccessToken(expired);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/expired/i);
  });

  it('rejects a token missing the role claim rather than defaulting it', () => {
    const noRole = jwt.sign({ sub: 'u', fam: 'f' }, config.accessSecret, {
      algorithm: 'HS256',
      issuer: config.issuer,
      audience: config.audience,
      expiresIn: 900,
    });
    expect(service.verifyAccessToken(noRole).ok).toBe(false);
  });
});

describe('refresh tokens', () => {
  it('issues a high-entropy opaque token, not a JWT', () => {
    const { token } = service.issueRefreshToken();
    expect(token.split('.')).toHaveLength(1);
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => service.issueRefreshToken().token));
    expect(seen.size).toBe(500);
  });

  it('hashes deterministically so lookup by hash works', () => {
    const { token, hash } = service.issueRefreshToken();
    expect(service.hashRefreshToken(token)).toBe(hash);
  });

  it('stores a hash that does not reveal the token', () => {
    const { token, hash } = service.issueRefreshToken();
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('worker view tokens', () => {
  it('round-trips the alert and worker', () => {
    const token = service.issueWorkerViewToken({
      alertId: 'alert-1',
      workerId: 'worker-1',
      ttlSeconds: 3600,
    });
    const verified = service.verifyWorkerViewToken(token);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value).toEqual({ alertId: 'alert-1', workerId: 'worker-1' });
  });

  it('will not accept an access token in its place', () => {
    const { token } = service.issueAccessToken({
      userId: 'user-1',
      role: 'admin',
      familyId: 'f',
    });
    expect(service.verifyWorkerViewToken(token).ok).toBe(false);
  });

  it('will not let a worker link be used as an access token', () => {
    const link = service.issueWorkerViewToken({
      alertId: 'alert-1',
      workerId: 'worker-1',
      ttlSeconds: 3600,
    });
    expect(service.verifyAccessToken(link).ok).toBe(false);
  });

  it('expires', () => {
    const expired = jwt.sign(
      { inc: 'i', con: 'c', typ: 'worker-view' },
      config.workerViewSecret,
      {
        algorithm: 'HS256',
        issuer: config.issuer,
        audience: 'worker-view',
        expiresIn: -60,
      },
    );
    const result = service.verifyWorkerViewToken(expired);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/expired/i);
  });

  it('carries no role and no user id, so it cannot be widened', () => {
    const token = service.issueWorkerViewToken({
      alertId: 'i',
      workerId: 'c',
      ttlSeconds: 60,
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(decoded['role']).toBeUndefined();
    expect(decoded['sub']).toBeUndefined();
  });
});
