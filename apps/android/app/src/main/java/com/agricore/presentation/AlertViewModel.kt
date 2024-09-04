package com.agricore.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.agricore.domain.AlertCountdown
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The alert screen state.
 *
 * Deliberately the same shape as the iOS view model. Both platforms hold the countdown as
 * a value type, take time as a parameter, and treat "no connectivity" as a queued success
 * rather than a failure. Divergence between the two is the thing most likely to produce a
 * bug that only appears on one platform and that nobody reproduces.
 *
 * Nothing here imports Android beyond ViewModel, so the whole flow is a plain JVM test
 * with a virtual-time scheduler: no Robolectric, no instrumentation, and no waiting.
 */
class AlertViewModel(
    private val repository: AlertTriggerRepository,
    private val location: LocationProvider,
    private val notifications: NotificationScheduler,
    private val clock: () -> Long,
    private val scope: CoroutineScope? = null,
) : ViewModel() {

    sealed interface UiState {
        data object Idle : UiState

        data class CountingDown(
            val remainingMillis: Long,
            val progress: Float,
            val canCancel: Boolean = true,
        ) : UiState

        data object Activating : UiState

        data class Active(val alertId: String, val queued: Boolean) : UiState

        data class Failed(val message: String) : UiState
    }

    private val _state = MutableStateFlow<UiState>(UiState.Idle)
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var countdown: AlertCountdown? = null
    private var ticker: Job? = null

    private val workScope: CoroutineScope get() = scope ?: viewModelScope

    /**
     * Starts locally and immediately.
     *
     * The server is told afterwards, and failing to tell it does not stop the countdown.
     * Somebody holding the button with no signal must still get the cancel window and
     * still raise the alert when signal returns.
     */
    fun startCountdown(durationMillis: Long = AlertCountdown.DEFAULT_DURATION_MS) {
        val started = AlertCountdown(startedAt = clock(), durationMillis = durationMillis)
        countdown = started

        emitCountingDown(started, clock())
        notifications.scheduleCountdownNotification(started.expiresAt)

        workScope.launch {
            runCatching {
                repository.startCountdown(
                    durationSeconds = (durationMillis / 1000).toInt(),
                    idempotencyKey = started.activationIdempotencyKey,
                )
            }
        }

        ticker = workScope.launch {
            while (true) {
                delay(TICK_INTERVAL_MS)
                val current = countdown ?: break
                if (current.status != AlertCountdown.Status.PENDING) break

                val now = clock()
                if (current.hasExpired(now)) {
                    activate(current)
                    break
                }
                emitCountingDown(current, now)
            }
        }
    }

    fun cancel(reason: AlertCountdown.CancelReason = AlertCountdown.CancelReason.USER_CANCELLED) {
        val current = countdown ?: return

        when (val result = current.cancel(reason, clock())) {
            is AlertCountdown.CancelResult.Cancelled -> {
                countdown = result.countdown
                ticker?.cancel()
                notifications.cancelCountdownNotification()
                _state.value = UiState.Idle

                workScope.launch {
                    runCatching { repository.cancelCountdown(current.id.toString(), reason.wireValue) }
                }
            }

            AlertCountdown.CancelResult.AlreadyExpired -> {
                // The window closed while the tap was in flight. The user is told the
                // truth rather than shown a cancelled screen while workers are messaged.
                _state.value = UiState.Failed(
                    "The countdown already finished. Your workers are being told.",
                )
            }

            is AlertCountdown.CancelResult.AlreadyActivated -> {
                _state.value = UiState.Active(
                    alertId = result.alertId?.toString() ?: current.id.toString(),
                    queued = false,
                )
            }
        }
    }

    private suspend fun activate(current: AlertCountdown) {
        _state.value = UiState.Activating
        notifications.cancelCountdownNotification()

        // Best effort. An alert with no position is still an alert, and waiting for a fix
        // that may never arrive would delay it indefinitely.
        val fix = runCatching { location.currentFix() }.getOrNull()

        val outcome = repository.activate(
            countdownId = current.id.toString(),
            idempotencyKey = current.activationIdempotencyKey,
            location = fix,
            // The expiry, not now. A backlog flushed twenty minutes late did not happen
            // twenty minutes late.
            occurredAtMillis = current.expiresAt,
        )

        _state.value = when (outcome) {
            is ActivationOutcome.Sent -> {
                countdown = current.markActivated(UUID.fromString(outcome.alertId))
                location.startStreaming(outcome.alertId)
                UiState.Active(outcome.alertId, queued = false)
            }

            // The important branch. The intent is recorded and the sync worker sends it
            // when connectivity returns, carrying the same idempotency key.
            is ActivationOutcome.Queued -> UiState.Active(current.id.toString(), queued = true)

            is ActivationOutcome.Failed -> UiState.Failed(outcome.message)
        }
    }

    private fun emitCountingDown(current: AlertCountdown, now: Long) {
        _state.value = UiState.CountingDown(
            remainingMillis = current.remainingMillis(now),
            progress = current.progress(now),
        )
    }

    override fun onCleared() {
        ticker?.cancel()
        super.onCleared()
    }

    private companion object {
        /**
         * Ten times a second. Fast enough that the ring looks smooth, slow enough that it
         * is not doing meaningful work on a phone whose battery may already be a factor.
         */
        const val TICK_INTERVAL_MS = 100L
    }
}

sealed interface ActivationOutcome {
    data class Sent(val alertId: String) : ActivationOutcome
    data object Queued : ActivationOutcome
    data class Failed(val message: String) : ActivationOutcome
}

/**
 * What the view model needs, as an interface it owns.
 *
 * The implementation writes to Room first and sends afterwards, which is what makes
 * `Queued` a normal outcome rather than an error path.
 */
interface AlertTriggerRepository {
    suspend fun startCountdown(durationSeconds: Int, idempotencyKey: String)
    suspend fun cancelCountdown(countdownId: String, reason: String)

    suspend fun activate(
        countdownId: String,
        idempotencyKey: String,
        location: LocationFix?,
        occurredAtMillis: Long,
    ): ActivationOutcome
}

interface LocationProvider {
    suspend fun currentFix(): LocationFix
    fun startStreaming(alertId: String)
    fun stopStreaming()
}

interface NotificationScheduler {
    fun scheduleCountdownNotification(expiresAtMillis: Long)
    fun cancelCountdownNotification()
}

data class LocationFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMetres: Double,
    val capturedAtMillis: Long,
)
