# GuardianLink for Android

Kotlin, Jetpack Compose, Room, coroutines and Flow, WorkManager.

## Status: not compiled

The build machine has the Android SDK (platforms 34 and 36, build-tools 34 to 36.1) and
JDK 17, but no Gradle distribution and no committed wrapper binary. **Nothing here has
been compiled and no test has been run.** The sources, build files and tests are complete
and reviewable, which is a different claim.

To check it yourself:

```bash
cd apps/android
gradle wrapper          # once, if you do not already have a wrapper
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

CI has a job that does this on every push.

## Layout

```text
app/src/main/java/com/guardianlink/
  domain/          Pure Kotlin. No Android imports, no clock, no I/O
  data/            Repositories, Room entities and DAOs, Retrofit services
  infrastructure/  Adapters: location, credentials, notifications, billing, sync
  presentation/    Compose screens and view models exposing StateFlow
app/src/test/      JUnit and MockWebServer. Plain JVM, no Robolectric
app/src/androidTest/ Compose UI tests
```

## Dependency injection by hand

There is no Hilt. Dependencies are constructor-injected through an `AppContainer` built
in `GuardianLinkApplication`.

That is a deliberate trade-off, made for two reasons: the object graph is visible in a
diff rather than assembled by an annotation processor, and the module compiles on any
machine without KSP codegen. On a real team with more than one contributor I would use
Hilt, because hand-written wiring stops scaling somewhere around thirty dependencies.
Written down here rather than left for a reviewer to wonder about.

## Parity with iOS

`domain/SosCountdown.kt` and `Domain/SosCountdown.swift` are deliberately the same shape,
down to the boundary case: a cancellation at exactly the expiry instant is refused on both
platforms, and both test suites assert it.

Two platforms disagreeing about whether a tap at exactly ten seconds cancels an alert is
the kind of divergence nobody notices until somebody's family receives a message that
should not have been sent.

## Offline

Every state-changing operation is written to Room first and sent by a WorkManager job with
a network constraint. The rules match iOS:

1. The idempotency key is minted when the operation is created, so a retry after process
   death produces one incident rather than several.
2. Timestamps are creation time, not send time.
3. Activation is ordered ahead of anything else for the same incident.

WorkManager rather than a plain coroutine, because the work has to survive process death
and app removal from recents. A queued SOS that only sends while the app is foregrounded
is not a queued SOS.

## Permissions

Requested in stages, never on first launch:

- **Fine location** when the user first starts a safety session, with an explanation.
- **Background location** only after an incident has actually opened, which is the only
  point at which the request is justifiable to the user or to a reviewer.
- **Notifications** at the same time as the first session.

Location during an active incident runs in a foreground service with a visible
notification. That is a platform requirement and also the right behaviour: a product that
tracks someone's position should never do it invisibly.

## Storage

Tokens go in `EncryptedSharedPreferences`, never plain preferences. Cloud backup and
device transfer are disabled for every domain in `data_extraction_rules.xml`: the queued
operation store holds coordinates and the credential store holds tokens, and neither
should reach another device through a backup the user never thought about.

## Accessibility

- Content descriptions on every control; decorative elements explicitly null
- Minimum 48 dp targets, with the SOS control considerably larger
- `sp` for all text so system font scaling applies
- TalkBack announces countdown state on a polite interval, not on every tick
- State is never signalled by colour alone
- Animations respect the system animator duration scale

## Credential-dependent parts

| Feature | Needs | Local substitute |
|---------|-------|------------------|
| Push notifications | `google-services.json`, FCM key | `MockPushProvider` and an in-app inbox |
| Play Billing | Play Console products and licence testers | `FakeBillingClient` behind `BillingGateway` |
| Play upload | Play Developer API service account | Fastlane lane exists, gated behind a secret check |

No keystore, no service-account JSON and no `google-services.json` is in this repository.
`.gitignore` covers all three.

## Known limitations

- Never compiled or tested on this machine, as above
- Manual DI rather than Hilt, as above
- Maps are not implemented in the app; location is captured and sent, and the operator
  console renders it
- Compose UI tests are written but have never run against a device
