# ADR-0005: Sequence numbers, not timestamps, for real-time ordering

**Status:** accepted
**Date:** 2026-02

## Context

Two operator consoles and a mobile client all watch the same incident. Events arrive over a socket
that drops, on networks that reorder, from devices whose clocks are wrong.

## Decision

Every incident event carries a monotonic per-incident sequence number allocated inside the writing
transaction. Clients order by sequence, track the highest they have applied, and send it on reconnect
so the server replays exactly the gap.

## Why

Timestamps do not work, for three independent reasons, any one of which is enough.

**Device clocks are wrong.** A phone that has been offline can be minutes out. Ordering by
`occurredAt` puts events in an order that never happened.

**Server timestamps lack resolution.** Two events written in the same millisecond have no defined
order, and the operator sees "resolved" before "note added".

**Neither tells a reconnecting client what it missed.** With a timestamp the client asks for
everything since a time and gets duplicates, or asks since the last one it saw and races the clock.
With a sequence it says "I have up to 41" and the answer is exact.

Allocation has to happen inside the writing transaction, not in application code. If the application
picked the number, two concurrent writers could both choose 7 and the timeline would fork. Postgres
does this with a per-incident sequence and a unique constraint on `(incident_id, sequence)`; the
in-memory adapter does the same in a single synchronous block.

Both fields are kept. `occurredAt` is what the client reports and what gets displayed; `sequence` is
what everything orders by. A backlog flushed twenty minutes late therefore shows the times things
actually happened while still slotting into the timeline correctly.

## Consequences

**Good.** Ordering is exact and clock-independent. Gap recovery is precise. Duplicate delivery is
harmless because a client drops anything at or below what it has applied. History can be replayed
from the event log to reconstruct any past state.

**Bad.** A sequence per incident is a hot row under concurrent writes to one incident. Fine here,
where a busy incident sees a handful of writes a second.

**Also bad.** A client that misses more than the replay window has to refetch. The response says
`truncated: true` rather than silently sending a partial stream, but the client has to handle it.
