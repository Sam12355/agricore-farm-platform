import Foundation

/// The SOS screen's state machine.
///
/// Holds no UIKit, performs no I/O of its own, and never reads the clock. Everything comes
/// through the ports in `Application/Ports.swift`, which is why the whole SOS flow can be
/// driven in a unit test in milliseconds rather than by tapping a simulator for ten real
/// seconds per case.
///
/// The view controller observes `state` and renders it. It contains no logic beyond that.
@MainActor
final class SosViewModel {
    enum State: Equatable {
        case idle
        case countingDown(remaining: TimeInterval, progress: Double, canCancel: Bool)
        case activating
        case active(incidentId: UUID, queued: Bool)
        case failed(message: String)
    }

    private(set) var state: State = .idle {
        didSet { if state != oldValue { onChange?(state) } }
    }

    var onChange: ((State) -> Void)?

    private let api: ApiClient
    private let location: LocationProvider
    private let queue: OfflineQueueStore
    private let notifications: NotificationHandler
    private let connectivity: ConnectivityMonitor
    private let clock: Clock

    private var countdown: SosCountdown?

    init(
        api: ApiClient,
        location: LocationProvider,
        queue: OfflineQueueStore,
        notifications: NotificationHandler,
        connectivity: ConnectivityMonitor,
        clock: Clock
    ) {
        self.api = api
        self.location = location
        self.queue = queue
        self.notifications = notifications
        self.connectivity = connectivity
        self.clock = clock
    }

    // MARK: - Countdown

    /// Starts the countdown locally and immediately.
    ///
    /// The server is told afterwards, and a failure to tell it does not stop the countdown.
    /// Someone holding the button in a car park with no signal must still get the cancel
    /// window and still raise the alert when signal returns. Blocking on a network call
    /// here would make the feature useless exactly when it matters.
    func startCountdown(durationSeconds: TimeInterval = SosCountdown.defaultDuration) async {
        let now = clock.now()
        let started = SosCountdown(startedAt: now, duration: durationSeconds)
        countdown = started

        state = .countingDown(
            remaining: started.remaining(at: now),
            progress: started.progress(at: now),
            canCancel: true
        )

        // A local notification so the countdown is visible from the lock screen even if
        // push is unavailable or the user declined it.
        notifications.scheduleCountdownNotification(expiresAt: started.expiresAt)

        Task { [weak self] in
            guard let self else { return }
            _ = try? await self.api.startCountdown(
                durationSeconds: Int(durationSeconds),
                idempotencyKey: started.activationIdempotencyKey
            )
        }
    }

    /// Called from the display link or timer. The view model never schedules it itself.
    func tick() async {
        guard var current = countdown, current.status == .pending else { return }
        let now = clock.now()

        guard current.hasExpired(at: now) else {
            state = .countingDown(
                remaining: current.remaining(at: now),
                progress: current.progress(at: now),
                canCancel: true
            )
            return
        }

        current.markActivated(incidentId: UUID())
        countdown = current
        await activate(from: current)
    }

    func cancel(reason: SosCountdown.CancelReason = .userCancelled) async {
        guard var current = countdown else { return }

        do {
            try current.cancel(reason: reason, at: clock.now())
            countdown = current
            notifications.cancelCountdownNotification()
            state = .idle

            Task { [weak self] in
                guard let self else { return }
                try? await self.api.cancelCountdown(id: current.id, reason: reason.rawValue)
            }
        } catch SosCountdown.CancellationError.alreadyExpired {
            // The window closed while the tap was in flight. The user is told the truth
            // rather than shown a cancelled screen while their contacts are messaged.
            state = .failed(message: "The countdown already finished. Your contacts are being told.")
        } catch {
            state = .failed(message: "That could not be cancelled.")
        }
    }

    // MARK: - Activation

    private func activate(from countdown: SosCountdown) async {
        state = .activating
        notifications.cancelCountdownNotification()

        // Best effort. An alert with no position is still an alert, and waiting for a fix
        // that may never arrive would delay it indefinitely.
        let fix = try? await location.currentFix()

        do {
            let incident = try await api.activateIncident(
                countdownId: countdown.id,
                trigger: "sos_countdown",
                location: fix,
                occurredAt: countdown.expiresAt,
                idempotencyKey: countdown.activationIdempotencyKey
            )
            state = .active(incidentId: incident.id, queued: false)
            startStreamingLocation(for: incident.id)
        } catch ApiError.offline {
            // The important branch. The intent is recorded and the sync worker sends it
            // when connectivity returns, carrying the same idempotency key so the retry
            // produces one incident rather than several.
            await queue.enqueue(
                QueuedOperation(
                    kind: .activateIncident(countdownId: countdown.id, trigger: "sos_countdown"),
                    createdAt: countdown.expiresAt,
                    idempotencyKey: countdown.activationIdempotencyKey
                )
            )
            state = .active(incidentId: countdown.id, queued: true)
        } catch {
            state = .failed(message: "The alert could not be raised. It will be retried.")

            await queue.enqueue(
                QueuedOperation(
                    kind: .activateIncident(countdownId: countdown.id, trigger: "sos_countdown"),
                    createdAt: countdown.expiresAt,
                    idempotencyKey: countdown.activationIdempotencyKey
                )
            )
        }
    }

    private func startStreamingLocation(for incidentId: UUID) {
        location.startStreaming { [weak self] fix in
            guard let self else { return }
            Task { @MainActor in
                do {
                    try await self.api.recordLocation(incidentId: incidentId, points: [fix])
                } catch {
                    // Queued rather than dropped. A gap in the track is a gap in what the
                    // operator can see.
                    await self.queue.enqueue(
                        QueuedOperation(
                            kind: .recordLocation(incidentId: incidentId, points: [fix]),
                            createdAt: fix.capturedAt
                        )
                    )
                }
            }
        }
    }

    func resolve(incidentId: UUID, version: Int) async {
        location.stopStreaming()

        do {
            _ = try await api.resolveIncident(
                incidentId: incidentId,
                resolution: "user_safe",
                expectedVersion: version
            )
            state = .idle
        } catch ApiError.offline {
            await queue.enqueue(
                QueuedOperation(
                    kind: .resolveIncident(
                        incidentId: incidentId,
                        resolution: "user_safe",
                        expectedVersion: version
                    ),
                    createdAt: clock.now()
                )
            )
            state = .idle
        } catch {
            state = .failed(message: "That could not be marked as resolved yet.")
        }
    }
}

/// Persistence port for the offline queue. Core Data implements it in the app.
protocol OfflineQueueStore {
    func enqueue(_ operation: QueuedOperation) async
    func pending() async -> [QueuedOperation]
    func remove(id: UUID) async
    func recordFailure(id: UUID, error: String, at: Date) async
}
