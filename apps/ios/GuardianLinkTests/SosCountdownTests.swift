import XCTest

@testable import GuardianLink

/// Countdown behaviour, verified without waiting for anything.
///
/// Every test below would take real seconds if the type owned a timer. Because time is a
/// parameter, the whole file runs in milliseconds and nothing is flaky on a loaded CI
/// machine.
///
/// NOT EXECUTED. The build machine for this portfolio is Windows, with no Xcode and no
/// Swift toolchain, so these tests have never been run. That is recorded in
/// docs/test-results/README.md rather than implied otherwise. The CI workflow has a
/// macOS job that runs them.
final class SosCountdownTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_773_000_000)

    func testStartsPendingWithTheRequestedDuration() {
        let countdown = SosCountdown(startedAt: start, duration: 10)

        XCTAssertEqual(countdown.status, .pending)
        XCTAssertEqual(countdown.expiresAt, start.addingTimeInterval(10))
        XCTAssertEqual(countdown.remaining(at: start), 10)
    }

    func testClampsADurationBelowTheMinimum() {
        // A one-second countdown is not a countdown, it is an accident waiting to happen.
        let countdown = SosCountdown(startedAt: start, duration: 1)
        XCTAssertEqual(countdown.remaining(at: start), SosCountdown.minimumDuration)
    }

    func testClampsADurationAboveTheMaximum() {
        let countdown = SosCountdown(startedAt: start, duration: 600)
        XCTAssertEqual(countdown.remaining(at: start), SosCountdown.maximumDuration)
    }

    func testRemainingNeverGoesNegative() {
        let countdown = SosCountdown(startedAt: start, duration: 10)
        XCTAssertEqual(countdown.remaining(at: start.addingTimeInterval(30)), 0)
    }

    func testProgressStaysWithinTheTrackEvenIfTheClockJumps() {
        let countdown = SosCountdown(startedAt: start, duration: 10)

        XCTAssertEqual(countdown.progress(at: start), 0, accuracy: 0.001)
        XCTAssertEqual(countdown.progress(at: start.addingTimeInterval(5)), 0.5, accuracy: 0.001)
        XCTAssertEqual(countdown.progress(at: start.addingTimeInterval(500)), 1, accuracy: 0.001)
        // A clock that jumps backwards must not draw the ring outside its bounds.
        XCTAssertEqual(countdown.progress(at: start.addingTimeInterval(-50)), 0, accuracy: 0.001)
    }

    // MARK: - Cancellation

    func testCancelsBeforeExpiry() throws {
        var countdown = SosCountdown(startedAt: start, duration: 10)
        try countdown.cancel(reason: .falseTrigger, at: start.addingTimeInterval(4))

        XCTAssertEqual(countdown.status, .cancelled)
        XCTAssertEqual(countdown.cancelReason, .falseTrigger)
        XCTAssertFalse(countdown.shouldActivate)
    }

    func testCancellingTwiceIsNotAnError() throws {
        var countdown = SosCountdown(startedAt: start, duration: 10)
        try countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(2))

        // Tapping cancel again while the first request is in flight should not show an
        // error for something that already went the way the user wanted.
        XCTAssertNoThrow(try countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(3)))
        XCTAssertEqual(countdown.status, .cancelled)
    }

    func testRefusesToCancelAfterExpiry() {
        var countdown = SosCountdown(startedAt: start, duration: 5)

        // The window closed. The user is told the truth rather than shown a cancelled
        // screen while their contacts receive messages.
        XCTAssertThrowsError(
            try countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(6))
        ) { error in
            XCTAssertEqual(error as? SosCountdown.CancellationError, .alreadyExpired)
        }
        XCTAssertEqual(countdown.status, .pending)
    }

    func testCancellationAtExactlyTheExpiryInstantIsRefused() {
        var countdown = SosCountdown(startedAt: start, duration: 10)
        // The boundary belongs to expiry. Ambiguity here is the difference between an
        // alert going out and not going out.
        XCTAssertThrowsError(
            try countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(10))
        )
    }

    func testRefusesToCancelAnAlreadyActivatedCountdown() {
        var countdown = SosCountdown(startedAt: start, duration: 5)
        let incidentId = UUID()
        countdown.markActivated(incidentId: incidentId)

        XCTAssertThrowsError(
            try countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(1))
        ) { error in
            XCTAssertEqual(
                error as? SosCountdown.CancellationError,
                .alreadyActivated(incidentId: incidentId)
            )
        }
    }

    // MARK: - Activation

    func testACancelledCountdownNeverActivates() {
        var countdown = SosCountdown(startedAt: start, duration: 10)
        try? countdown.cancel(reason: .userCancelled, at: start.addingTimeInterval(1))

        countdown.markActivated(incidentId: UUID())

        // The whole point of the cancel window.
        XCTAssertEqual(countdown.status, .cancelled)
        XCTAssertNil(countdown.incidentId)
    }

    func testAnExpiredCountdownStillActivatesWhenTheDeviceComesBackOnline() {
        let countdown = SosCountdown(startedAt: start, duration: 10)

        // Twenty minutes later, signal returns. This is a real event that was reported
        // late, not a stale one to discard. Only cancellation stops an activation.
        XCTAssertTrue(countdown.hasExpired(at: start.addingTimeInterval(1200)))
        XCTAssertTrue(countdown.shouldActivate)
    }

    func testTheIdempotencyKeyIsStableForTheLifetimeOfTheCountdown() {
        let countdown = SosCountdown(startedAt: start, duration: 10)
        let key = countdown.activationIdempotencyKey

        var mutated = countdown
        mutated.markActivated(incidentId: UUID())

        // Minted at start, so a crash mid-countdown and a retry after relaunch send the
        // same key and produce one incident.
        XCTAssertEqual(mutated.activationIdempotencyKey, key)
        XCTAssertFalse(key.isEmpty)
    }
}
