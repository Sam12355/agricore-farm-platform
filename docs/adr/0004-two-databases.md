# ADR-0004: PostgreSQL as the source of truth, MongoDB for telemetry only

**Status:** accepted
**Date:** 2026-02

## Context

The brief asks for both PostgreSQL and MongoDB. Using two databases because a specification lists two
is resume padding. Either there is a real reason or there should be one database.

## Decision

PostgreSQL holds everything transactional and everything that has to be consistent. MongoDB holds
only raw location telemetry and event snapshots, on a TTL index. Nothing in Mongo is needed to
reconstruct an alert's state.

## Why

The location stream has a genuinely different shape from the rest of the data. It is append-only,
write-heavy in bursts when an offline client flushes a backlog, never joined against anything,
queried only as "all points for this alert in time order", and it expires on a schedule.

That is a document-store fit rather than a relational one. The TTL index is the part that matters
most: expiry is enforced by the database rather than by a job that might not run. For the most
sensitive data the product holds, that is worth something on its own.

Everything else is relational and needs transactions. Alert, timeline and outbox rows commit
together or not at all. Ownership is a foreign key. The audit table needs rules rejecting UPDATE and
DELETE. None of that belongs in a document store.

The boundary sits where it does because of one rule: **if Mongo is unavailable, alerts still
work.** The subject's last known position lives on the alert row in Postgres. Losing Mongo costs
the detailed track on the manager's map. It does not cost the alert, the timeline, the
notifications or the audit trail.

## Consequences

**Good.** Each store does what it is good at. Retention on the most sensitive data is enforced by the
engine. Telemetry write bursts do not compete with transactional writes.

**Bad.** Two datastores to run, back up, monitor and reason about. In production DocumentDB costs
real money to leave running, which is why the local stack uses a MongoDB container and the port is
written so either can back it.

**Also bad.** A reviewer has to be told why both exist, or it looks like padding. Hence this record.

## What would change this

If telemetry volume stayed low, Postgres with a partitioned table and a scheduled delete would be
simpler, and I would drop Mongo without hesitation.
