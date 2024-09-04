# Contributing

## Getting set up

```bash
pnpm install
pnpm build:packages
pnpm verify          # confirm a clean checkout is green before you change anything
```

Node 20 or newer and pnpm 9. Nothing else is required for the default path.

## The workflow

1. **Write the specification first.** Anything beyond a one-line fix gets a file in `docs/specs/`
   covering scope, affected systems, acceptance criteria, security considerations, required tests and
   the Definition of Done. This is not ceremony: it is what makes review possible and what keeps AI
   assistance from turning into unreviewed code. See [docs/ai/TASK_TEMPLATE.md](docs/ai/TASK_TEMPLATE.md).
2. **Branch.** `feature/short-description`, `fix/short-description`, `docs/short-description`.
3. **Small commits.** One logical change each. A commit that touches the domain, the HTTP layer, the
   web client and the docs is four commits.
4. **Run the checks yourself.** `pnpm verify` before opening a pull request, not after CI complains.
5. **Fill in the pull-request template honestly.** Tick what you actually ran. "Not verified, and
   here is why" is a legitimate answer; a ticked box for something you did not run is not.

## Commit messages

Conventional Commits. The release-note generator in `native-release-lab` reads these, so the prefix
is load-bearing rather than decorative.

```
feat(alerts): expire a manager claim after five minutes
fix(auth): reject a token claiming the none algorithm
test(alert): cover a cancellation arriving after expiry
docs(privacy): explain what survives account deletion
refactor(outbox): move dedupe into the consumer
build(deps): update zod to 3.24
ci(android): cache gradle between runs
security(logging): redact coordinates at any nesting depth
chore(repo): add editorconfig
```

Scope is the module. Subject is imperative, lowercase, no full stop. The body explains why, not what;
the diff already says what.

## Code conventions

**Layering.** `domain/` imports nothing. `application/` imports `domain` and port interfaces.
`infrastructure/` imports both. A pull request that breaks this direction will be sent back, because
it is the property everything else depends on.

**Expected failures are values.** Return `Result<T, DomainError>`. Throwing is for states that mean
the process is broken. A new error code must be added to `DomainErrorCode` and mapped in
`error-mapper.ts`, where the exhaustive switch will refuse to compile until you decide its status.

**Ports take constructor injection.** No service reaches for a singleton or imports a concrete
adapter.

**Time comes from `Clock`.** Never `Date.now()` or `new Date()` inside application or domain code.
Mixing two sources of time in one component is a bug every time; there is a note in TESTING.md about
where that already bit.

**Authorisation belongs in the service.** The guard checks authentication and role. Ownership is
checked where the record is loaded. Both, always.

**Nothing sensitive in a log.** If you find yourself wanting to log a value to debug something, log
the identifier instead. The redaction list will catch most of it; do not rely on that.

**Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`,
no non-null assertion outside tests. Both are lint errors.

## Tests

Every change that alters behaviour ships with a test for the failure path, not just the happy one. A
retry policy with no test for the fifth failure is decoration.

Name tests after behaviour. The output of `pnpm test` should read as a description of the system.

## Database changes

Forward-only. New file, never an edit to one that has run somewhere. Additive first: add a column,
backfill, switch the reads, drop the old column in a later release. A migration that is not safe to
run while the previous version is still serving traffic needs a note in the pull request explaining
the rollout.

## Accessibility

Not a review-time afterthought. Keyboard reachable, labelled, contrast checked. The token contrast
test will fail the build for a colour pair that drops below AA, and the Playwright suite runs axe.

## Using an AI agent

Encouraged, with conditions, all of which are in [CLAUDE.md](CLAUDE.md) and
[docs/ai/WORKFLOW.md](docs/ai/WORKFLOW.md). The short version: a written spec comes first, generated
code is reviewed line by line, and "it compiles" is not evidence of anything. If a generated change
was rejected or corrected, say so in `AI_WORKLOG.md`. That record is more interesting to a reviewer
than a clean diff.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Nothing here is deployed, so there is nothing live to compromise, but
design problems are still worth raising.
