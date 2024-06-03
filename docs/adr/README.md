# Architecture decision records

One file per decision that was expensive to make or would be expensive to reverse. The format is
context, decision, why, consequences. The consequences section is the point: a record that only lists
benefits is marketing, not a decision record.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-modular-monolith.md) | A modular monolith, not microservices | accepted |
| [0002](0002-ports-and-adapters.md) | Ports and adapters, in-memory adapter for every port | accepted |
| [0003](0003-password-hashing.md) | scrypt rather than Argon2id | accepted |
| [0004](0004-two-databases.md) | Postgres as source of truth, Mongo for telemetry only | accepted |
| [0005](0005-realtime-ordering.md) | Sequence numbers, not timestamps, for ordering | accepted |
| [0006](0006-no-turborepo.md) | pnpm workspaces without Turborepo | accepted |

## When to write one

If someone six months from now would reasonably ask "why on earth is it done this way", write one.
If the answer is "that is just the obvious way", do not.

Superseding is done by adding a new record that says what it replaces, not by editing the old one.
The history of a decision is part of the decision.
