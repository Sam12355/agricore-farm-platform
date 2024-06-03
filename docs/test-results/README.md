# Recorded test results

Real output from commands that were actually run on the build machine. Nothing here is retyped,
summarised or reformatted from memory, and nothing is written for a command that was not executed.

| File | Command | Result |
|------|---------|--------|
| [packages.md](packages.md) | `pnpm -r --filter "./packages/**" test` | 128 passing |
| [api.md](api.md) | `npx jest --config jest.config.js --runInBand` | 128 passing across unit, integration and e2e |

Totals: **256 tests, all passing**, with no external services running.

## What was not run, and why

| Suite | State | To verify it yourself |
|-------|-------|-----------------------|
| iOS unit and UI tests | Never executed. The build machine is Windows with no Xcode and no Swift toolchain | On macOS: `cd apps/ios && xcodebuild test -scheme GuardianLink -destination 'platform=iOS Simulator,name=iPhone 15'` |
| Android unit tests | Not executed. The SDK and a JDK are present, but no Gradle distribution is installed and no wrapper binary is committed | `cd apps/android && gradle testDebugUnitTest` (or generate a wrapper first with `gradle wrapper`) |
| Android instrumented tests | Not executed, for the same reason plus no emulator | `cd apps/android && ./gradlew connectedDebugAndroidTest` with a device or AVD attached |
| Playwright browser journeys | Specs written; browsers not downloaded on this machine | `pnpm --filter @guardianlink/web exec playwright install chromium && pnpm --filter @guardianlink/web test:e2e` |
| Terraform fmt and validate | No Terraform CLI on the build machine | `cd infrastructure/terraform/environments/dev && terraform init -backend=false && terraform validate` |
| Dependency audit and secret scan | Configured in CI, not run locally | `pnpm audit --audit-level moderate` |
| Any deployment | Never attempted. Requires credentials and explicit approval | n/a |

## The rule

If a command did not run here, no result is claimed for it anywhere in this repository. The artefact
is marked unverified and the command needed to check it is written down. That is the whole point of
this directory.
