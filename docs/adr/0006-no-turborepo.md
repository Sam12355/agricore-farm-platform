# ADR-0006: pnpm workspaces without Turborepo

**Status:** accepted
**Date:** 2026-02

## Context

The brief allows a monorepo tool such as Turborepo where it adds clear value.

## Decision

pnpm workspaces alone. `pnpm -r` already runs scripts in topological order across packages, which is
the feature that actually matters here.

## Why

Turborepo earns its place through remote caching and fine-grained task-graph parallelism. Both pay
off when a full build takes long enough to hurt. Here `pnpm build:packages` takes a few seconds and
the entire test suite runs in about a minute.

Against that it adds a downloaded native binary to the toolchain, a `turbo.json` to keep in sync with
the package scripts, and one more thing a reviewer has to understand before they can run anything.
For a repository whose main quality is that it clones and runs, that is a poor trade.

## Consequences

**Good.** Fewer moving parts. `pnpm install && pnpm verify` is the whole story. No cache to go stale
and no cache-invalidation bug to debug.

**Bad.** No remote caching, so CI rebuilds everything each run. At this size that costs seconds.

**Also bad.** Task parallelism is coarser: dependency order across packages, not a fine-grained graph
across individual tasks.

## What would change this

CI wall time becoming a real cost, or enough packages that dependency-ordered builds start to hurt.
Adding Turborepo later is additive and touches no application code.
