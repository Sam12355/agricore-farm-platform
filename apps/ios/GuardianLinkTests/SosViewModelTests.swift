import XCTest

@testable import GuardianLink

/// The whole SOS flow, driven without a simulator, a network or a real second of waiting.
///
/// NOT EXECUTED. The build machine is Windows with no Xcode and no Swift toolchain, so
/// none of this has been run. Recorded in docs/test-results/README.md rather than implied
/// otherwise. The macOS CI job runs it.
@MainActor
final class SosViewModelTests: XCTestCase {
    private var clock: FixedClock!
    private var api: FakeApiClient!
    private var location: FakeLocationProvider!
    private var queue: FakeQueueStore!
    private var notifications: FakeNotificationHandler!
    private var viewModel: SosViewModel!

    override func setUp() async throws {
        clock = FixedClock()
        api = FakeApiClient()
        location = FakeLocationProvider()
        queue = FakeQueueStore()
        notifications = FakeNotificationHandler()

        viewModel = SosViewModel(
            api: api,
            location: location,
            queue: queue,
            notifications: notifications,
            connectivity: FakeConnectivity(isOnline: true),
            clock: clock
        )
    }

    // MARK: - Countdown

    func testStartingTheCountdownDoesNotWaitForTheServer() async {
        // Someone in a car park with no signal must still get the cancel window. Blocking
        // on a network call here would make the feature useless exactly when it matters.
        api.startCountdownDelay = 5

        await viewModel.startCountdown(durationSeconds: 10)

        guard case let .countingDown(remaining, _, canCancel) = viewModel.state else {
            return XCTFail("expected countingDown, got \(viewModel.state)")
        }
        XCTAssertEqual(remaining, 10, accuracy: 0.01)
        XCTAssertTrue(canCancel)
    }

    func testSchedulesALocalNotificationSoTheCountdownIsVisibleWhenLocked() async {
        await viewModel.startCountdown(durationSeconds: 10)
        XCTAssertEqual(notifications.scheduledCount, 1)
    }

    func testProgressAdvancesAsTimePasses() async {
        await viewModel.startCountdown(durationSeconds: 10)

        clock.advance(by: 5)
        await viewModel.tick()

        guard case let .countingDown(remaining, progress, _) = viewModel.state else {
            return XCTFail("expected countingDown")
        }
        XCTAssertEqual(remaining, 5, accuracy: 0.01)
        XCTAssertEqual(progress, 0.5, accuracy: 0.01)
    }

    // MARK: - Cancellation

    func testCancellingBeforeExpiryRaisesNoIncident() async {
        await viewModel.startCountdown(durationSeconds: 10)

        clock.advance(by: 4)
        await viewModel.cancel(reason: .falseTrigger)

        XCTAssertEqual(viewModel.state, .idle)
        XCTAssertEqual(api.activationCount, 0)
        XCTAssertEqual(notifications.cancelledCount, 1)
    }

    func testCancellingAfterExpiryTellsTheUserTheAlertIsGoingOut() async {
        await viewModel.startCountdown(durationSeconds: 5)

        clock.advance(by: 6)
        await viewModel.cancel()

        // Showing a cancelled screen while contacts receive messages would be worse than
        // an error.
        guard case let .failed(message) = viewModel.state else {
            return XCTFail("expected failed, got \(viewModel.state)")
        }
        XCTAssertTrue(message.contains("already finished"))
    }

    // MARK: - Activation

    func testExpiryRaisesAnIncident() async {
        await viewModel.startCountdown(durationSeconds: 10)

        clock.advance(by: 11)
        await viewModel.tick()

        guard case let .active(_, queued) = viewModel.state else {
            return XCTFail("expected active, got \(viewModel.state)")
        }
        XCTAssertFalse(queued)
        XCTAssertEqual(api.activationCount, 1)
    }

    func testActivationUsesTheKeyMintedWhenTheCountdownStarted() async {
        await viewModel.startCountdown(durationSeconds: 10)
        let keyAtStart = api.lastCountdownIdempotencyKey

        clock.advance(by: 11)
        await viewModel.tick()

        // The same key, so a crash mid-countdown and a retry after relaunch produce one
        // incident rather than two.
        XCTAssertEqual(api.lastActivationIdempotencyKey, keyAtStart)
    }

    func testActivationReportsTheCountdownExpiryAsTheOccurrenceTime() async {
        await viewModel.startCountdown(durationSeconds: 10)
        let expectedOccurrence = clock.now().addingTimeInterval(10)

        // The device was asleep and only woke up two minutes later.
        clock.advance(by: 130)
        await viewModel.tick()

        // The timeline should show when it happened, not when we managed to send it.
        XCTAssertEqual(api.lastOccurredAt, expectedOccurrence)
    }

    func testActivationDoesNotWaitForALocationFixThatMayNeverArrive() async {
        location.fixError = LocationError.unavailable

        await viewModel.startCountdown(durationSeconds: 5)
        clock.advance(by: 6)
        await viewModel.tick()

        // An alert with no position is still an alert.
        guard case .active = viewModel.state else {
            return XCTFail("expected active, got \(viewModel.state)")
        }
        XCTAssertNil(api.lastActivationLocation)
    }

    // MARK: - Offline

    func testOfflineActivationIsQueuedRatherThanFailed() async {
        api.error = ApiError.offline

        await viewModel.startCountdown(durationSeconds: 5)
        clock.advance(by: 6)
        await viewModel.tick()

        guard case let .active(_, queued) = viewModel.state else {
            return XCTFail("expected active, got \(viewModel.state)")
        }
        // The user is told the alert is raised, because from their point of view it is.
        XCTAssertTrue(queued)
        XCTAssertEqual(queue.operations.count, 1)
    }

    func testAQueuedActivationKeepsItsIdempotencyKey() async {
        api.error = ApiError.offline

        await viewModel.startCountdown(durationSeconds: 5)
        let key = api.lastCountdownIdempotencyKey

        clock.advance(by: 6)
        await viewModel.tick()

        // This is what makes the retry safe when the sync worker eventually sends it.
        XCTAssertEqual(queue.operations.first?.idempotencyKey, key)
    }

    func testAQueuedActivationKeepsTheTimeItHappened() async {
        api.error = ApiError.offline

        await viewModel.startCountdown(durationSeconds: 10)
        let expiry = clock.now().addingTimeInterval(10)

        clock.advance(by: 600)
        await viewModel.tick()

        // Flushed ten minutes late, but it did not happen ten minutes late.
        XCTAssertEqual(queue.operations.first?.createdAt, expiry)
    }

    func testAServerErrorAlsoQueuesRatherThanLosingTheAlert() async {
        api.error = ApiError.server(status: 503, correlationId: "abc")

        await viewModel.startCountdown(durationSeconds: 5)
        clock.advance(by: 6)
        await viewModel.tick()

        XCTAssertEqual(queue.operations.count, 1)
    }

    // MARK: - Resolution

    func testResolvingStopsTheLocationStream() async {
        await viewModel.startCountdown(durationSeconds: 5)
        clock.advance(by: 6)
        await viewModel.tick()

        await viewModel.resolve(incidentId: UUID(), version: 3)

        XCTAssertTrue(location.streamingStopped)
        XCTAssertEqual(viewModel.state, .idle)
    }

    func testResolvingWhileOfflineIsQueuedAndStillLooksResolved() async {
        await viewModel.startCountdown(durationSeconds: 5)
        clock.advance(by: 6)
        await viewModel.tick()

        api.error = ApiError.offline
        await viewModel.resolve(incidentId: UUID(), version: 3)

        XCTAssertEqual(viewModel.state, .idle)
        XCTAssertTrue(queue.operations.contains { operation in
            if case .resolveIncident = operation.kind { return true }
            return false
        })
    }
}

// MARK: - Fakes

private enum LocationError: Error { case unavailable }

private final class FakeApiClient: ApiClient {
    var error: ApiError?
    var startCountdownDelay: TimeInterval = 0

    private(set) var activationCount = 0
    private(set) var lastCountdownIdempotencyKey: String?
    private(set) var lastActivationIdempotencyKey: String?
    private(set) var lastActivationLocation: LocationFix?
    private(set) var lastOccurredAt: Date?

    func register(email: String, password: String, displayName: String) async throws -> AuthSession {
        throw ApiError.unauthenticated
    }

    func login(email: String, password: String) async throws -> AuthSession {
        throw ApiError.unauthenticated
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        throw ApiError.unauthenticated
    }

    func listTrustedContacts() async throws -> [TrustedContact] { [] }

    func addTrustedContact(_ contact: NewTrustedContact) async throws -> TrustedContact {
        throw ApiError.forbidden
    }

    func removeTrustedContact(id: UUID) async throws {}

    func startCountdown(durationSeconds: Int, idempotencyKey: String) async throws -> CountdownResponse {
        lastCountdownIdempotencyKey = idempotencyKey
        if startCountdownDelay > 0 {
            try? await Task.sleep(nanoseconds: UInt64(startCountdownDelay * 1_000_000_000))
        }
        if let error { throw error }
        return CountdownResponse(id: UUID(), expiresAt: Date())
    }

    func cancelCountdown(id: UUID, reason: String) async throws {
        if let error { throw error }
    }

    func activateIncident(
        countdownId: UUID?,
        trigger: String,
        location: LocationFix?,
        occurredAt: Date?,
        idempotencyKey: String
    ) async throws -> Incident {
        lastActivationIdempotencyKey = idempotencyKey
        lastActivationLocation = location
        lastOccurredAt = occurredAt

        if let error { throw error }

        activationCount += 1
        return Incident(id: UUID(), status: "active", priority: "standard", activatedAt: Date(), version: 0)
    }

    func recordLocation(incidentId: UUID, points: [LocationFix]) async throws {
        if let error { throw error }
    }

    func resolveIncident(incidentId: UUID, resolution: String, expectedVersion: Int) async throws -> Incident {
        if let error { throw error }
        return Incident(id: incidentId, status: "resolved", priority: "standard", activatedAt: Date(), version: expectedVersion + 1)
    }

    func incidentTimeline(incidentId: UUID, afterSequence: Int) async throws -> IncidentTimeline {
        IncidentTimeline(
            incident: Incident(id: incidentId, status: "active", priority: "standard", activatedAt: Date(), version: 0),
            events: [],
            latestSequence: 0
        )
    }
}

private final class FakeLocationProvider: LocationProvider {
    var authorisation: LocationAuthorisation = .whenInUse
    var fixError: Error?
    private(set) var streamingStopped = false

    func requestWhenInUseAuthorisation() async -> LocationAuthorisation { .whenInUse }
    func requestAlwaysAuthorisation() async -> LocationAuthorisation { .always }

    func currentFix() async throws -> LocationFix {
        if let fixError { throw fixError }
        return LocationFix(latitude: 53.5, longitude: 3.2, accuracyMetres: 10, capturedAt: Date())
    }

    func startStreaming(onFix: @escaping (LocationFix) -> Void) {}
    func stopStreaming() { streamingStopped = true }
}

private final class FakeQueueStore: OfflineQueueStore {
    private(set) var operations: [QueuedOperation] = []

    func enqueue(_ operation: QueuedOperation) async { operations.append(operation) }
    func pending() async -> [QueuedOperation] { operations }
    func remove(id: UUID) async { operations.removeAll { $0.id == id } }
    func recordFailure(id: UUID, error: String, at: Date) async {}
}

private final class FakeNotificationHandler: NotificationHandler {
    private(set) var scheduledCount = 0
    private(set) var cancelledCount = 0

    func requestAuthorisation() async -> Bool { true }
    func registerForRemoteNotifications() {}
    func scheduleCountdownNotification(expiresAt: Date) { scheduledCount += 1 }
    func cancelCountdownNotification() { cancelledCount += 1 }
}

private struct FakeConnectivity: ConnectivityMonitor {
    let isOnline: Bool
    func onChange(_ handler: @escaping (Bool) -> Void) {}
}
