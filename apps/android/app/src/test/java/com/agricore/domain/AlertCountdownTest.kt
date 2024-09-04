package com.agricore.domain

import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JVM tests. No Robolectric, no instrumentation, no waiting.
 *
 * Every case below mirrors one in the iOS suite, including the expiry-boundary case. The
 * two platforms have to agree about whether a tap at exactly ten seconds cancels an
 * alert, and the only way to keep them agreeing is to assert it on both sides.
 */
class AlertCountdownTest {

    private val start = 1_773_000_000_000L

    @Test
    fun `starts pending with the requested duration`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)

        assertEquals(AlertCountdown.Status.PENDING, countdown.status)
        assertEquals(start + 10_000, countdown.expiresAt)
        assertEquals(10_000L, countdown.remainingMillis(start))
    }

    @Test
    fun `clamps a duration below the minimum`() {
        // A one-second countdown is not a cancel window.
        val countdown = AlertCountdown(startedAt = start, durationMillis = 1_000)
        assertEquals(AlertCountdown.MIN_DURATION_MS, countdown.remainingMillis(start))
    }

    @Test
    fun `clamps a duration above the maximum`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 600_000)
        assertEquals(AlertCountdown.MAX_DURATION_MS, countdown.remainingMillis(start))
    }

    @Test
    fun `remaining never goes negative`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)
        assertEquals(0L, countdown.remainingMillis(start + 30_000))
    }

    @Test
    fun `progress stays within the track even if the clock jumps`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)

        assertEquals(0f, countdown.progress(start), 0.001f)
        assertEquals(0.5f, countdown.progress(start + 5_000), 0.001f)
        assertEquals(1f, countdown.progress(start + 500_000), 0.001f)
        assertEquals(0f, countdown.progress(start - 50_000), 0.001f)
    }

    @Test
    fun `cancels before expiry`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)

        val result = countdown.cancel(AlertCountdown.CancelReason.FALSE_TRIGGER, start + 4_000)

        assertTrue(result is AlertCountdown.CancelResult.Cancelled)
        val cancelled = (result as AlertCountdown.CancelResult.Cancelled).countdown
        assertEquals(AlertCountdown.Status.CANCELLED, cancelled.status)
        assertEquals(AlertCountdown.CancelReason.FALSE_TRIGGER, cancelled.cancelReason)
        assertFalse(cancelled.shouldActivate)
    }

    @Test
    fun `cancelling twice is not an error`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)
        val first = countdown.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 2_000)
        val cancelled = (first as AlertCountdown.CancelResult.Cancelled).countdown

        val second = cancelled.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 3_000)

        assertTrue(second is AlertCountdown.CancelResult.Cancelled)
    }

    @Test
    fun `refuses to cancel after expiry`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 5_000)

        val result = countdown.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 6_000)

        assertTrue(result is AlertCountdown.CancelResult.AlreadyExpired)
        assertEquals(AlertCountdown.Status.PENDING, countdown.status)
    }

    @Test
    fun `cancellation at exactly the expiry instant is refused`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)

        // The boundary belongs to expiry, matching iOS. Ambiguity here is the difference
        // between an alert going out and not going out.
        val result = countdown.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 10_000)

        assertTrue(result is AlertCountdown.CancelResult.AlreadyExpired)
    }

    @Test
    fun `refuses to cancel an already activated countdown`() {
        val alertId = UUID.randomUUID()
        val countdown = AlertCountdown(startedAt = start, durationMillis = 5_000)
            .markActivated(alertId)

        val result = countdown.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 1_000)

        assertTrue(result is AlertCountdown.CancelResult.AlreadyActivated)
        assertEquals(alertId, (result as AlertCountdown.CancelResult.AlreadyActivated).alertId)
    }

    @Test
    fun `a cancelled countdown never activates`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)
        val cancelled = (countdown.cancel(AlertCountdown.CancelReason.USER_CANCELLED, start + 1_000)
            as AlertCountdown.CancelResult.Cancelled).countdown

        val attempted = cancelled.markActivated(UUID.randomUUID())

        assertEquals(AlertCountdown.Status.CANCELLED, attempted.status)
        assertNull(attempted.alertId)
    }

    @Test
    fun `an expired countdown still activates when the device comes back online`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)

        // Twenty minutes later, signal returns. A real event reported late, not a stale
        // one to discard.
        assertTrue(countdown.hasExpired(start + 1_200_000))
        assertTrue(countdown.shouldActivate)
    }

    @Test
    fun `the idempotency key is stable for the lifetime of the countdown`() {
        val countdown = AlertCountdown(startedAt = start, durationMillis = 10_000)
        val key = countdown.activationIdempotencyKey

        val activated = countdown.markActivated(UUID.randomUUID())

        assertEquals(key, activated.activationIdempotencyKey)
        assertTrue(key.isNotEmpty())
    }
}
