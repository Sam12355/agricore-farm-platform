import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';

import { FixedClock, type Clock } from '@agricore/shared-types';

import { AppModule } from '../../src/app.module';
import { PORTS } from '../../src/application/tokens';
import { developmentConfig } from '../../src/config/configuration';
import { FastTestPasswordHasher } from '../../src/infrastructure/security/password-hasher';
import {
  MemoryNotificationRepository,
  MemoryOutboxRepository,
} from '../../src/infrastructure/persistence/memory/memory-repositories';
import { RecordingRealtimePublisher } from '../../src/infrastructure/realtime/realtime.gateway';
import { SequentialIdGenerator } from '../../src/infrastructure/services/support-adapters';

/**
 * Boots the real application in-process for integration and end-to-end tests.
 *
 * Three things are swapped, and only three:
 *
 *   - the clock, so countdown expiry and escalation windows are deterministic
 *   - the password hasher, because the production parameters cost ~100 ms per call and
 *     an end-to-end run registers a lot of accounts
 *   - the realtime publisher, so a test can assert what would have gone out over the
 *     socket without standing up a socket server
 *
 * Everything else is the production wiring: the same guards, the same interceptors, the
 * same validation pipes, the same services. A test that passes here is exercising the
 * code that ships, not a parallel arrangement of it.
 */
export interface TestApp {
  readonly app: INestApplication;
  readonly module: TestingModule;
  readonly clock: FixedClock;
  readonly realtime: RecordingRealtimePublisher;
  readonly outbox: MemoryOutboxRepository;
  readonly notifications: MemoryNotificationRepository;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const clock = new FixedClock('2026-03-14T19:45:00.000Z');
  const realtime = new RecordingRealtimePublisher();

  // forConfig returns a DynamicModule, which belongs in `imports` rather than being
  // spread as module metadata. Importing it keeps NestModule.configure in play, so the
  // correlation middleware runs in tests exactly as it does in production.
  const module = await Test.createTestingModule({
    imports: [AppModule.forConfig(developmentConfig())],
  })
    .overrideProvider(PORTS.Clock)
    .useValue(clock satisfies Clock)
    .overrideProvider(PORTS.PasswordHasher)
    .useValue(new FastTestPasswordHasher())
    .overrideProvider(PORTS.RealtimePublisher)
    .useValue(realtime)
    .overrideProvider(PORTS.IdGenerator)
    .useValue(new SequentialIdGenerator('ade1'))
    .compile();

  const app = module.createNestApplication();
  // No global filters or pipes are registered here on purpose. They come from the
  // APP_FILTER and APP_GUARD providers in the module, so the test runs the production
  // request pipeline rather than a second one assembled by the harness.
  await app.init();

  return {
    app,
    module,
    clock,
    realtime,
    outbox: module.get(PORTS.OutboxRepository),
    notifications: module.get(PORTS.NotificationRepository),
    close: async () => {
      await app.close();
    },
  };
}
