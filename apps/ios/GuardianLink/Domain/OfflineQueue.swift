import Foundation

/// The offline operation queue.
///
/// A safety app that only works with a signal is not a safety app. Every operation that
/// changes server state is written here first and sent afterwards, so triggering SOS in a
/// car park with no bars records the intent and delivers it when signal returns.
///
/// Three rules make replay safe:
///
///   1. Every operation carries the idempotency key it was created with. Retrying after a
///      crash, a relaunch, or a lost response produces one incident, not several.
///   2. Operations keep the time they were created, not the time they were sent. A
///      backlog flushed twenty minutes late must not look like it happened twenty minutes
///      late.
///   3. Ordering is preserved per incident. Sending a location update before the
///      activation that created the incident would be rejected by the server, and
///      retried forever.
///
/// Persistence is Core Data (see Persistence/QueuedOperationStore.swift). This type is the
/// pure part, so the ordering and backoff rules are testable without a managed context.
struct QueuedOperation: Equatable, Identifiable {
    enum Kind: Equatable {
        case activateIncident(countdownId: UUID?, trigger: String)
        case recordLocation(incidentId: UUID, points: [LocationFix])
        case resolveIncident(incidentId: UUID, resolution: String, expectedVersion: Int)
        case acknowledgeSession(sessionId: UUID)
    }

    let id: UUID
    let kind: Kind
    /// When the user did the thing, not when we managed to send it.
    let createdAt: Date
    let idempotencyKey: String
    private(set) var attempts: Int
    private(set) var lastAttemptAt: Date?
    private(set) var lastError: String?

    init(
        id: UUID = UUID(),
        kind: Kind,
        createdAt: Date,
        idempotencyKey: String = UUID().uuidString
    ) {
        self.id = id
        self.kind = kind
        self.createdAt = createdAt
        self.idempotencyKey = idempotencyKey
        self.attempts = 0
    }

    /// Activation goes first regardless of when it was queued.
    ///
    /// Without this, a location update queued a moment after activation could be sent
    /// first, be rejected because the incident does not exist yet, and retry until its
    /// budget ran out. Priority ordering is cheaper than teaching the retry loop about
    /// causality.
    var priority: Int {
        switch kind {
        case .activateIncident: return 0
        case .resolveIncident: return 1
        case .recordLocation: return 2
        case .acknowledgeSession: return 3
        }
    }

    static let maxAttempts = 8

    var isExhausted: Bool { attempts >= Self.maxAttempts }

    mutating func recordFailure(at now: Date, error: String) {
        attempts += 1
        lastAttemptAt = now
        lastError = error
    }

    /// Exponential backoff with a ceiling.
    ///
    /// No jitter here, unlike the server side. A single device retrying does not create a
    /// thundering herd, and predictable timing is easier to reason about when someone
    /// reports that their alert took a while to arrive.
    func nextAttemptDelay() -> TimeInterval {
        guard attempts > 0 else { return 0 }
        return min(pow(2, Double(attempts - 1)) * 2, 300)
    }

    func isReady(at now: Date) -> Bool {
        guard let lastAttemptAt else { return true }
        return now.timeIntervalSince(lastAttemptAt) >= nextAttemptDelay()
    }
}

struct LocationFix: Equatable, Codable {
    let latitude: Double
    let longitude: Double
    let accuracyMetres: Double
    /// When the device got the fix. Preserved through the queue and sent as-is.
    let capturedAt: Date
}

/// Ordering and selection over a set of queued operations. Pure, so the rules above are
/// verified by unit tests rather than by watching a phone in airplane mode.
enum OfflineQueuePolicy {
    static func nextBatch(
        from operations: [QueuedOperation],
        at now: Date,
        limit: Int = 10
    ) -> [QueuedOperation] {
        operations
            .filter { !$0.isExhausted }
            .filter { $0.isReady(at: now) }
            .sorted { left, right in
                if left.priority != right.priority { return left.priority < right.priority }
                return left.createdAt < right.createdAt
            }
            .prefix(limit)
            .map { $0 }
    }

    /// Operations that will never be sent and should be surfaced to the user.
    ///
    /// Silently dropping these would be the worst option: the user believes an alert was
    /// raised. The active-incident screen shows a banner when this is non-empty.
    static func exhausted(from operations: [QueuedOperation]) -> [QueuedOperation] {
        operations.filter(\.isExhausted)
    }
}
