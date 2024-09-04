# AgriCore for iOS

Swift and UIKit. No third-party runtime dependencies.

## Status: not compiled

The build machine for this portfolio runs Windows. There is no Xcode and no Swift
toolchain on it, so **none of this has been compiled and none of the tests have been run.**
The sources and project configuration are complete and reviewable; that is a different
claim from "it builds", and it is worth keeping the two apart.

To check it yourself on macOS:

```bash
cd apps/ios
xcodebuild test -project AgriCore.xcodeproj -scheme AgriCore \
  -destination 'platform=iOS Simulator,name=iPhone 15'
```

The CI workflow has a macOS job that does exactly this.

## What is here

```text
AgriCore/
  Domain/          Pure value types. No UIKit, no Foundation networking, no Date()
    AlertCountdown.swift      the cancel window, as a testable value type
    OfflineQueue.swift      queued operations, ordering and backoff rules
  Application/
    Ports.swift             every dependency the app has, as a protocol
  Infrastructure/           adapters: URLSession, CoreLocation, Keychain, StoreKit 2
  Presentation/             view controllers and view models
  Persistence/              Core Data stack and the queued-operation store
AgriCoreWidget/         WidgetKit extension: current field-operation status
AgriCoreIntents/        App Intent: start a field operation from Siri or Shortcuts
AgriCoreTests/          XCTest
AgriCoreUITests/        XCUITest for the critical journeys
```

## The one decision everything else follows from

`Application/Ports.swift` defines a protocol for every dependency: the API client, the
location provider, credential storage, notifications, subscriptions, connectivity, and
the clock. Nothing outside `Infrastructure/` imports `URLSession`, `CoreLocation`,
`Security` or `StoreKit`.

That is why `Domain/AlertCountdown.swift` is a struct with no reference to a timer, and why
its tests run in milliseconds instead of waiting ten real seconds for a countdown to
expire. It is also why the test target needs no network stubs, no simulator entitlements
and no StoreKit configuration file.

View controllers hold view models. View models hold protocols. No view controller
anywhere in this app performs a network call.

## Offline

Every operation that changes server state is written to Core Data first and sent
afterwards. Three rules make replay safe:

1. **The idempotency key is minted when the operation is created**, so a retry after a
   crash or a lost response produces one alert rather than several.
2. **Timestamps are the creation time, not the send time.** A backlog flushed twenty
   minutes late must not look like it happened twenty minutes late.
3. **Activation is ordered ahead of everything else** for the same alert. A location
   update sent before the activation that created the alert would be rejected and
   retried until its budget ran out.

Operations that exhaust their retry budget are surfaced in the UI rather than dropped
silently. The user believes an alert was raised; if it was not, they need to know.

## Accessibility

- Dynamic Type throughout, including the countdown, with no fixed font sizes
- VoiceOver labels on every control, and the countdown announces remaining time on a
  polite interval rather than on every tick
- The alert control is a 64 pt target, well above the 44 pt minimum, because it is used
  under stress
- Colour is never the only signal: the active-alert state carries an icon and text
- `UIAccessibility.isReduceMotionEnabled` suppresses the countdown ring animation

## Credential-dependent parts

| Feature | Needs | Local substitute |
|---------|-------|------------------|
| Push notifications | APNs key, bundle id, team id | `MockPushProvider` plus an in-app inbox |
| StoreKit subscriptions | App Store Connect products | `.storekit` test configuration and `FakeSubscriptionGateway` |
| TestFlight upload | App Store Connect API key, signing identity | Fastlane lane exists, upload gated behind a secret check |

No signing asset, certificate, provisioning profile or key is in this repository, and the
`.gitignore` covers all of them.

## Known limitations

- Never compiled, as above
- Sign in with Apple not implemented; email and password is the only path
- No certificate pinning. Correct for a real deployment, disproportionate here, and it
  makes local development against a proxy painful
- The widget shows session status only, not live alert state, because a widget
  refreshing during an active alert is a battery and privacy trade-off I did not want
  to make silently
