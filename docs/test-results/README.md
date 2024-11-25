# Recorded test results

Real output from commands that were actually run on the build machine. Nothing here is retyped,
summarised or reformatted from memory, and nothing is written for a command that was not executed.

| File | Command | Result |
|------|---------|--------|
| [packages.md](packages.md) | `pnpm -r --filter "./packages/**" test` | 155 passing |
| [api.md](api.md) | `npx jest --config jest.config.js --runInBand` | 137 passing across unit, integration and e2e |
| [web.md](web.md) | `npx vitest run` in `apps/web` | 48 passing, including axe checks |
| [seed.md](seed.md) | `pnpm seed` | Five scenarios seeded on in-memory adapters |
| [containers.md](containers.md) | `docker build` and `docker run` | Image builds, serves, and registers an account |

Totals: **340 tests, all passing**, with no external services running.

Everything in this directory was re-recorded on 2026-07-31 after the domain rename. The
previous transcripts had their identifiers rewritten along with the code, which would have
left text no command ever printed. Re-running was the only way to keep the claim honest, and
it caught a `docker run` line in [containers.md](containers.md) that would not have started.

## What was not run, and why

| Suite | State | To verify it yourself |
|-------|-------|-----------------------|
| iOS unit and UI tests | Not executed, and not part of what this repository sets out to prove. The mobile modules are here so the client half of the design can be read; the build machine is Windows with no Xcode and no Swift toolchain | On macOS: `cd apps/ios && xcodegen generate && xcodebuild test -scheme AgriCore -destination 'platform=iOS Simulator,name=iPhone 15'` |
| Android unit tests | Not executed, for the same reason. The SDK and a JDK are present, but no Gradle distribution is installed and no wrapper binary is committed | `cd apps/android && gradle wrapper && ./gradlew testDebugUnitTest` |
| Android instrumented tests | Not executed, for the same reason plus no emulator | `cd apps/android && ./gradlew connectedDebugAndroidTest` with a device or AVD attached |
| Playwright browser journeys | Specs written; browsers not downloaded on this machine | `pnpm --filter @agricore/web exec playwright install chromium && pnpm --filter @agricore/web test:e2e` |
| Terraform fmt and validate | No Terraform CLI on the build machine | `cd infrastructure/terraform/environments/dev && terraform init -backend=false && terraform validate` |
| Dependency audit and secret scan | Configured in CI, not run locally | `pnpm audit --audit-level moderate` |
| Any deployment | Never attempted. Requires credentials and explicit approval | n/a |

## The rule

If a command did not run here, no result is claimed for it anywhere in this repository. The artefact
is marked unverified and the command needed to check it is written down. That is the whole point of
this directory.
