import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { ALL_SCENARIO_KINDS, DEMO_ACCOUNTS, buildScenario } from '@agricore/test-fixtures';

import { AppModule } from '../app.module';
import { PORTS } from '../application/tokens';
import { IdentityService } from '../application/services/identity.service';
import { AlertService } from '../application/services/alert.service';
import { NotificationDispatchService } from '../application/services/notification-dispatch.service';
import { AlertTriggerService } from '../application/services/alert-trigger.service';
import { WorkerService } from '../application/services/worker.service';
import { developmentConfig } from '../config/configuration';
import type { UserRepository } from '../application/ports';

/**
 * Seeds demo accounts and the five scenarios from the fixtures package.
 *
 * It drives the real services rather than inserting rows. That is slower and entirely
 * worth it: seeded data goes through the same validation, the same authorisation and the
 * same state machine as anything a user creates, so the demo cannot end up in a state the
 * application would never produce. Seeds that write directly to tables are how a demo
 * shows a screen that cannot happen.
 *
 *   pnpm seed
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    AppModule.forConfig(developmentConfig({ LOG_LEVEL: 'warn' })),
    { logger: ['error', 'warn'] },
  );

  const identity = app.get(IdentityService);
  const workers = app.get(WorkerService);
  const alert = app.get(AlertTriggerService);
  const alerts = app.get(AlertService);
  const dispatch = app.get(NotificationDispatchService);
  const users = app.get<UserRepository>(PORTS.UserRepository);

  console.log('Seeding demo accounts');
  const accounts = new Map<string, { userId: string; token: string }>();

  for (const account of DEMO_ACCOUNTS) {
    const registered = await identity.register({
      email: account.email,
      password: account.password,
      displayName: account.displayName,
      acceptedDemoNotice: true,
    });

    if (!registered.ok) {
      console.log(`  ${account.email}: already present, skipping`);
      continue;
    }

    // Roles are never self-assignable through the API. Provisioning one is an
    // out-of-band action, which is exactly what this script is.
    if (account.role !== 'user') {
      const record = await users.findById(registered.value.user.id);
      if (record) await users.update({ ...record, role: account.role });
    }

    accounts.set(account.email, {
      userId: registered.value.user.id,
      token: registered.value.tokens.accessToken,
    });
    console.log(`  ${account.email} (${account.role})`);
  }

  const subject = accounts.get('demo.user@example.com');
  if (subject === undefined) {
    console.log('\nDemo user already existed. Nothing further to seed.');
    await app.close();
    return;
  }

  console.log('\nSeeding scenarios');

  for (const kind of ALL_SCENARIO_KINDS) {
    const scenario = buildScenario(kind);
    console.log(`\n  ${kind}: ${scenario.title}`);

    // Fresh workers per scenario so each one is self-contained and a reviewer can run
    // any single scenario without the others having run first.
    const workerIds: string[] = [];
    for (const worker of scenario.workers) {
      const created = await workers.create(subject.userId, {
        name: worker.displayName,
        phone: worker.phone,
        email: worker.email,
        jobRole: worker.jobRole,
        priority: worker.priority,
        preferredChannel: 'any',
        canViewLiveLocation: true,
      });
      if (created.ok) workerIds.push(created.value.id);
    }

    const countdown = await alert.startCountdown(subject.userId, {
      durationSeconds: 10,
      activationIdempotencyKey: `seed-${kind}-${Date.now()}`,
    });
    if (!countdown.ok) {
      console.log(`    could not start countdown: ${countdown.error.message}`);
      continue;
    }

    if (kind === 'cancelled_countdown') {
      const cancelled = await alert.cancelCountdown(
        subject.userId,
        countdown.value.id,
        'false_trigger',
      );
      console.log(`    cancelled: ${cancelled.ok}. No alert created, which is the point.`);
      continue;
    }

    const activated = await alert.activate(
      {
        userId: subject.userId,
        correlationId: `seed-${kind}`,
        idempotencyKey: countdown.value.activationIdempotencyKey,
      },
      { countdownId: countdown.value.id, trigger: 'field_countdown' },
    );

    if (!activated.ok) {
      console.log(`    could not activate: ${activated.error.message}`);
      continue;
    }

    const alertId = activated.value.alert.id;
    console.log(`    alert ${alertId}`);

    // The retry-storm scenario exists to show that five attempts produce one alert.
    if (kind === 'duplicate_activation') {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const repeat = await alert.activate(
          {
            userId: subject.userId,
            correlationId: `seed-${kind}-retry-${attempt}`,
            idempotencyKey: countdown.value.activationIdempotencyKey,
          },
          { countdownId: countdown.value.id, trigger: 'field_countdown' },
        );
        if (repeat.ok && !repeat.value.deduplicated) {
          throw new Error('Retry created a second alert. That is a bug, not a seed problem.');
        }
      }
      console.log('    four retries, all deduplicated to the same alert');
    }

    if (scenario.track.length > 0) {
      const batches = chunk(scenario.track, 25);
      for (const batch of batches) {
        await alerts.recordLocation(
          alertId,
          { userId: subject.userId, role: 'user' },
          {
            points: batch.map((point) => ({
              latitude: point.latitude,
              longitude: point.longitude,
              accuracyMetres: point.accuracyMetres,
              capturedAt: point.capturedAt.toISOString(),
            })),
          },
        );
      }
      console.log(`    ${scenario.track.length} location points`);
    }

    const drained = await dispatch.drain(50);
    console.log(`    notifications: ${drained.processed} sent, ${drained.failed} failed`);

    if (kind === 'clean_resolution') {
      const current = await alerts.get(alertId, { userId: subject.userId, role: 'user' });
      if (current.ok) {
        await alerts.resolve(
          alertId,
          { userId: subject.userId, role: 'user' },
          {
            resolution: 'issue_cleared',
            note: 'Blockage cleared, pass finished.',
            expectedVersion: current.value.version,
          },
        );
        console.log('    resolved');
      }
    }
  }

  console.log('\nDone.');
  console.log('Sign in with any account from docs/DEMO.md.');
  console.log('Passphrase: agricore-demo-passphrase');
  console.log('\nEvery name, number and coordinate above is synthetic. See PRIVACY.md.');

  await app.close();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
