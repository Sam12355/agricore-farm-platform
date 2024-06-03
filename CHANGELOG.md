# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[semantic](https://semver.org/).

## [Unreleased]

### Added
- Contact verification flow, so a notification cannot be sent to an unconfirmed address
- Queued data export with a signed, expiring download link
- Per-user retention sweeps rather than the single global floor

## [0.1.0] - 2026-03

First complete vertical slice: SOS activation through to resolution, across mobile, backend,
real-time and the operator console.

### Added

**Backend**
- NestJS modular monolith on ports and adapters; every port has an in-memory adapter, so the whole
  test suite runs with no external services
- Identity: registration, login, refresh-token rotation with family-wide revocation on reuse
- Trusted contacts with entitlement-based limits enforced server side
- Safety sessions with overdue detection
- SOS countdown, cancellation, and idempotent activation
- Incident aggregate: location recording, operator claim leases, notes, priority, contact
  acknowledgement, resolution
- Append-only incident timeline with per-incident monotonic sequencing
- Transactional outbox with dedupe keys, retry with jittered backoff, and dead-lettering
- Socket.IO gateway with per-subscription authorisation and gap replay on reconnect
- Privacy: settings with enforced retention bounds, full data export, two-step deletion with a grace
  period
- Structured JSON logging with PII redaction at any nesting depth
- Versioned REST, correlation ids, health and readiness endpoints, graceful shutdown

**Shared packages**
- `contracts`: Zod schemas as the single source of truth for the API surface
- `shared-types`: Result, branded ids, Clock, geo primitives, cursor pagination
- `design-tokens`: tokens plus generators for CSS custom properties, Swift and Kotlin
- `test-fixtures`: deterministic synthetic data constrained to reserved ranges

**Infrastructure**
- Docker Compose stack: Postgres, Redis, MongoDB, LocalStack, MailHog
- Multi-stage Dockerfile, non-root, with a liveness healthcheck
- Terraform for ECS Fargate, RDS, ElastiCache, SQS, S3, CloudWatch
- GitHub Actions: lint, type-check, tests, browser journeys, container build, Terraform validate,
  dependency audit, secret scan, Android build, iOS build

**Quality**
- 256 automated tests, none requiring an external service
- WCAG AA contrast enforced by a test over every colour pair the product actually uses
- PII redaction enforced by tests against the emitted log line

### Fixed during development

Recorded because a changelog that only lists features is not a record of the work.

- **Border contrast.** `#9aa5b4` for emphasised borders scores 2.5 against white and fails the 3:1
  non-text minimum. Caught by `contrast.spec.ts`, darkened to `#6b7684`. Not something anyone would
  have noticed by looking.
- **Mixed clocks in the idempotency store.** The in-memory store checked expiry with `Date.now()`
  while records were written with the injected clock, so under a `FixedClock` every record looked
  expired the moment it was written and the duplicate-request test saw a `201` instead of a `409`.
  The store now takes a `Clock` and is provided through a factory.
- **`@UsePipes` on route handlers.** It applies the pipe to every parameter, including ones from
  custom decorators, so the schema ran against a bare correlation-id string and every request failed
  validation. Pipes are now bound to `@Body`.
- **Non-UUID identifiers in the test generator.** The sequential generator emitted `id-0001`, which
  failed the `uuid()` validation in the contracts and produced a `400` unrelated to what was under
  test. It now emits UUID-shaped values.

### Known limitations

Full list in the README. The important ones: iOS was never compiled, Terraform was never validated
locally or applied, contact verification is not implemented, and no screenshots have been captured.
