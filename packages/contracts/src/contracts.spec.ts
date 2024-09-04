import { describe, expect, it } from 'vitest';

import { loginRequestSchema, registerRequestSchema } from './auth';
import { createWorkerSchema, updateWorkerSchema } from './workers';
import { errorResponseSchema, idempotencyKeySchema, phoneSchema } from './common';
import {
  COUNTDOWN_MAX_SECONDS,
  COUNTDOWN_MIN_SECONDS,
  activateAlertSchema,
  alertEventSchema,
  recordLocationSchema,
  resolveAlertSchema,
  startCountdownSchema,
} from './alerts';
import { updatePrivacySettingsSchema } from './privacy';
import { resumeAlertSchema } from './realtime';
import { Routes } from './routes';

const uuid = '4f1c2b0e-2a1d-4c3b-9a0e-1f2d3c4b5a60';

describe('registration contract', () => {
  it('accepts a well-formed registration', () => {
    const result = registerRequestSchema.safeParse({
      email: 'Ada@Example.com',
      password: 'correct horse battery staple',
      displayName: 'Ada',
      acceptedDemoNotice: true,
    });
    expect(result.success).toBe(true);
    // Email is normalised at the edge so lookups never depend on the caller's casing.
    if (result.success) expect(result.data.email).toBe('ada@example.com');
  });

  it('refuses to register anyone who has not acknowledged the demo notice', () => {
    const result = registerRequestSchema.safeParse({
      email: 'ada@example.com',
      password: 'correct horse battery staple',
      displayName: 'Ada',
      acceptedDemoNotice: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a short password', () => {
    const result = registerRequestSchema.safeParse({
      email: 'ada@example.com',
      password: 'short',
      displayName: 'Ada',
      acceptedDemoNotice: true,
    });
    expect(result.success).toBe(false);
  });

  it('does not impose composition rules on long passphrases', () => {
    const result = registerRequestSchema.safeParse({
      email: 'ada@example.com',
      password: 'all lowercase words with no digits at all',
      displayName: 'Ada',
      acceptedDemoNotice: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('login contract', () => {
  it('does not apply the strength policy to login', () => {
    // A user whose password predates a policy change still has to be able to log in.
    const result = loginRequestSchema.safeParse({ email: 'ada@example.com', password: 'x' });
    expect(result.success).toBe(true);
  });
});

describe('assigned worker contract', () => {
  it('requires at least one way to reach the worker', () => {
    const result = createWorkerSchema.safeParse({ name: 'Sam' });
    expect(result.success).toBe(false);
  });

  it('accepts a worker with only a phone number', () => {
    const result = createWorkerSchema.safeParse({ name: 'Sam', phone: '+31 6 1234 5678' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty update', () => {
    expect(updateWorkerSchema.safeParse({}).success).toBe(false);
  });

  it('allows clearing a field with null', () => {
    expect(updateWorkerSchema.safeParse({ phone: null }).success).toBe(true);
  });
});

describe('phone contract', () => {
  it.each(['+31 6 1234 5678', '(020) 555-0100', '+1-555-0100'])('accepts %s', (value) => {
    expect(phoneSchema.safeParse(value).success).toBe(true);
  });

  it('rejects a phone number containing a script payload', () => {
    expect(phoneSchema.safeParse('<script>alert(1)</script>').success).toBe(false);
  });
});

describe('countdown contract', () => {
  it('defaults the duration when the client omits it', () => {
    const result = startCountdownSchema.safeParse({ activationIdempotencyKey: 'abcd1234efgh' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.durationSeconds).toBe(10);
  });

  it.each([COUNTDOWN_MIN_SECONDS - 1, COUNTDOWN_MAX_SECONDS + 1])(
    'rejects a duration of %i seconds',
    (durationSeconds) => {
      const result = startCountdownSchema.safeParse({
        durationSeconds,
        activationIdempotencyKey: 'abcd1234efgh',
      });
      expect(result.success).toBe(false);
    },
  );

  it('requires an idempotency key at countdown start, not at activation', () => {
    // The key is minted when the countdown begins so a crash mid-countdown still
    // deduplicates on retry after the app restarts.
    expect(startCountdownSchema.safeParse({ durationSeconds: 10 }).success).toBe(false);
  });
});

describe('idempotency key contract', () => {
  it('rejects a key that is too short to be unique in practice', () => {
    expect(idempotencyKeySchema.safeParse('abc').success).toBe(false);
  });

  it('rejects a key with characters that would need escaping in a header', () => {
    expect(idempotencyKeySchema.safeParse('has spaces here').success).toBe(false);
  });

  it('accepts a uuid', () => {
    expect(idempotencyKeySchema.safeParse(uuid).success).toBe(true);
  });
});

describe('activation contract', () => {
  it('defaults the trigger to the countdown path', () => {
    const result = activateAlertSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trigger).toBe('field_countdown');
  });

  it('accepts an occurredAt from a client that was offline', () => {
    const result = activateAlertSchema.safeParse({
      occurredAt: '2026-01-01T10:00:00.000Z',
      trigger: 'manual_report',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a timestamp without an offset', () => {
    expect(activateAlertSchema.safeParse({ occurredAt: '2026-01-01 10:00:00' }).success).toBe(
      false,
    );
  });
});

describe('location contract', () => {
  it('accepts a batch', () => {
    const result = recordLocationSchema.safeParse({
      points: [
        { latitude: 52.37, longitude: 4.9, accuracyMetres: 10, capturedAt: '2026-01-01T10:00:00.000Z' },
        { latitude: 52.38, longitude: 4.91, accuracyMetres: 12, capturedAt: '2026-01-01T10:00:30.000Z' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(recordLocationSchema.safeParse({ points: [] }).success).toBe(false);
  });

  it('caps the batch so a flush cannot become an unbounded write', () => {
    const point = {
      latitude: 1,
      longitude: 1,
      accuracyMetres: 5,
      capturedAt: '2026-01-01T10:00:00.000Z',
    };
    expect(recordLocationSchema.safeParse({ points: Array(51).fill(point) }).success).toBe(false);
  });

  it('rejects an out-of-range latitude at the contract boundary', () => {
    const result = recordLocationSchema.safeParse({
      points: [
        { latitude: 95, longitude: 4.9, accuracyMetres: 10, capturedAt: '2026-01-01T10:00:00.000Z' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('manager mutation contracts', () => {
  it('requires an expected version so a stale console cannot overwrite', () => {
    expect(resolveAlertSchema.safeParse({ resolution: 'issue_cleared' }).success).toBe(false);
    expect(
      resolveAlertSchema.safeParse({ resolution: 'issue_cleared', expectedVersion: 3 }).success,
    ).toBe(true);
  });
});

describe('privacy contract', () => {
  it('rejects an empty settings update', () => {
    expect(updatePrivacySettingsSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a location retention below the floor', () => {
    expect(updatePrivacySettingsSchema.safeParse({ locationRetentionDays: 0 }).success).toBe(false);
  });

  it('refuses a location retention above the ceiling', () => {
    expect(updatePrivacySettingsSchema.safeParse({ locationRetentionDays: 3650 }).success).toBe(
      false,
    );
  });
});

describe('realtime contract', () => {
  it('accepts a resume from sequence zero, meaning send everything', () => {
    expect(resumeAlertSchema.safeParse({ alertId: uuid, lastSequence: 0 }).success).toBe(true);
  });

  it('rejects a negative resume point', () => {
    expect(resumeAlertSchema.safeParse({ alertId: uuid, lastSequence: -1 }).success).toBe(
      false,
    );
  });
});

describe('alert event contract', () => {
  it('requires a positive sequence, because zero means nothing applied yet', () => {
    const event = {
      id: uuid,
      alertId: uuid,
      sequence: 0,
      type: 'alert.activated',
      actorType: 'user',
      actorId: uuid,
      occurredAt: '2026-01-01T10:00:00.000Z',
      recordedAt: '2026-01-01T10:00:01.000Z',
      payload: {},
    };
    expect(alertEventSchema.safeParse(event).success).toBe(false);
    expect(alertEventSchema.safeParse({ ...event, sequence: 1 }).success).toBe(true);
  });

  it('rejects an unknown event type rather than rendering it as unknown', () => {
    const event = {
      id: uuid,
      alertId: uuid,
      sequence: 1,
      type: 'alert.something_new',
      actorType: 'system',
      actorId: null,
      occurredAt: '2026-01-01T10:00:00.000Z',
      recordedAt: '2026-01-01T10:00:01.000Z',
      payload: {},
    };
    expect(alertEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('error envelope', () => {
  it('always carries a correlation id so a user can quote it in a support request', () => {
    const withoutCorrelation = {
      error: { code: 'NOT_FOUND', message: 'Alert was not found.' },
    };
    expect(errorResponseSchema.safeParse(withoutCorrelation).success).toBe(false);
  });
});

describe('routes', () => {
  it('versions every application route', () => {
    const collected = [
      Routes.auth.login,
      Routes.workers.collection,
      Routes.countdown.activate,
      Routes.alerts.collection,
      Routes.privacy.settings,
      Routes.subscriptions.current,
    ];
    for (const route of collected) expect(route.startsWith('/api/v1/')).toBe(true);
  });

  it('leaves operational routes unversioned, because probes should not chase versions', () => {
    expect(Routes.ops.health).toBe('/health');
    expect(Routes.ops.ready).toBe('/ready');
  });
});
