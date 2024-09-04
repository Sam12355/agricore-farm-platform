import Foundation

/// The alert countdown, as a value type with no dependencies.
///
/// This is the piece of the iOS app that has to be right. It holds no reference to a
/// timer, a view controller, a network client or `Date()`. Time arrives as a parameter,
/// which is what makes every rule below testable in XCTest without waiting for anything.
///
/// The critical property: expiry is judged against the time the caller supplies, and the
/// caller supplies the server's view of time where it has one. A device that was asleep,
/// throttled, or simply wrong about the clock cannot talk its way past a cancellation.
struct AlertCountdown: Equatable {
    enum Status: String, Equatable {
        case pending
        case cancelled
        case activated
    }

    enum CancelReason: String, Equatable {
        case userCancelled = "user_cancelled"
        case falseTrigger = "false_trigger"
    }

    let id: UUID
    let startedAt: Date
    let expiresAt: Date
    /// Minted when the countdown starts, not when it fires, so a crash mid-countdown
    /// still deduplicates when the app relaunches and retries the activation.
    let activationIdempotencyKey: String

    private(set) var status: Status
    private(set) var cancelledAt: Date?
    private(set) var cancelReason: CancelReason?
    private(set) var alertId: UUID?

    static let minimumDuration: TimeInterval = 5
    static let maximumDuration: TimeInterval = 60
    static let defaultDuration: TimeInterval = 10

    init(
        id: UUID = UUID(),
        startedAt: Date,
        duration: TimeInterval = AlertCountdown.defaultDuration,
        activationIdempotencyKey: String = UUID().uuidString
    ) {
        let clamped = min(max(duration, Self.minimumDuration), Self.maximumDuration)
        self.id = id
        self.startedAt = startedAt
        self.expiresAt = startedAt.addingTimeInterval(clamped)
        self.activationIdempotencyKey = activationIdempotencyKey
        self.status = .pending
    }

    func remaining(at now: Date) -> TimeInterval {
        max(0, expiresAt.timeIntervalSince(now))
    }

    func hasExpired(at now: Date) -> Bool {
        now >= expiresAt
    }

    /// Fraction elapsed, for the ring animation. Clamped so a clock jump cannot push the
    /// progress indicator outside its track.
    func progress(at now: Date) -> Double {
        let total = expiresAt.timeIntervalSince(startedAt)
        guard total > 0 else { return 1 }
        return min(1, max(0, now.timeIntervalSince(startedAt) / total))
    }

    enum CancellationError: Error, Equatable {
        /// The window closed before the tap arrived. The alert is going out, and the user
        /// is told that rather than being shown a cancelled screen while their workers
        /// receive messages.
        case alreadyExpired
        case alreadyActivated(alertId: UUID?)
    }

    mutating func cancel(reason: CancelReason, at now: Date) throws {
        switch status {
        case .cancelled:
            // Cancelling twice is what happens when the button is tapped and the first
            // request is slow. Treating it as success avoids showing an error for
            // something that already went the way the user wanted.
            return
        case .activated:
            throw CancellationError.alreadyActivated(alertId: alertId)
        case .pending:
            guard !hasExpired(at: now) else { throw CancellationError.alreadyExpired }
            status = .cancelled
            cancelledAt = now
            cancelReason = reason
        }
    }

    mutating func markActivated(alertId: UUID) {
        guard status != .cancelled else { return }
        status = .activated
        self.alertId = alertId
    }

    /// Whether an activation should still be sent.
    ///
    /// Deliberately permissive about lateness. A device that was offline when the
    /// countdown expired and flushes ten minutes later is reporting a real event, so it
    /// is still sent. Only a cancellation stops an activation, never the passage of time.
    var shouldActivate: Bool {
        status == .pending
    }
}
