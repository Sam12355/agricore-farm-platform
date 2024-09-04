package com.agricore.data.local

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import kotlinx.serialization.json.Json

/**
 * The offline operation queue, in Room.
 *
 * A safety app that only works with a signal is not a safety app. Every operation that
 * changes server state is written here first and sent afterwards, so raising an alert in a
 * car park with no bars records the intent and delivers it when signal returns.
 *
 * Three rules make replay safe, and they match the iOS implementation exactly:
 *
 *   1. The idempotency key is minted when the operation is created, so a retry after
 *      process death produces one alert rather than several.
 *   2. `createdAt` is when the user did the thing, not when we managed to send it. A
 *      backlog flushed twenty minutes late must not look like it happened twenty minutes
 *      late.
 *   3. Activation is ordered ahead of everything else for the same alert, because a
 *      location update sent before the activation that created the alert would be
 *      rejected and retried until its budget ran out.
 */
@Entity(tableName = "queued_operations")
data class QueuedOperationEntity(
    @PrimaryKey val id: String,
    val kind: String,
    /** JSON payload. Kept opaque here so adding an operation type needs no migration. */
    val payload: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    @ColumnInfo(name = "idempotency_key") val idempotencyKey: String,
    /** Lower runs first. Activation is 0. */
    val priority: Int,
    val attempts: Int = 0,
    @ColumnInfo(name = "last_attempt_at") val lastAttemptAt: Long? = null,
    @ColumnInfo(name = "last_error") val lastError: String? = null,
)

@Dao
interface QueuedOperationDao {

    @Insert
    suspend fun insert(operation: QueuedOperationEntity)

    /**
     * The next batch to send.
     *
     * Ordered by priority then by creation time, and filtered to operations whose backoff
     * has elapsed. The backoff arithmetic is in the query rather than in Kotlin so a large
     * queue does not have to be loaded into memory to find the few rows that are due.
     */
    @Query(
        """
        SELECT * FROM queued_operations
         WHERE attempts < :maxAttempts
           AND (
                last_attempt_at IS NULL
                OR :now - last_attempt_at >= MIN(:maxBackoffMs, :baseBackoffMs * (1 << (attempts - 1)))
           )
         ORDER BY priority ASC, created_at ASC
         LIMIT :limit
        """,
    )
    suspend fun nextBatch(
        now: Long,
        limit: Int = 10,
        maxAttempts: Int = MAX_ATTEMPTS,
        baseBackoffMs: Long = BASE_BACKOFF_MS,
        maxBackoffMs: Long = MAX_BACKOFF_MS,
    ): List<QueuedOperationEntity>

    @Query("DELETE FROM queued_operations WHERE id = :id")
    suspend fun delete(id: String)

    @Query(
        """
        UPDATE queued_operations
           SET attempts = attempts + 1, last_attempt_at = :at, last_error = :error
         WHERE id = :id
        """,
    )
    suspend fun recordFailure(id: String, error: String, at: Long)

    /**
     * Operations that will never be sent.
     *
     * Surfaced to the user rather than dropped silently. Somebody who triggered an alert
     * believes it was raised, and if it was not they need to know.
     */
    @Query("SELECT * FROM queued_operations WHERE attempts >= :maxAttempts")
    suspend fun exhausted(maxAttempts: Int = MAX_ATTEMPTS): List<QueuedOperationEntity>

    @Query("SELECT COUNT(*) FROM queued_operations")
    suspend fun pendingCount(): Int

    /** Called on sign-out. Queued operations belong to the account that created them. */
    @Query("DELETE FROM queued_operations")
    suspend fun clear()

    companion object {
        const val MAX_ATTEMPTS = 8
        const val BASE_BACKOFF_MS = 2_000L
        const val MAX_BACKOFF_MS = 300_000L
    }
}

@Entity(tableName = "cached_alerts")
data class CachedAlertEntity(
    @PrimaryKey val id: String,
    val status: String,
    val priority: String,
    @ColumnInfo(name = "activated_at") val activatedAt: Long,
    val version: Int,
    /**
     * Highest timeline sequence applied. Sent on reconnect so the server replays only the
     * gap. Ordering is by sequence, never by timestamp: device clocks are wrong and mobile
     * networks deliver out of order.
     */
    @ColumnInfo(name = "applied_sequence") val appliedSequence: Int = 0,
)

@Dao
interface AlertDao {
    @Query("SELECT * FROM cached_alerts WHERE status IN ('active', 'acknowledged') ORDER BY activated_at DESC")
    suspend fun openAlerts(): List<CachedAlertEntity>

    @Query("SELECT * FROM cached_alerts WHERE id = :id")
    suspend fun byId(id: String): CachedAlertEntity?

    @Insert(onConflict = androidx.room.OnConflictStrategy.REPLACE)
    suspend fun upsert(alert: CachedAlertEntity)

    @Query("DELETE FROM cached_alerts")
    suspend fun clear()
}

class QueueConverters {
    @TypeConverter
    fun toMap(value: String): Map<String, String> =
        if (value.isBlank()) emptyMap() else Json.decodeFromString(value)

    @TypeConverter
    fun fromMap(value: Map<String, String>): String = Json.encodeToString(value)
}

@Database(
    entities = [QueuedOperationEntity::class, CachedAlertEntity::class],
    version = 1,
    // Schemas are exported and committed, so a migration can be diffed rather than
    // guessed at.
    exportSchema = true,
)
@TypeConverters(QueueConverters::class)
abstract class AgriCoreDatabase : RoomDatabase() {
    abstract fun queuedOperations(): QueuedOperationDao
    abstract fun alerts(): AlertDao

    companion object {
        const val NAME = "agricore.db"
    }
}
