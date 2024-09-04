# Technical walkthrough

Five things worth showing someone who reads code for a living. Each one names the file, so you can go
and check rather than take my word for it.

## 1. One activation, however many retries

**Where:** `src/application/services/alert-trigger.service.ts`,
`src/infrastructure/http/idempotency.interceptor.ts`, `migrations/0001_initial_schema.sql`

A phone on a bad connection retries. Sometimes it retries a request that succeeded and whose response
was lost coming back. Without deduplication that is five alerts to every worker on the farm for one event.

Three layers, because each one covers a case the others do not:

1. **The key is minted when the countdown starts**, not when the activation fires. A client that
   crashes mid-countdown and retries after restarting still deduplicates.
2. **The HTTP interceptor** stores the response against `(key, subject, route)` and replays it. Same
   key with a different body is a `409`, never a silent success: that combination is always a client
   bug and hiding it makes it harder to find.
3. **A unique index on `(user_id, key)`** in the same transaction as the alert. Two retries
   arriving simultaneously both miss the lookup; one wins the insert, the other catches the unique
   violation, reads back the winner and returns the same id. A check-then-write without the
   constraint is a race, and it is the race that actually happens under load.

**Test:** `test/e2e/alert-workflow.e2e.spec.ts`, "creates exactly one alert no matter how many times
the client retries".

## 2. The write that must not tear

**Where:** `AlertRepository.create`

The alert, its opening timeline events, and the outbox rows that become worker notifications
commit in one transaction. If the outbox insert fails, no alert exists.

That is the right way round. A worker who raised an alert believes somebody has been told. An alert with no
notifications queued is worse than no alert at all, because it produces confidence with nothing
behind it.

The outbox relay then polls with `FOR UPDATE SKIP LOCKED`, so several workers drain in parallel
without blocking each other or delivering the same message twice.

## 3. Ordering that survives wrong clocks

**Where:** `src/infrastructure/realtime/realtime.gateway.ts`,
[ADR-0005](adr/0005-realtime-ordering.md)

Device clocks are wrong. Mobile networks reorder. Sockets drop.

Every event carries a per-alert sequence allocated inside the writing transaction. Clients order
by it, and drop anything at or below what they have already applied, so a duplicate after reconnect
is harmless. On reconnect the client sends its last sequence and the server replays exactly the gap.
Past the replay window the response says `truncated: true` and the client refetches rather than
stitching a partial stream together.

Both fields are kept: `occurredAt` for display, `sequence` for ordering. That is why a backlog flushed
twenty minutes late shows the times things actually happened and still sorts correctly.

**Test:** the offline-backfill case in `alert-workflow.e2e.spec.ts` asserts the timeline holds the
original capture times while the last known position is the newest fix, not the last array element.

## 4. Authorisation in two places, on purpose

**Where:** `src/infrastructure/http/http-plumbing.ts` (guard),
`src/application/services/alert.service.ts` (`authorise`)

The guard answers "are you authenticated, and could your role possibly do this". Only the service can
answer "is this particular record yours", because only the service loads it.

Both are required. A route-level check alone is exactly how "any logged-in user can read any alert
by guessing an id" happens, and it looks protected in the code while not being protected at all.

Two details worth noticing:

- Another user's resource returns **404, not 403**. A 403 confirms the id exists, which is an
  enumeration oracle.
- The socket gateway runs the same ownership rule **per subscription**, not only at connect.
  Otherwise any logged-in user could subscribe to a stranger's alert and watch their location move.

**Test:** `test/integration/authorization.spec.ts` has one test per operation, cross-user. Not one
test called "authorisation works", because that is how the gap on the eleventh endpoint survives.

## 5. Deletion that cannot erase the audit trail

**Where:** `src/application/services/privacy.service.ts`, `executeDeletion`

Deleting an account removes everything the user contributed. It anonymises the user row rather than
removing it, and keeps audit records.

That is deliberate. Audit records exist so privileged actions stay answerable, and a manager who
viewed someone's location should not be able to erase that by getting the account closed. What
survives is "a manager viewed an alert belonging to user 41f9" and never a name, an address, a
phone number or a coordinate. The schema backs it up: `audit_records` has no cascade delete and
carries `DO INSTEAD NOTHING` rules on UPDATE and DELETE.

**Test:** `authorization.spec.ts`, "removes personal data on execution but keeps the audit record of
the deletion", which asserts both halves.

## Where to look if you have five more minutes

| Interest | File |
|----------|------|
| Pure domain rules, no framework | `src/domain/alert/alert.ts` |
| How every port is bound from configuration | `src/app.module.ts` |
| PII redaction, and its tests | `src/infrastructure/observability/logger.ts` |
| Config that refuses to boot when it is wrong | `src/config/configuration.ts` |
| Schema constraints doing real work | `migrations/0001_initial_schema.sql` |
| Contrast enforced by a failing build | `packages/design-tokens/src/contrast.spec.ts` |
