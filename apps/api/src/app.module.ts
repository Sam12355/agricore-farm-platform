import { type MiddlewareConsumer, Module, type NestModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';
import { join } from 'node:path';

import { SystemClock, type Clock } from '@guardianlink/shared-types';

import { ContactViewService } from './application/services/contact-view.service';
import { IdentityService } from './application/services/identity.service';
import { IncidentService } from './application/services/incident.service';
import { NotificationDispatchService } from './application/services/notification-dispatch.service';
import { PrivacyService } from './application/services/privacy.service';
import { SafetySessionService } from './application/services/safety-session.service';
import { SosService } from './application/services/sos.service';
import { SubscriptionService } from './application/services/subscription.service';
import { TrustedContactService } from './application/services/trusted-contact.service';
import { PORTS } from './application/tokens';
import { loadConfig, type AppConfig } from './config/configuration';
import { AdminController, SubscriptionController } from './infrastructure/http/controllers/admin.controller';
import { AuthController } from './infrastructure/http/controllers/auth.controller';
import {
  ContactViewController,
  OpsController,
} from './infrastructure/http/controllers/public.controller';
import { IncidentController } from './infrastructure/http/controllers/incident.controller';
import { SosController } from './infrastructure/http/controllers/sos.controller';
import {
  PrivacyController,
  SafetySessionController,
  TrustedContactController,
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
  MemoryIncidentRepository,
  MemoryLocationTelemetryRepository,
  MemoryNotificationRepository,
  MemoryOutboxRepository,
  MemoryPrivacySettingsRepository,
  MemoryRefreshTokenRepository,
  MemorySafetySessionRepository,
  MemorySubscriptionRepository,
  MemoryTrustedContactRepository,
  MemoryUserRepository,
} from './infrastructure/persistence/memory/memory-repositories';
import { GraphQlEventBridge, IncidentResolver, PUB_SUB } from './infrastructure/graphql/incident.resolver';
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
  const incidents = new MemoryIncidentRepository(outbox);

  return [
    { provide: APP_CONFIG, useValue: config },
    { provide: PORTS.Logger, useValue: logger },
    { provide: PORTS.Clock, useValue: new SystemClock() satisfies Clock },
    { provide: PORTS.IdGenerator, useValue: new UuidGenerator() },

    { provide: PORTS.UserRepository, useValue: new MemoryUserRepository() },
    { provide: PORTS.RefreshTokenRepository, useValue: new MemoryRefreshTokenRepository() },
    { provide: PORTS.TrustedContactRepository, useValue: new MemoryTrustedContactRepository() },
    { provide: PORTS.SafetySessionRepository, useValue: new MemorySafetySessionRepository() },
    { provide: PORTS.CountdownRepository, useValue: new MemoryCountdownRepository() },
    { provide: PORTS.IncidentRepository, useValue: incidents },
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
        contactViewSecret: config.JWT_CONTACT_VIEW_SECRET,
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
    IncidentResolver,

    IdentityService,
    TrustedContactService,
    SafetySessionService,
    SosService,
    IncidentService,
    ContactViewService,
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
        TrustedContactController,
        SafetySessionController,
        SosController,
        IncidentController,
        ContactViewController,
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
