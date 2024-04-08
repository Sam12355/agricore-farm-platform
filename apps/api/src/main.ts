import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ConfigurationError, corsOrigins, loadConfig } from './config/configuration';
import { PORTS } from './application/tokens';
import type { StructuredLogger } from './application/ports';
import { OutboxWorker } from './infrastructure/workers/outbox.worker';

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      // Fail loudly and specifically. Starting with half a configuration and finding out
      // at the first request is worse than not starting.
      process.stderr.write(`${error.message}\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const app = await NestFactory.create(AppModule.forConfig(config), { bufferLogs: true });
  const logger = app.get<StructuredLogger>(PORTS.Logger);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      // The API returns JSON and never renders HTML, so a strict referrer policy costs
      // nothing and keeps identifiers out of Referer headers on any link that does render.
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.enableCors({
    origin: corsOrigins(config),
    credentials: true,
    // Idempotency-Key and the correlation header have to be allowed explicitly or the
    // browser preflight strips them and the mobile-parity behaviour silently differs.
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'Retry-After', 'X-RateLimit-Remaining', 'Idempotency-Replayed'],
  });

  // Draining connections before the process exits is what turns a deploy from "some
  // requests get a connection reset" into a non-event.
  app.enableShutdownHooks();

  if (config.ENABLE_BACKGROUND_WORKERS) {
    app.get(OutboxWorker).start(config.OUTBOX_POLL_INTERVAL_MS);
  }

  await app.listen(config.PORT);

  logger.info('guardianlink api listening', {
    port: config.PORT,
    environment: config.NODE_ENV,
    persistence: config.PERSISTENCE,
    notificationTransport: config.NOTIFICATION_TRANSPORT,
  });
  logger.warn('this is a portfolio demonstration and does not contact emergency services');
}

void bootstrap();
