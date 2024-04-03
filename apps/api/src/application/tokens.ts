/**
 * Injection tokens.
 *
 * TypeScript interfaces do not survive to runtime, so Nest cannot use them as DI keys.
 * These symbols are the bridge. Every one of them names a port from application/ports,
 * and the binding to a concrete adapter happens once, in infrastructure.module.ts, based
 * on configuration. Nothing else in the codebase knows which adapter is in play.
 */
export const PORTS = {
  Clock: Symbol('Clock'),
  IdGenerator: Symbol('IdGenerator'),
  Logger: Symbol('StructuredLogger'),

  UserRepository: Symbol('UserRepository'),
  RefreshTokenRepository: Symbol('RefreshTokenRepository'),
  TrustedContactRepository: Symbol('TrustedContactRepository'),
  SafetySessionRepository: Symbol('SafetySessionRepository'),
  CountdownRepository: Symbol('CountdownRepository'),
  IncidentRepository: Symbol('IncidentRepository'),
  LocationTelemetryRepository: Symbol('LocationTelemetryRepository'),
  OutboxRepository: Symbol('OutboxRepository'),
  NotificationRepository: Symbol('NotificationRepository'),
  SubscriptionRepository: Symbol('SubscriptionRepository'),
  PrivacySettingsRepository: Symbol('PrivacySettingsRepository'),
  AuditRepository: Symbol('AuditRepository'),
  IdempotencyStore: Symbol('IdempotencyStore'),

  PasswordHasher: Symbol('PasswordHasher'),
  TokenService: Symbol('TokenService'),
  RateLimiter: Symbol('RateLimiter'),
  DistributedLock: Symbol('DistributedLock'),
  RealtimePublisher: Symbol('RealtimePublisher'),
  StoreReceiptVerifier: Symbol('StoreReceiptVerifier'),
  ObjectStore: Symbol('ObjectStore'),
  NotificationChannels: Symbol('NotificationChannelAdapters'),
} as const;
