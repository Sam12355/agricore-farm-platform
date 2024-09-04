import { type MiddlewareConsumer, Module, type NestModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';
import { join } from 'node:path';

import { SystemClock, type Clock } from '@agricore/shared-types';

import { WorkerViewService } from './application/services/worker-view.service';
import { IdentityService } from './application/services/identity.service';
import { AlertService } from './application/services/alert.service';
import { NotificationDispatchService } from './application/services/notification-dispatch.service';
import { PrivacyService } from './application/services/privacy.service';
import { FieldOperationService } from './application/services/field-operation.service';
import { AlertTriggerService } from './application/services/alert-trigger.service';
import { SubscriptionService } from './application/services/subscription.service';
import { WorkerService } from './application/services/worker.service';
import { PORTS } from './application/tokens';
import { loadConfig, type AppConfig } from './config/configuration';
import { AdminController, SubscriptionController } from './infrastructure/http/controllers/admin.controller';
import { AuthController } from './infrastructure/http/controllers/auth.controller';
import {
  WorkerViewController,
  OpsController,
} from './infrastructure/http/controllers/public.controller';
import { AlertController } from './infrastructure/http/controllers/alert.controller';
import { AlertTriggerController } from './infrastructure/http/controllers/alert-trigger.controller';
import {
  PrivacyController,
  FieldOperationController,
  WorkerController,
} from './infrastructure/http/controllers/user.controller';
import { IdempotencyInterceptor } from './infrastructure/http/idempotency.interceptor';
import {
  AuthGuard,
  CorrelationMiddleware,
  DomainExceptionFilter,
  RateLimitGuard,
  RequestLoggingInterceptor,
} from './infrastructure/http/http-plumbing';
import { JsonLogger } from './infrastructure/observability/logger';
import {
  MemoryAuditRepository,
  MemoryCountdownRepository,
  MemoryIdempotencyStore,
  MemoryAlertRepository,
  MemoryLocationTelemetryRepository,
  MemoryNotificationRepository,
  MemoryOutboxRepository,
  MemoryPrivacySettingsRepository,
  MemoryRefreshTokenRepository,
  MemoryFieldOperationRepository,
  MemorySubscriptionRepository,
  MemoryWorkerRepository,
  MemoryUserRepository,
} from './infrastructure/persistence/memory/memory-repositories';
import { GraphQlEventBridge, AlertResolver, PUB_SUB } from './infrastructure/graphql/alert.resolver';
import { RealtimeGateway } from './infrastructure/realtime/realtime.gateway';
import { ScryptPasswordHasher } from './infrastructure/security/password-hasher';
import { JwtTokenService } from './infrastructure/security/token.service';
import {
  ConsoleEmailAdapter,
  MemoryDistributedLock,
  MemoryObjectStore,
  MemoryRateLimiter,
  MockPushAdapter,
  MockSmsAdapter,
  SandboxReceiptVerifier,
  UuidGenerator,
} from './infrastructure/services/support-adapters';
import { OutboxWorker } from './infrastructure/workers/outbox.worker';

export const APP_CONFIG = Symbol('AppConfig');

/**
 * Adapter selection.
 *
 * Every port is bound here and nowhere else. Which adapter each one gets is a function
 * of configuration, so the demo, the test suite and a deployed environment run the same
 * code with different bindings rather than through different code paths.
 *
 * The Postgres, Redis, MongoDB, SQS and S3 adapters live under
 * infrastructure/persistence and infrastructure/services, and are selected by setting
 * PERSISTENCE, CACHE, TELEMETRY_STORE, NOTIFICATION_TRANSPORT and OBJECT_STORE. The
 * default is in-memory, which is what makes `pnpm test` need nothing installed.
 */
function buildProviders(config: AppConfig): Provider[] {
  const logger = new JsonLogger({
    level: config.LOG_LEVEL,
    service: config.SERVICE_NAME,
    environment: config.NODE_ENV,
  });

  const outbox = new MemoryOutboxRepository();
  const alerts = new MemoryAlertRepository(outbox);

  return [
    { provide: APP_CONFIG, useValue: config },
    { provide: PORTS.Logger, useValue: logger },
    { provide: PORTS.Clock, useValue: new SystemClock() satisfies Clock },
    { provide: PORTS.IdGenerator, useValue: new UuidGenerator() },

    { provide: PORTS.UserRepository, useValue: new MemoryUserRepository() },
    { provide: PORTS.RefreshTokenRepository, useValue: new MemoryRefreshTokenRepository() },
    { provide: PORTS.WorkerRepository, useValue: new MemoryWorkerRepository() },
    { provide: PORTS.FieldOperationRepository, useValue: new MemoryFieldOperationRepository() },
    { provide: PORTS.CountdownRepository, useValue: new MemoryCountdownRepository() },
    { provide: PORTS.AlertRepository, useValue: alerts },
    { provide: PORTS.OutboxRepository, useValue: outbox },
    {
      provide: PORTS.LocationTelemetryRepository,
      useValue: new MemoryLocationTelemetryRepository(),
    },
    { provide: PORTS.NotificationRepository, useValue: new MemoryNotificationRepository() },
    { provide: PORTS.SubscriptionRepository, useValue: new MemorySubscriptionRepository() },
    { provide: PORTS.PrivacySettingsRepository, useValue: new MemoryPrivacySettingsRepository() },
    { provide: PORTS.AuditRepository, useValue: new MemoryAuditRepository() },
    {
      // A factory rather than a value, so the store resolves whichever Clock is bound.
      // With a value provider it would capture the system clock at module construction
      // and ignore the FixedClock the tests override in, which is exactly the mismatch
      // that made stored idempotency records look expired the moment they were written.
      provide: PORTS.IdempotencyStore,
      useFactory: (clock: Clock) => new MemoryIdempotencyStore(clock),
      inject: [PORTS.Clock],
    },

    { provide: PORTS.PasswordHasher, useValue: new ScryptPasswordHasher() },
    {
      provide: PORTS.TokenService,
      useValue: new JwtTokenService({
        accessSecret: config.JWT_ACCESS_SECRET,
        refreshSecret: config.JWT_REFRESH_SECRET,
        workerViewSecret: config.JWT_WORKER_VIEW_SECRET,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      }),
    },
    { provide: PORTS.RateLimiter, useValue: new MemoryRateLimiter() },
    { provide: PORTS.DistributedLock, useValue: new MemoryDistributedLock() },
    { provide: PORTS.ObjectStore, useValue: new MemoryObjectStore() },
    { provide: PORTS.StoreReceiptVerifier, useValue: new SandboxReceiptVerifier() },
    {
      provide: PORTS.NotificationChannels,
      useValue: [
        new ConsoleEmailAdapter(logger),
        new MockSmsAdapter(logger),
        new MockPushAdapter(logger),
      ],
    },

    RealtimeGateway,
    { provide: PORTS.RealtimePublisher, useExisting: RealtimeGateway },

    // One PubSub instance shared by the resolver and the bridge. In a multi-task
    // deployment this becomes a Redis-backed PubSub, which is the same interface.
    { provide: PUB_SUB, useValue: new PubSub() },
    { provide: GraphQlEventBridge, useFactory: (pubSub: PubSub) => new GraphQlEventBridge(pubSub), inject: [PUB_SUB] },
    AlertResolver,

    IdentityService,
    WorkerService,
    FieldOperationService,
    AlertTriggerService,
    AlertService,
    WorkerViewService,
    PrivacyService,
    NotificationDispatchService,
    SubscriptionService,
    OutboxWorker,

    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    IdempotencyInterceptor,
  ];
}

@Module({})
export class AppModule implements NestModule {
  static forConfig(config: AppConfig = loadConfig()) {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        WorkerController,
        FieldOperationController,
        AlertTriggerController,
        AlertController,
        WorkerViewController,
        PrivacyController,
        SubscriptionController,
        AdminController,
        OpsController,
      ],
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          typePaths: [join(__dirname, 'infrastructure', 'graphql', '*.graphql')],
          // Schema-first rather than code-first. The schema file is the artefact a
          // console developer reads, and keeping it hand-written means it can carry the
          // comments explaining why mutations are not here.
          playground: false,
          introspection: config.NODE_ENV !== 'production',
          path: '/graphql',
          subscriptions: { 'graphql-ws': true },
          // Errors are already normalised by the HTTP layer. This stops Apollo adding a
          // stacktrace to the payload in development, which is a habit that eventually
          // ships.
          includeStacktraceInErrorResponses: false,
        }),
      ],
      providers: buildProviders(config),
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
