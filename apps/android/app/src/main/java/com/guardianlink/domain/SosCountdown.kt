package com.guardianlink.domain

import java.util.UUID
import kotlin.math.max
import kotlin.math.min

/**
 * The SOS countdown.
 *
 * Deliberately the same shape as the iOS type in Domain/SosCountdown.swift, including the
 * boundary behaviour: the instant of expiry belongs to expiry, not to cancellation. Two
 * platforms disagreeing about whether a tap at exactly ten seconds cancels an alert is
 * the kind of divergence nobody notices until somebody's family gets a message that
 * should not have been sent.
 *
 * No Android imports. Time arrives as a parameter, so the tests are plain JVM tests with
 * no Robolectric, no instrumentation and no waiting.
 */
data class SosCountdown(
    val id: UUID = UUID.randomUUID(),
    val startedAt: Long,
    val durationMillis: Long = DEFAULT_DURATION_MS,
    /**
     * Minted when the countdown starts, not when it fires, so a process death
     * mid-countdown still deduplicates when WorkManager retries the activation.
     */
    val activationIdempotencyKey: String = UUID.randomUUID().toString(),
    val status: Status = Status.PENDING,
    val cancelledAt: Long? = null,
    val cancelReason: CancelReason? = null,
    val incidentId: UUID? = null,
) {
    enum class Status { PENDING, CANCELLED, ACTIVATED }

    enum class CancelReason(val wireValue: String) {
        USER_CANCELLED("user_cancelled"),
        FALSE_TRIGGER("false_trigger"),
    }

    val expiresAt: Long
        get() = startedAt + clampedDuration

    private val clampedDuration: Long
        get() = min(max(durationMillis, MIN_DURATION_MS), MAX_DURATION_MS)

    fun remainingMillis(now: Long): Long = max(0L, expiresAt - now)

    fun hasExpired(now: Long): Boolean = now >= expiresAt

    /** Fraction elapsed, clamped so a clock jump cannot push the ring outside its track. */
    fun progress(now: Long): Float {
        if (clampedDuration <= 0) return 1f
        return min(1f, max(0f, (now - startedAt).toFloat() / clampedDuration.toFloat()))
    }

    /** Only a cancellation stops an activation. Lateness never does. */
    val shouldActivate: Boolean
        get() = status == Status.PENDING

    sealed interface CancelResult {
        data class Cancelled(val countdown: SosCountdown) : CancelResult
        /**
         * The window closed before the tap arrived. The user is told the alert is going
         * out rather than shown a cancelled screen while their contacts are messaged.
         */
        data object AlreadyExpired : CancelResult
        data class AlreadyActivated(val incidentId: UUID?) : CancelResult
    }

    fun cancel(reason: CancelReason, now: Long): CancelResult = when (status) {
        // Cancelling twice happens when the button is tapped and the first request is
        // slow. Reporting success avoids an error for something that already worked.
        Status.CANCELLED -> CancelResult.Cancelled(this)
        Status.ACTIVATED -> CancelResult.AlreadyActivated(incidentId)
        Status.PENDING -> if (hasExpired(now)) {
            CancelResult.AlreadyExpired
        } else {
            CancelResult.Cancelled(
                copy(status = Status.CANCELLED, cancelledAt = now, cancelReason = reason),
            )
        }
    }

    fun markActivated(incidentId: UUID): SosCountdown =
        if (status == Status.CANCELLED) this
        else copy(status = Status.ACTIVATED, incidentId = incidentId)

    companion object {
        const val MIN_DURATION_MS = 5_000L
        const val MAX_DURATION_MS = 60_000L
        const val DEFAULT_DURATION_MS = 10_000L
    }
}
