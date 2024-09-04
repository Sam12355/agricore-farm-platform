package com.agricore.infrastructure.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.agricore.data.local.QueuedOperationDao
import java.util.concurrent.TimeUnit

/**
 * Drains the offline queue.
 *
 * WorkManager rather than a coroutine on an application scope, and the difference matters:
 * a queued alert has to survive process death, the app being swiped out of recents, and a
 * reboot. A coroutine survives none of those. A queued alert that only sends while the app
 * is foregrounded is not a queued alert.
 *
 * The network constraint means the system wakes this when connectivity returns rather than
 * having the app poll, which is both faster and cheaper on battery.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
    private val queue: QueuedOperationDao,
    private val sender: QueuedOperationSender,
    private val clock: () -> Long,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val batch = queue.nextBatch(now = clock(), limit = BATCH_SIZE)
        if (batch.isEmpty()) return Result.success()

        var sent = 0
        var failed = 0

        for (operation in batch) {
            when (val outcome = sender.send(operation)) {
                is SendOutcome.Sent -> {
                    queue.delete(operation.id)
                    sent += 1
                }

                is SendOutcome.PermanentlyRejected -> {
                    // The server refused it and will keep refusing it. Retrying wastes the
                    // budget and delays the point at which the user is told it failed.
                    queue.recordFailure(operation.id, outcome.reason, clock())
                    queue.delete(operation.id)
                    failed += 1
                }

                is SendOutcome.Retryable -> {
                    queue.recordFailure(operation.id, outcome.reason, clock())
                    failed += 1
                }
            }
        }

        // A full batch means there is probably more. Asking for a retry rather than
        // looping here keeps each run short, which is what WorkManager expects and what
        // stops a long drain being killed halfway.
        return when {
            failed > 0 -> Result.retry()
            sent == BATCH_SIZE -> Result.retry()
            else -> Result.success()
        }
    }

    companion object {
        private const val BATCH_SIZE = 10
        const val UNIQUE_NAME = "agricore-sync"

        /**
         * Enqueued after any operation is written to the queue, and on boot.
         *
         * `KEEP` rather than `REPLACE`: replacing an already-scheduled drain restarts its
         * backoff, so an app that queues several operations in quick succession would
         * repeatedly push its own retry further away.
         */
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .addTag(UNIQUE_NAME)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, request)
        }
    }
}

sealed interface SendOutcome {
    data class Sent(val serverId: String?) : SendOutcome
    data class Retryable(val reason: String) : SendOutcome
    data class PermanentlyRejected(val reason: String) : SendOutcome
}

/**
 * Sends one queued operation.
 *
 * The implementation reads the idempotency key off the operation rather than generating
 * one, which is what makes a retry after process death produce a single alert.
 */
interface QueuedOperationSender {
    suspend fun send(operation: com.agricore.data.local.QueuedOperationEntity): SendOutcome
}
