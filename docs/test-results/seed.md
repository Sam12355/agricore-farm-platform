# Recorded seed run

Command: `pnpm seed` (ts-node src/seed/seed.ts), in-memory adapters
Run at: 2026-07-31T09:26:47Z

The duplicate_activation scenario throws if a retry ever produces a second alert,
so this output is itself a check that the deduplication holds.

```console
Seeding demo accounts
  demo.user@example.com (user)
  demo.manager@example.com (manager)
  second.manager@example.com (manager)
  demo.admin@example.com (admin)

Seeding scenarios

  clean_resolution: Spraying pass, alert raised in the block, resolved
    alert 875dec70-d606-477b-8fce-80ab2027f75e
    24 location points
    notifications: 2 sent, 0 failed
    resolved

  cancelled_countdown: Accidental trigger, cancelled during the countdown
    cancelled: true. No alert created, which is the point.

  no_acknowledgement_escalation: Primary worker does not answer
    alert bfcd54ce-744d-4afa-ba81-585d5dc4bd51
    18 location points
    notifications: 3 sent, 0 failed

  offline_backfill: No signal in the far block, events queued, flushed on reconnect
    alert 8c23693c-2afd-4dca-ba50-28d61011f30b
    30 location points
    notifications: 3 sent, 0 failed

  duplicate_activation: Retry storm on a flaky connection
    alert 5268c789-5bc0-4c97-9874-f21feff995c1
    four retries, all deduplicated to the same alert
    6 location points
    notifications: 3 sent, 0 failed

Done.
Sign in with any account from docs/DEMO.md.
Passphrase: agricore-demo-passphrase

Every name, number and coordinate above is synthetic. See PRIVACY.md.
```

Re-recorded after the domain rename, for the reason given in [api.md](api.md).
