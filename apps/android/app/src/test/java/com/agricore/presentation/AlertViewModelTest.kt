package com.agricore.presentation

import com.agricore.domain.AlertCountdown
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The whole alert flow on a virtual clock.
 *
 * Plain JVM. No Robolectric, no instrumentation, no emulator, and no waiting: the coroutine
 * test scheduler advances time and `clock` is a lambda the test controls. A ten-second
 * countdown is asserted in microseconds.
 *
 * Every case here mirrors one in the iOS suite. The two platforms have to agree, and the
 * only way to keep them agreeing is to assert the same behaviour on both sides.
 *
 * NOT EXECUTED on the build machine: there is no Gradle distribution and no committed
 * wrapper binary. Recorded in docs/test-results/README.md.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertViewModelTest {

    private var now = 1_773_000_000_000L
    private val repository = FakeAlertTriggerRepository()
    private val location = FakeLocationProvider()
    private val notifications = FakeNotificationScheduler()

    private fun viewModel(scope: TestScope) = AlertViewModel(
        repository = repository,
        location = location,
        notifications = notifications,
        clock = { now },
        scope = scope,
    )

    @Test
    fun `starting the countdown does not wait for the server`() = runTest {
        // Somebody in a car park with no signal must still get the cancel window.
        repository.startCountdownDelayMs = 5_000
        val model = viewModel(this)

        model.startCountdown(10_000)

        val state = model.state.value
        assertTrue(state is AlertViewModel.UiState.CountingDown)
        assertEquals(10_000L, (state as AlertViewModel.UiState.CountingDown).remainingMillis)
    }

    @Test
    fun `schedules a notification so the countdown is visible when locked`() = runTest {
        viewModel(this).startCountdown(10_000)
        assertEquals(1, notifications.scheduled)
    }

    @Test
    fun `progress advances as time passes`() = runTest {
        val model = viewModel(this)
        model.startCountdown(10_000)

        now += 5_000
        advanceTimeBy(200)

        val state = model.state.value as AlertViewModel.UiState.CountingDown
        assertEquals(5_000L, state.remainingMillis)
        assertEquals(0.5f, state.progress, 0.01f)
    }

    @Test
    fun `cancelling before expiry raises no alert`() = runTest {
        val model = viewModel(this)
        model.startCountdown(10_000)

        now += 4_000
        model.cancel(AlertCountdown.CancelReason.FALSE_TRIGGER)

        assertEquals(AlertViewModel.UiState.Idle, model.state.value)
        assertEquals(0, repository.activations)
        assertEquals(1, notifications.cancelled)
    }

    @Test
    fun `cancelling after expiry tells the user the alert is going out`() = runTest {
        val model = viewModel(this)
        model.startCountdown(5_000)

        now += 6_000
        model.cancel()

        // Showing a cancelled screen while workers receive messages would be worse.
        val state = model.state.value
        assertTrue(state is AlertViewModel.UiState.Failed)
        assertTrue((state as AlertViewModel.UiState.Failed).message.contains("already finished"))
    }

    @Test
    fun `expiry raises an alert`() = runTest {
        val model = viewModel(this)
        model.startCountdown(5_000)

        now += 6_000
        advanceTimeBy(200)

        val state = model.state.value
        assertTrue(state is AlertViewModel.UiState.Active)
        assertEquals(false, (state as AlertViewModel.UiState.Active).queued)
        assertEquals(1, repository.activations)
    }

    @Test
    fun `activation uses the key minted when the countdown started`() = runTest {
        val model = viewModel(this)
        model.startCountdown(5_000)
        val keyAtStart = repository.lastCountdownKey

        now += 6_000
        advanceTimeBy(200)

        // A crash mid-countdown and a retry after process death send the same key, so
        // five retries produce one alert rather than five.
        assertEquals(keyAtStart, repository.lastActivationKey)
    }

    @Test
    fun `activation reports the countdown expiry as the occurrence time`() = runTest {
        val model = viewModel(this)
        val start = now
        model.startCountdown(10_000)

        // The device was asleep and only woke up two minutes later.
        now += 130_000
        advanceTimeBy(200)

        // The timeline should show when it happened, not when we managed to send it.
        assertEquals(start + 10_000, repository.lastOccurredAt)
    }

    @Test
    fun `activation does not wait for a location fix that may never arrive`() = runTest {
        location.failFix = true
        val model = viewModel(this)

        model.startCountdown(5_000)
        now += 6_000
        advanceTimeBy(200)

        // An alert with no position is still an alert.
        assertTrue(model.state.value is AlertViewModel.UiState.Active)
        assertEquals(null, repository.lastLocation)
    }

    @Test
    fun `an offline activation is queued rather than failed`() = runTest {
        repository.outcome = ActivationOutcome.Queued
        val model = viewModel(this)

        model.startCountdown(5_000)
        now += 6_000
        advanceTimeBy(200)

        val state = model.state.value
        assertTrue(state is AlertViewModel.UiState.Active)
        // The user is told the alert is raised, because from their point of view it is.
        assertTrue((state as AlertViewModel.UiState.Active).queued)
    }

    @Test
    fun `a failed activation surfaces a message rather than looking successful`() = runTest {
        repository.outcome = ActivationOutcome.Failed("Could not raise the alert.")
        val model = viewModel(this)

        model.startCountdown(5_000)
        now += 6_000
        advanceTimeBy(200)

        assertTrue(model.state.value is AlertViewModel.UiState.Failed)
    }

    @Test
    fun `the ticker stops once the countdown activates`() = runTest {
        val model = viewModel(this)
        model.startCountdown(5_000)

        now += 6_000
        advanceTimeBy(200)
        val afterFirst = repository.activations

        advanceTimeBy(5_000)

        // Without breaking the loop this would activate ten times a second for ever.
        assertEquals(afterFirst, repository.activations)
    }
}

private class FakeAlertTriggerRepository : AlertTriggerRepository {
    var outcome: ActivationOutcome? = null
    var startCountdownDelayMs = 0L

    var activations = 0
        private set
    var lastCountdownKey: String? = null
        private set
    var lastActivationKey: String? = null
        private set
    var lastOccurredAt: Long? = null
        private set
    var lastLocation: LocationFix? = null
        private set

    override suspend fun startCountdown(durationSeconds: Int, idempotencyKey: String) {
        lastCountdownKey = idempotencyKey
        if (startCountdownDelayMs > 0) kotlinx.coroutines.delay(startCountdownDelayMs)
    }

    override suspend fun cancelCountdown(countdownId: String, reason: String) {}

    override suspend fun activate(
        countdownId: String,
        idempotencyKey: String,
        location: LocationFix?,
        occurredAtMillis: Long,
    ): ActivationOutcome {
        lastActivationKey = idempotencyKey
        lastOccurredAt = occurredAtMillis
        lastLocation = location

        outcome?.let { return it }

        activations += 1
        return ActivationOutcome.Sent("00000000-0000-4000-8000-000000000001")
    }
}

private class FakeLocationProvider : LocationProvider {
    var failFix = false

    override suspend fun currentFix(): LocationFix {
        if (failFix) throw IllegalStateException("no fix available")
        return LocationFix(53.5, 3.2, 10.0, 0L)
    }

    override fun startStreaming(alertId: String) {}
    override fun stopStreaming() {}
}

private class FakeNotificationScheduler : NotificationScheduler {
    var scheduled = 0
        private set
    var cancelled = 0
        private set

    override fun scheduleCountdownNotification(expiresAtMillis: Long) { scheduled += 1 }
    override fun cancelCountdownNotification() { cancelled += 1 }
}
