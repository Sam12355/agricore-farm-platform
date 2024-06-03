# Recorded seed run

Command: `pnpm seed` (ts-node src/seed/seed.ts), in-memory adapters
Run at: 2026-07-31T04:52:38Z

The duplicate_activation scenario throws if a retry ever produces a second incident,
so this output is itself a check that the deduplication holds.

```console
Seeding demo accounts
  demo.user@example.com (user)
  demo.operator@example.com (operator)
  second.operator@example.com (operator)
  demo.admin@example.com (admin)

Seeding scenarios

  clean_resolution: Walk home, alert raised, resolved safely
    incident 3038fd71-ff85-427d-b418-ae726669a45a
    24 location points
    notifications: 2 sent, 0 failed
    resolved

  cancelled_countdown: Accidental trigger, cancelled during the countdown
    cancelled: true. No incident created, which is the point.

  no_acknowledgement_escalation: Primary contact does not answer
    incident 5ab38003-ff19-431d-b6e7-064a06ac38ab
    18 location points
    notifications: 3 sent, 0 failed

  offline_backfill: Phone loses signal, queues events, flushes on reconnect
    incident bcda76c6-0797-44b5-bc87-191f9be6261c
    30 location points
    notifications: 3 sent, 0 failed

  duplicate_activation: Retry storm on a flaky connection
    incident 78ffdf46-2bb2-4823-b595-16c9a1d906e2
    four retries, all deduplicated to the same incident
    6 location points
    notifications: 3 sent, 0 failed

Done.
Sign in with any account from docs/DEMO.md.
Passphrase: guardianlink-demo-passphrase

Every name, number and coordinate above is synthetic. See PRIVACY.md.
```
