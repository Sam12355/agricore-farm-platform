# 0001 - Operator claim lease

**Status:** implemented
**Date:** 2026-03

## Product request

Two operators keep starting work on the same incident and finding out afterwards, and an operator who
closes their laptop leaves an incident that nobody else can pick up.

## Clarified requirement

Claiming an incident gives one operator exclusive right to act on it. That right expires if the
operator stops interacting, so an abandoned incident returns to the queue without anyone
intervening.

## Scope

**In scope:** claim, release, lease expiry, conflict response, timeline events for claim and release,
the rule that resolving as an operator requires holding the claim.

**Out of scope:** operator presence indicators, automatic assignment, workload balancing, notifying
an operator that their lease is about to lapse.

## Affected systems

| System | Change |
|--------|--------|
| `apps/api` | `domain/incident/incident.ts`: `claim`, `release`, `claimIsHeld`. `IncidentService` operator path |
| `packages/contracts` | `claimIncidentSchema`, `releaseIncidentSchema`, both carrying `expectedVersion` |
| Database | `claimed_by_operator_id`, `claimed_at`, `claim_expires_at`, a check constraint tying the first and third together |
| `apps/web` | Console shows the holder and a disabled action when held by someone else |

## Assumptions

- **Five-minute lease.** Long enough that reading a timeline does not lose you the claim, short
  enough that a genuinely abandoned incident returns quickly. No data to tune it against; it is a
  judgement call and is written down as one.
- **Re-claiming your own incident extends the lease silently.** Operators keep a tab open for a long
  time and should not lose an incident to their own idle. It emits no second timeline event, because
  a timeline full of "claimed by the same person again" is noise.
- **A lapsed lease does not notify anyone.** Out of scope, and it needs a notification channel to
  operators that does not exist yet.

## Acceptance criteria

- [x] AC1: an unclaimed open incident can be claimed, setting holder, claim time and expiry
- [x] AC2: a second operator claiming while the lease is live gets 409 naming the current holder
- [x] AC3: once the lease lapses, another operator can claim successfully
- [x] AC4: the holder re-claiming extends the expiry, keeps the original claim time, emits no event
- [x] AC5: a claim carrying a stale version is rejected with the current version attached
- [x] AC6: only the holder can release
- [x] AC7: an operator resolving without holding the claim is forbidden
- [x] AC8: resolving clears the claim
- [x] AC9: a closed incident cannot be claimed

## Security and privacy analysis

- **New data collected:** none. Operator identifiers only, which are already stored.
- **Who can see it:** the console shows the holder's identifier to other operators. Not exposed to
  the subject or to trusted contacts, because who is handling an incident is staff information.
- **Retention:** with the incident.
- **New authorisation decision:** yes. Claim and release are operator-only, and release additionally
  requires being the holder.
- **New attack surface:** an operator could hold every incident to deny work to colleagues. Bounded
  by the lease and visible in the audit log. Not worth a rate limit at this scale.
- **Threat-model entry:** T3, vertical authorisation.

## Test plan

| Level | Test | Covers |
|-------|------|--------|
| Unit | `claim` on an unclaimed incident | AC1 |
| Unit | `claim` while held by another operator | AC2 |
| Unit | `claim` after the lease lapses | AC3 |
| Unit | `claim` by the current holder | AC4 |
| Unit | `claim` with a stale version | AC5 |
| Unit | `release` by a non-holder | AC6 |
| Unit | `resolve` as an operator with no claim | AC7 |
| Unit | `resolve` by the holder | AC8 |
| Unit | `claim` on a resolved incident | AC9 |
| Integration | ordinary user attempting to claim | vertical authorisation |
| End-to-end | operator claims, notes, and the subject resolves | the whole path |

All of these exist in `src/domain/incident/incident.spec.ts` and
`test/integration/authorization.spec.ts`.

## Decomposition

1. Domain: state fields, `claimIsHeld`, `claim`, `release` with tests
2. Contracts: schemas carrying `expectedVersion`
3. Service: operator-only path and version threading
4. HTTP: routes with role requirements
5. Migration: columns and the consistency constraint
6. Console: holder display and disabled state

## Definition of Done

- [x] Acceptance criteria met
- [x] Tests written and passing, including the conflict and stale-version paths
- [x] Lint and type-check clean
- [x] Authorisation checked in the service layer, not only the route
- [x] Nothing sensitive logged
- [x] Documented in ARCHITECTURE.md under Concurrency
