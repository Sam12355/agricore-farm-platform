# Architecture

## Shape

One deployable backend, four clients, and a set of adapters chosen by configuration.

```mermaid
flowchart LR
    subgraph inward["Dependency direction"]
        direction LR
        INF["infrastructure/<br/>Nest, Express, pg, Redis, Socket.IO"] --> APP["application/<br/>services and ports"] --> DOM["domain/<br/>entities and rules"]
    end
```

`domain/` imports nothing outside itself. `application/` imports `domain` and its own port
interfaces. `infrastructure/` imports both and is the only layer that knows a database exists.

That rule is what makes the rest of it work. The domain is pure functions over immutable state, so
`alert.spec.ts` runs 33 assertions in a few milliseconds with no fixtures. The application
services take ports through the constructor, so the whole test suite binds in-memory adapters and
needs nothing installed.

## Module map

```mermaid
flowchart TB
    subgraph domain
        INC["alert<br/>activate, recordLocation, claim, release,<br/>addNote, changePriority, acknowledge, resolve"]
        CD["countdown<br/>start, cancel, canActivate"]
    end

    subgraph application
        IDS["IdentityService"]
        TCS["WorkerService"]
        SSS["FieldOperationService"]
        ATS["AlertTriggerService"]
        INS["AlertService"]
        CVS["WorkerViewService"]
        PRS["PrivacyService"]
        NDS["NotificationDispatchService"]
    end

    subgraph infrastructure
        HTTP["controllers, guards,<br/>pipes, interceptors, filter"]
        RT["RealtimeGateway"]
        PERSIST["repositories<br/>memory and postgres"]
        SEC["ScryptPasswordHasher<br/>JwtTokenService"]
        OBS["JsonLogger with redaction"]
        WORK["OutboxWorker"]
    end

    HTTP --> IDS & TCS & SSS & ATS & INS & CVS & PRS
    WORK --> NDS
    ATS --> CD
    ATS --> INC
    INS --> INC
    CVS --> INC
    IDS & TCS & SSS & ATS & INS & CVS & PRS & NDS --> PERSIST
```

## The write path that matters

Activation is the operation where being wrong is expensive in both directions, so it is worth
tracing in full.

```mermaid
sequenceDiagram
    participant C as Client
    participant I as IdempotencyInterceptor
    participant S as AlertTriggerService
    participant R as AlertRepository
    participant DB as Postgres
    participant RT as RealtimeGateway

    C->>I: POST /alerts/activate + Idempotency-Key
    I->>I: look up (key, subject, route)
    alt seen before, same body
        I-->>C: stored response, 200
    else seen before, different body
        I-->>C: 409 IDEMPOTENCY_KEY_REUSED
    else new
        I->>S: activate(...)
        S->>R: findByIdempotencyKey
        Note over S: second line of defence, for<br/>concurrent retries that both miss the store
        S->>S: countdown cancelled? then stop
        S->>S: build aggregate + worker alerts
        S->>R: create(state, events, key, outbox)
        R->>DB: BEGIN
        R->>DB: INSERT alert
        R->>DB: INSERT alert_idempotency (unique)
        R->>DB: INSERT alert_events (sequence allocated here)
        R->>DB: INSERT outbox_messages
        R->>DB: COMMIT
        S->>RT: alertCreated
        S-->>C: 201 with the alert
    end
```

Two things are load-bearing:

**The unique index on `(user_id, key)`.** Two retries arriving at the same instant both miss the
lookup. One wins the insert, the other gets a unique violation, reads back the winner's alert,
and returns the same identifier. A check-then-write without the constraint is a race.

**The single transaction.** The alert, its opening timeline events, and the outbox rows that
become worker notifications commit together. If the outbox insert fails there is no alert, and
that is the correct outcome: half an alert is worse than none, because the worker believes somebody
has been told.

## Real-time

```mermaid
sequenceDiagram
    participant CL as Console
    participant GW as Gateway
    participant DB as Event log

    CL->>GW: connect with access token
    GW->>GW: verify, pin identity to the socket
    CL->>GW: alert.subscribe
    GW->>GW: ownership check, same rule as HTTP
    GW-->>CL: joined
    Note over CL,GW: connection drops
    CL->>GW: alert.resume { lastSequence: 41 }
    GW->>DB: events where sequence > 41
    alt gap within the replay window
        GW-->>CL: alert.resumed { events, truncated: false }
    else gap too large
        GW-->>CL: alert.resumed { events: [], truncated: true }
        Note over CL: refetch the timeline instead
    end
```

Ordering is by a per-alert sequence allocated inside the writing transaction, never by a
timestamp. Device and server clocks disagree, mobile networks reorder, and a backlog flushed twenty
minutes late would otherwise render as if it happened twenty minutes late. Clients drop anything at
or below what they have already applied, which makes duplicate delivery harmless.

Authorisation happens per subscription, not only at connect. Without that, any logged-in user could
subscribe to a stranger's alert and watch their location move.

## Data

| Store | Holds | Why |
|-------|-------|-----|
| PostgreSQL | users, workers, sessions, countdowns, alerts, timeline, outbox, notifications, subscriptions, privacy, audit | Everything transactional and everything that has to be consistent |
| MongoDB | raw location pings, event snapshots | Append-only, write-heavy, never joined, expires on a TTL index. Nothing here is needed to reconstruct an alert |
| Redis | rate-limit counters, short-lived session state, distributed locks, manager presence | All of it disposable. Persistence is switched off locally on purpose |
| S3 | data exports | Large, sensitive, short-lived objects that do not belong in a database |

The timeline and the audit table both carry `DO INSTEAD NOTHING` rules for UPDATE and DELETE. An
audit trail a privileged caller can rewrite is not an audit trail, and enforcing it in the schema
means no future code path can quietly change that.

## Concurrency

Every mutable aggregate carries a `version`. Updates say `WHERE id = $1 AND version = $2`; zero rows
affected is a conflict, returned as 409 with the current version attached so the console can reload
and show what changed rather than making the manager guess.

Manager claims are leases, not locks. A five-minute expiry means a manager who closes their
laptop does not hold an alert forever, and re-claiming your own alert silently extends the
lease rather than emitting a duplicate timeline event.

## Configuration

Parsed once at startup through a Zod schema with cross-field rules. `PERSISTENCE=postgres` with no
`DATABASE_URL` refuses to boot rather than failing on the first query. Production refuses to run on
in-memory adapters. The three signing secrets must be distinct, because a shared secret would make a
worker-view link and an access token interchangeable except for a claim check.

## What I would change at ten times the scale

- Move the outbox relay out of the API process into its own task, so a slow provider cannot compete
  with request handling for the event loop
- Read replica for the manager console queue, which is read-heavy and tolerates slight staleness
- Partition `alert_events` by month; it is append-only and queried by recent range
- Move exports to a queued job with a signed, expiring download
- Redis-backed Socket.IO adapter so sockets survive more than one API task
