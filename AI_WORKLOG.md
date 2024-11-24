# AI assistance log

Where an AI coding assistant was used on this repository, what came back, what was rejected, and
what broke. The rejections and the failures are the useful part; a log with none of either means
nobody was reviewing.

Assistance was used for bounded, well-specified pieces of work: a state machine described by an
existing specification, repetitive adapter implementations, exhaustive test matrices over
enumerated cases, and one published algorithm. The architecture, the port boundaries, the
concurrency design and every decision recorded in `docs/adr/` were not among them. Each entry below
says what was asked for and what had to be corrected before it was accepted.

---

## Entry 1 - Alert aggregate

**Where assistance was used:** drafting the alert state machine from
`docs/specs/0001-manager-claim-lease.md` as pure functions over immutable state, no I/O.

**Context given:** the spec, `shared-types` for `Result` and the enums, and the rule that the domain
imports nothing.

**What came back:** transitions for activate, recordLocation, claim, release, addNote,
changePriority, acknowledge and resolve, each returning `Result<Transition, DomainError>`.

**Rejected:**

- The first version had the aggregate assigning event sequence numbers. That is wrong: two concurrent
  writers can both choose 7 and the timeline forks. Sequence allocation belongs to the repository,
  inside the writing transaction. Rewritten so the aggregate emits `PendingAlertEvent` with no id
  and no sequence, and the store assigns both.
- `recordLocation` replaced `lastKnownLocation` with the final element of the array. A flushed
  offline queue is not sorted, so a stale point could overwrite a newer one. Changed to take the
  newest by capture time and only replace if it is genuinely newer.

**Corrected by hand:** `acknowledge` returned a conflict on a second call. An assigned worker will tap
that link twice, from two devices, halfway through a night shift. Made it idempotent: the second call is
accepted and changes nothing.

**Tests failed:** none initially, because the first test file was written to match the implementation
rather than the criteria. That is itself the finding. The tests were rewritten from the acceptance
criteria first, and the two issues above surfaced immediately.

**Verified:** `pnpm --filter @agricore/api test:unit`, 33 tests in `alert.spec.ts`.

---

## Entry 2 - Validation pipes on controllers

**Where assistance was used:** wiring the Zod schemas from `packages/contracts` into the Nest
controllers, a mechanical change across six files.

**What came back:** `@UsePipes(new ZodValidationPipe(schema))` on each handler.

**What broke:** every end-to-end test failed with `400 VALIDATION_FAILED`. `@UsePipes` applies the
pipe to **every** handler parameter, including the ones produced by custom decorators like
`@CorrelationId`. The schema was being run against a bare correlation-id string.

**Diagnosis:** the error body named the failing field, which pointed straight at a parameter that
should never have been validated at all.

**Fix:** bind the pipe to the parameter it validates, `@Body(new ZodValidationPipe(schema))`. Applied
across every controller. A comment in `auth.controller.ts` records why, because the `@UsePipes` form
reads as the more idiomatic one and someone will reach for it again.

**Verified:** e2e suite back to green, 7 tests.

---

## Entry 3 - In-memory idempotency store

**Where assistance was used:** an in-memory implementation of the `IdempotencyStore` port, written
against an interface that already existed.

**What came back:** a Map with a TTL check.

**What broke:** the duplicate-key test expected `409` and got `201`. The store checked expiry with
`Date.now()` while records were written using the injected clock. Tests run under a `FixedClock` set
to March 2026 and the real system date was later, so every record looked expired the instant it was
written.

**Why it slipped through:** the store was written in isolation, where `Date.now()` looks obviously
correct. The bug only exists in relation to the rest of the system.

**Fix:** the store takes a `Clock`, and is registered through a factory provider so it resolves
whichever clock is bound rather than capturing the system one at module construction.

**Wider correction:** added to `CLAUDE.md` as a non-negotiable, and to `AGENTS.md` under the things
that go wrong in this codebase specifically, because this is a pattern and not a one-off.

---

## Entry 4 - Deterministic id generator for tests

**Where assistance was used:** a sequential id generator so test assertions can name identifiers.

**What came back:** `id-0001`, `id-0002`.

**What broke:** every request carrying an identifier failed with `400 Invalid uuid`. The contracts
validate identifiers with `z.string().uuid()`, so the generator produced values the system correctly
refused.

**Fix:** UUID-shaped output with the counter in the last group, so values stay readable in a failure
message. Non-hex characters in the prefix are now sanitised, after a first fix that used `t` as a
prefix and produced `000t0000-...`, which is UUID-shaped and still not a UUID.

**Note:** two rounds on a five-line function. Worth recording, because "it is fixed now" is often
"the symptom that was shown is fixed now".

---

## Entry 5 - Design token contrast

**Where assistance was used:** a WCAG relative-luminance contrast checker, which is a published
algorithm, and a test matrix over every colour pair the product uses.

**What came back:** a correct implementation of the algorithm, and a test matrix over both themes.

**What it caught:** `#9aa5b4` for emphasised borders scores 2.5 against white, below the 3:1 non-text
minimum. Not something anyone would notice by looking at it. Darkened to `#6b7684`, which scores 4.6.

**Rejected:** an assertion that critical and caution colours must differ by a contrast ratio. They
separate by hue, not luminance, so a contrast ratio is the wrong measure and the threshold chosen
failed for a palette that is perfectly distinguishable. Replaced with a channel distance, which is a
better proxy for "these do not look like the same badge at a glance".

**Lesson:** a generated test can encode a plausible-sounding rule that is not the rule you want, and
it will pass or fail with equal confidence either way.

---

## What this exercise actually showed

**Where assistance was genuinely useful:** mechanical breadth. Repetitive adapter implementations,
exhaustive test matrices over enumerated cases, and boilerplate that is tedious rather than hard.
The contrast checker is a correct implementation of a published algorithm and took a minute.

**Where it was consistently weak:** anything requiring a view of the whole system. Sequence
allocation, the clock, and the pipe binding are all the same failure in different clothes: locally
sensible code that is wrong in context. None of them look wrong in isolation and none of them
produce a compile error.

**The most important habit:** writing tests from the acceptance criteria before the implementation.
In Entry 1 the tests written alongside the implementation passed against code that had two real
bugs. Tests written from the spec first found both immediately. A test written after the fact
asserts what the code does, which is not the same as what it should do.

**On "it compiles":** every issue above compiled. Three of them passed a test suite. Compiling is
evidence that the syntax is valid and nothing else.
