# Demo

## Fastest path, nothing installed

```bash
pnpm install && pnpm build:packages && pnpm dev
```

API on `:3001`, web on `:3000`, in-memory adapters. Register an account through the portal and the
whole flow works.

## Full stack

```bash
pnpm docker:up      # Postgres, Redis, MongoDB, LocalStack, MailHog
pnpm seed           # demo accounts and five incident scenarios
pnpm dev
```

Mail the demo "sends" is readable at `http://localhost:8025`.

## Demo accounts

These are seeded, published, and guard nothing. Passphrase for all of them:
`guardianlink-demo-passphrase`

| Account | Role | Use for |
|---------|------|---------|
| `demo.user@example.com` | user | The subject: sessions, SOS, contacts, privacy |
| `demo.operator@example.com` | operator | The console: queue, claim, notes, resolve |
| `second.operator@example.com` | operator | The second console, for the conflict demo |
| `demo.admin@example.com` | admin | Audit log |

## Seeded scenarios

| Scenario | Shows |
|----------|-------|
| Clean resolution | The full path, activation to resolved, with a location track |
| Cancelled countdown | A pocket trigger cancelled in time. No incident exists |
| No acknowledgement | The primary contact never responds and the chain escalates |
| Offline backfill | A phone with no signal flushing a backlog twenty minutes late |
| Duplicate activation | Five retries of one activation producing one incident |

## Two-minute walkthrough

For someone who wants to see that it works.

1. **Portal, as `demo.user`.** Trusted contacts and privacy settings. Point out that precise location
   history is off by default.
2. **Start a safety session**, expected back in 30 minutes.
3. **Hold SOS.** Countdown starts. Cancel it. Show that no incident was created.
4. **Hold SOS again**, let it run out. The incident opens.
5. **Switch to the console** as `demo.operator`, in a second window. The incident is already there,
   no refresh. Claim it, add a note.
6. **Back in the portal**, resolve the incident. The console updates live.
7. **Timeline.** Every step, in order, with who did it. Nothing can edit it.

Total time about two minutes. The thing to notice is that nothing was polled and nothing was refreshed.

## Five-minute technical walkthrough

For someone who wants to see the engineering. Full version in
[WALKTHROUGH_TECHNICAL.md](WALKTHROUGH_TECHNICAL.md).

1. **Idempotency.** Post the same activation five times with the same `Idempotency-Key`. One incident,
   same id in every response. Then change the body under the same key and get a 409.
2. **Optimistic concurrency.** Two consoles on one incident. Both claim; the second gets 409 naming
   the holder. Advance past the lease and it succeeds.
3. **Gap replay.** Kill the socket, generate events, reconnect. The client sends its last sequence and
   gets exactly the gap.
4. **Offline backfill.** Post a location batch out of order with old capture times. The timeline keeps
   the capture times; the last known position is the newest fix, not the last one in the array.
5. **Redaction.** Watch the API logs while doing all of this. No coordinates, no email addresses, no
   tokens. Identifiers only.
6. **Deletion.** Request deletion, then run `executeDeletion`. Personal data is gone, the audit record
   of the deletion survives and contains nothing personal.

## Reproducing the recorded test output

```bash
pnpm --filter @guardianlink/api test
pnpm --filter @guardianlink/api test:e2e
pnpm --filter "./packages/**" -r test
```

Compare against [test-results/](test-results/). No external service is needed for any of it.
