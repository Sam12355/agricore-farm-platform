# Testing

## The one rule that shaped everything

The default test run needs no Postgres, no Redis, no MongoDB and no AWS credentials. Every port has
an in-memory adapter that implements the same guarantees as the real one, including version checks,
atomic event append and unique idempotency keys.

That is not a convenience. A test suite which needs infrastructure is a test suite people stop
running, and a portfolio whose tests a reviewer cannot run in two minutes might as well not have any.

## Running it

```bash
pnpm verify                                  # format, lint, type-check, everything
pnpm --filter @agricore/api test         # unit + integration
pnpm --filter @agricore/api test:e2e     # the 13-step workflow over HTTP
pnpm --filter @agricore/api test:cov     # with coverage
pnpm --filter "./packages/**" -r test        # contracts, tokens, fixtures
```

## Layers

| Layer | Where | What it covers |
|-------|-------|----------------|
| Domain unit | `apps/api/src/domain/**/*.spec.ts` | Pure state transitions and invariants. No I/O, no fixtures, milliseconds |
| Infrastructure unit | `apps/api/src/infrastructure/**/*.spec.ts` | Hashing, tokens, logging redaction, configuration |
| Contract | `packages/contracts/src/*.spec.ts` | The wire format. A renamed field fails a test rather than a mobile client |
| Design token | `packages/design-tokens/src/contrast.spec.ts` | WCAG AA on every colour pair actually used, in both themes |
| Fixture | `packages/test-fixtures/src/*.spec.ts` | That synthetic data really is synthetic |
| Integration | `apps/api/test/integration` | Real modules, real guards and pipes, in-memory outermost adapter |
| End-to-end | `apps/api/test/e2e` | The whole Nest application in-process, driven over HTTP |
| Browser | `apps/web/e2e` | Playwright journeys plus axe accessibility checks |
| Android | `app/src/test`, `app/src/androidTest` | JUnit with MockWebServer, Compose UI tests |
| iOS | `AgriCoreTests`, `AgriCoreUITests` | XCTest and XCUITest |

## What the coverage is pointed at

Not a percentage. The brief says not to chase one and it is right; a number rewards testing getters.
Effort went where being wrong costs something:

- **Authorisation.** Ten integration tests, one per operation, cross-user. Not one test called
  "authorisation works", because that is how the gap on the eleventh endpoint survives.
- **Alert activation.** Including the duplicate path, the cancelled-countdown path, and the
  key-reuse path.
- **Delivery.** Dedupe, retry backoff, dead-lettering, safe replay.
- **Deletion and export.** That the right data goes and the right data stays.
- **Offline sync.** A backlog flushed twenty minutes late, out of order, producing one alert and
  a timeline with the original capture times.
- **Real-time state.** Ordering, gap replay, subscription authorisation.

## Techniques worth pointing at

**Time is injected.** Every time-dependent behaviour takes a `Clock`. Countdown expiry, claim leases,
escalation windows, token lifetimes and retry backoff are all driven by a `FixedClock` in tests.
There is no `sleep` anywhere in the suite and nothing is flaky on a slow machine.

**A cheap hasher in tests.** The production scrypt parameters cost around 100 ms per call by design.
An end-to-end run registers a dozen accounts. `FastTestPasswordHasher` uses the same format and the
same code path at a lower cost, bound only in the test module.

**Only three things are swapped.** The clock, the hasher and the realtime publisher. Everything else
in the end-to-end harness is the production wiring: same guards, same interceptors, same pipes, same
services. A test that passes is exercising the code that ships.

**Tests are named after behaviour.** "refuses a cancellation that arrives after the countdown
finished", not "test cancel 2". The test list should read as a specification.

## Deliberately not tested

- Third-party SDK internals. StoreKit and Play Billing sit behind interfaces; the interfaces are
  tested with fakes.
- Real delivery to real providers.
- MapLibre rendering performance. The point-thinning routine has unit tests; there is no benchmark,
  because there is no number I could honestly publish.
- Terraform `plan` against a live account. Needs credentials and approval.

## Two bugs the tests actually caught

Recorded because "the tests pass" is only interesting if the tests were capable of failing.

**Border contrast.** The first palette used `#9aa5b4` for emphasised borders. It scores 2.5 against
white and fails the 3:1 non-text minimum. `contrast.spec.ts` failed the build and the token was
darkened to `#6b7684`. Nobody would have noticed this by looking at it.

**Mixed clocks in the idempotency store.** The in-memory store checked expiry with `Date.now()` while
records were written with the injected clock. Under a `FixedClock` set to a past date, every record
looked expired the instant it was written, so the duplicate-request test saw a fresh `201` instead of
a `409`. The store now takes a `Clock` and is provided through a factory so it resolves whichever one
is bound.

## Recorded results

[docs/test-results/](docs/test-results/) holds real output, with the command and the host at the top
of each file. Nothing in there is retyped or reformatted from memory. If something could not be run
on the build machine, it says so and gives the command a reviewer needs.
