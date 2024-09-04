# Working in this repository with an AI agent

This file is read by Claude Code and similar agents. It is also the honest description of how the
repository expects to be worked in, so a human reviewer should read it too.

The position here is that an AI agent is a fast, tireless, confident colleague with no memory and no
accountability. That combination is useful and dangerous in specific ways, and the rules below are
aimed at the dangerous ones.

## Before writing any code

1. **A written specification exists first.** In `docs/specs/`, following
   [docs/ai/TASK_TEMPLATE.md](docs/ai/TASK_TEMPLATE.md). If the task does not have one, write the
   spec and stop for review. Do not write a spec and immediately implement it in the same step.
2. **State the assumption rather than guessing silently.** If the spec does not answer something,
   pick the sensible option, write it down in the spec under Assumptions, and continue.
3. **Say which files you intend to touch, before touching them.**

## Non-negotiables

These are not style preferences. Breaking any of them means the change is rejected regardless of
whether it works.

**Layering.** `domain/` imports nothing outside itself. `application/` imports `domain` and port
interfaces. `infrastructure/` imports both. Never the other way.

**Authorisation is checked in the service layer.** The route guard establishes who you are and
whether your role could do this. Whether this particular record is yours is checked where the record
is loaded. Both. A new endpoint that reads or mutates a resource and does not check ownership in the
service is a security bug, not a missing nice-to-have.

**Time comes from the injected `Clock`.** Never `Date.now()`, never `new Date()`, in `domain/` or
`application/`. There is a real bug recorded in TESTING.md caused by exactly this.

**Nothing sensitive reaches a log, an audit record, or an error message.** No coordinates, no email
addresses, no phone numbers, no tokens, no message bodies. Log identifiers instead. The redaction
layer is a safety net, not permission.

**Expected failures are `Result` values, not exceptions.** A new `DomainErrorCode` must be added to
the exhaustive switch in `error-mapper.ts`, which will refuse to compile until its status code is
decided.

**Every mutation of an alert carries an expected version.** If a new operation genuinely should
not, say why in the pull request.

**Endpoints a client will retry must deduplicate.** Mobile clients retry. Assume every write is
delivered more than once.

**No secret is ever written to a file in this repository.** Not in a test, not in a fixture, not in a
comment, not as an example that looks real. `.env.example` takes placeholders.

**Migrations are forward-only and additive.** New file, never an edit to one that has run.

## What to do, and what to stop and ask about

**Do freely:** add tests, fix a failing test, improve a comment that explains why, add an ADR,
tighten a type, extend a Zod schema additively.

**Do with a spec:** anything touching authentication, authorisation, the alert state machine,
notification delivery, retention or deletion.

**Stop and ask:** changing a public contract in `packages/contracts`, changing a retention default,
adding a runtime dependency, changing anything about how the demonstration notice is shown, or
anything that would send data to a real external service.

**Never:** commit a secret, push to a remote, deploy anything, create a paid cloud resource, submit
to an app store, weaken an authorisation check to make a test pass, or delete a test that is failing
rather than fixing what it caught.

## After writing code

Run these and paste the real output. Do not describe what you expect them to print.

```bash
pnpm lint
pnpm typecheck
pnpm --filter @agricore/api test
pnpm --filter @agricore/api test:e2e
```

Then review your own diff against [docs/ai/REVIEW_CHECKLIST.md](docs/ai/REVIEW_CHECKLIST.md).

**Compiling is not evidence of correctness.** Neither is a passing test that you wrote to match the
implementation you just produced. Ask what would make this wrong, and whether anything currently
checks that.

## Recording what happened

Update `AI_WORKLOG.md` with what was delegated, what came back, what was rejected and why, which
tests failed, and what fixed them. A worklog with no rejections in it is not a sign that the agent
did well; it is a sign that nobody was reviewing.

## Repository facts worth knowing

- pnpm workspaces. `pnpm build:packages` before anything that imports `@agricore/*`.
- The test suite needs no external services. If you find yourself adding a service container to make
  a test pass, you have taken a wrong turn.
- `packages/contracts` is the single source of truth for the API surface. Change a schema there and
  the API, the web client and the generated OpenAPI document all follow.
- Tests use `FixedClock` and a deliberately cheap password hasher. Only the clock, the hasher and the
  realtime publisher are swapped; everything else is production wiring.
