import Foundation

/// The protocol seam.
///
/// Every dependency a view controller or a view model has is one of these. Nothing in the
/// app reaches for `URLSession`, `CLLocationManager`, `Keychain`, `StoreKit` or `Date()`
/// directly, which is the reason the test target has no network stubs and no simulator
/// entitlements.
///
/// This is the single decision that made the iOS app testable. Everything else follows.

// MARK: - Time

protocol Clock {
    func now() -> Date
}

struct SystemClock: Clock {
    func now() -> Date { Date() }
}

/// Test double. Time only moves when a test moves it.
final class FixedClock: Clock {
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_773_000_000)) {
        self.current = start
    }

    func now() -> Date { current }

    func advance(by interval: TimeInterval) {
        current = current.addingTimeInterval(interval)
    }
}

// MARK: - API

enum ApiError: Error, Equatable {
    case unauthenticated
    case forbidden
    case notFound
    case conflict(currentVersion: Int?)
    case rateLimited(retryAfter: TimeInterval)
    case validation(message: String)
    /// No connectivity. The caller queues rather than surfacing an error, which is the
    /// difference between an app that works on the underground and one that does not.
    case offline
    case server(status: Int, correlationId: String?)
}

protocol ApiClient {
    func register(email: String, password: String, displayName: String) async throws -> AuthSession
    func login(email: String, password: String) async throws -> AuthSession
    func refresh(refreshToken: String) async throws -> AuthSession

    func listWorkers() async throws -> [Worker]
    func addWorker(_ worker: NewWorker) async throws -> Worker
    func removeWorker(id: UUID) async throws

    func startCountdown(durationSeconds: Int, idempotencyKey: String) async throws -> CountdownResponse
    func cancelCountdown(id: UUID, reason: String) async throws

    /// Idempotency key is a parameter rather than generated inside, because the queue owns
    /// it: the same operation retried after a relaunch must send the same key.
    func activateAlert(
        countdownId: UUID?,
        trigger: String,
        location: LocationFix?,
        occurredAt: Date?,
        idempotencyKey: String
    ) async throws -> Alert

    func recordLocation(alertId: UUID, points: [LocationFix]) async throws
    func resolveAlert(alertId: UUID, resolution: String, expectedVersion: Int) async throws -> Alert
    func alertTimeline(alertId: UUID, afterSequence: Int) async throws -> AlertTimeline
}

// MARK: - Location

enum LocationAuthorisation: Equatable {
    case notDetermined
    case denied
    case whenInUse
    case always
}

protocol LocationProvider {
    var authorisation: LocationAuthorisation { get }
    func requestWhenInUseAuthorisation() async -> LocationAuthorisation
    /// Escalated only after an alert opens. Asking for Always on first launch is how
    /// an app gets denied outright.
    func requestAlwaysAuthorisation() async -> LocationAuthorisation

    func currentFix() async throws -> LocationFix
    func startStreaming(onFix: @escaping (LocationFix) -> Void)
    func stopStreaming()
}

// MARK: - Credential storage

/// Keychain in the app, an in-memory dictionary in tests. Never UserDefaults: it is a
/// plist in the app container and is included in unencrypted backups.
protocol CredentialStore {
    func store(session: AuthSession) throws
    func loadSession() throws -> AuthSession?
    func clear() throws
}

// MARK: - Connectivity

protocol ConnectivityMonitor {
    var isOnline: Bool { get }
    func onChange(_ handler: @escaping (Bool) -> Void)
}

// MARK: - Notifications

protocol NotificationHandler {
    func requestAuthorisation() async -> Bool
    func registerForRemoteNotifications()
    /// Local fallback so the countdown is visible from the lock screen even when push is
    /// unavailable or the user declined it.
    func scheduleCountdownNotification(expiresAt: Date)
    func cancelCountdownNotification()
}

// MARK: - Subscriptions

enum SubscriptionTier: String, Equatable {
    case free, plus, team
}

/// StoreKit 2 sits behind this. The app never imports StoreKit outside the adapter, so
/// the paywall and entitlement logic are testable with a fake and the test target does
/// not need a StoreKit configuration.
protocol SubscriptionGateway {
    func currentTier() async -> SubscriptionTier
    func availableProducts() async throws -> [SubscriptionProduct]
    func purchase(productId: String) async throws -> SubscriptionTier
    func restorePurchases() async throws -> SubscriptionTier
}

// MARK: - Models

struct AuthSession: Equatable, Codable {
    let userId: UUID
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let displayName: String

    func isExpired(at now: Date) -> Bool { now >= expiresAt }

    /// Refresh slightly early. A token that expires mid-request produces a 401 the user
    /// sees; refreshing a minute out avoids the whole class of problem.
    func needsRefresh(at now: Date) -> Bool {
        now >= expiresAt.addingTimeInterval(-60)
    }
}

struct Worker: Equatable, Identifiable, Codable {
    let id: UUID
    let name: String
    let email: String?
    let phone: String?
    let jobRole: String?
    let priority: Int
    let canViewLiveLocation: Bool
}

struct NewWorker: Equatable {
    let name: String
    let email: String?
    let phone: String?
    let jobRole: String?
    let priority: Int
}

struct CountdownResponse: Equatable, Codable {
    let id: UUID
    let expiresAt: Date
}

struct Alert: Equatable, Identifiable, Codable {
    let id: UUID
    let status: String
    let priority: String
    let activatedAt: Date
    let version: Int

    var isOpen: Bool { status == "active" || status == "acknowledged" }
}

struct AlertTimeline: Equatable, Codable {
    let alert: Alert
    let events: [AlertEvent]
    let latestSequence: Int
}

struct AlertEvent: Equatable, Identifiable, Codable {
    let id: UUID
    /// Ordering token. The client sorts by this and never by a timestamp.
    let sequence: Int
    let type: String
    let occurredAt: Date
}

struct SubscriptionProduct: Equatable {
    let id: String
    let displayName: String
    let displayPrice: String
    let tier: SubscriptionTier
}
