# ADR-0002: Ports and adapters, with an in-memory adapter for every port

**Status:** accepted
**Date:** 2026-02

## Context

The test suite needs to be worth running. A reviewer with ten minutes will not stand up Postgres,
Redis, MongoDB and LocalStack before deciding whether to keep reading, and neither will a developer
on a train.

## Decision

Every external dependency is reached through an interface owned by the application layer. Each one
has at least two implementations: the real adapter and an in-memory adapter upholding the same
guarantees.

## Why

The alternatives all fail somewhere I care about.

Mocking at the call site produces tests that assert the code called a method, which passes happily
while the method does the wrong thing. Testcontainers gives real fidelity but needs Docker running,
takes tens of seconds to start, and turns a two-minute review into a fifteen-minute one. A shared
test database is faster but couples every test to every other test's leftovers.

An in-memory adapter that genuinely implements the contract sits in a better place: fast, isolated,
deterministic, and honest about behaviour. The memory repositories here enforce optimistic version
checks, allocate event sequences atomically, reject duplicate idempotency keys and paginate by
cursor, because the real ones do.

The payoff turned out larger than expected. Because the notification transport is a port, the local
stack runs an in-process worker instead of SQS with no conditional code anywhere above it. The demo
runs the production code path with different bindings, rather than a separate demo mode that can
silently drift.

## Consequences

**Good.** 256 tests run in about a minute with nothing installed. Adapter selection is configuration.
Domain logic is testable with no harness at all.

**Bad.** Two implementations to keep in step. If the memory adapter is more forgiving than Postgres,
tests pass and production does not. Mitigated by making the memory adapter enforce the same
constraints, but it is a real ongoing cost. The honest answer is that it wants a contract-test suite
run against both implementations, and that is not written yet.

**Also bad.** More indirection. A reader following a call has to know where the binding happens. One
file, `app.module.ts`, which is the mitigation.
