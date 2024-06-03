# ADR-0001: A modular monolith, not microservices

**Status:** accepted
**Date:** 2026-02

## Context

GuardianLink has ten backend domains: identity, users, trusted contacts, safety sessions, incidents,
location, notifications, subscriptions, audit and administration. A portfolio project is under some
pressure to show a distributed architecture, because that is what "senior" is often read to mean.

## Decision

One deployable service, with hard internal boundaries enforced by layering rather than by network
calls.

## Why

Splitting this would create real problems in exchange for none that I currently have.

The activation path writes an incident, its opening timeline events and its outbox rows in a single
transaction. Across services that becomes a distributed transaction or a saga, with compensating
actions, partial-failure states, and a window where an incident exists but nobody has been notified.
The user believes help is coming during that window. That is a far worse property than anything a
monolith costs here.

There is also no operational reason. No domain has a different scaling profile, a different
deployment cadence, or a different team. Those are the reasons to split a service, and none of them
apply.

The boundaries that matter are enforced anyway: `domain/` imports nothing, `application/` imports
ports, `infrastructure/` implements them. A module can be extracted later by replacing a port
implementation with a client, and nothing above the port changes.

## Consequences

**Good.** One thing to deploy, run and debug. Transactional integrity where it matters. A local
setup that is one process. Tests that run in under a minute.

**Bad.** The whole service scales as a unit; a burst of location writes competes with everything
else for the same event loop. Acceptable at this scale, and the outbox relay is the first thing I
would extract.

**Also bad.** Nothing enforces the layering at build time. It is a review rule and a convention. A
lint rule with an import-boundary plugin would make it mechanical, and is not set up here.

## What would change this

- A team large enough that deployment coordination becomes the bottleneck
- One domain with a genuinely different scaling shape, most likely location ingestion
- A regulatory need to isolate a data domain physically
