package com.agricore.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.Interceptor
import okhttp3.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The API surface, as Retrofit sees it.
 *
 * Request and response shapes here mirror `packages/contracts`. They are hand-written
 * rather than generated from the OpenAPI document, and that is a deliberate trade-off: a
 * generated client would be guaranteed in step, and it would also add a codegen step to
 * the Android build that has to run before the project opens. Kept in step by the contract
 * tests on the server side and by review.
 */
interface AgriCoreApi {

    @POST("api/v1/auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @POST("api/v1/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): AuthResponse

    @GET("api/v1/workers")
    suspend fun workers(): PageResponse<WorkerDto>

    @POST("api/v1/workers")
    suspend fun addWorker(@Body body: NewWorkerRequest): WorkerDto

    @POST("api/v1/alerts/countdown")
    suspend fun startCountdown(@Body body: StartCountdownRequest): CountdownResponse

    @POST("api/v1/alerts/countdown/{id}/cancel")
    suspend fun cancelCountdown(@Path("id") id: String, @Body body: CancelCountdownRequest)

    /**
     * The idempotency key is a header parameter rather than something the client generates
     * here, because the queued operation owns it. The same operation retried after process
     * death must send the same key or five retries become five alerts.
     */
    @POST("api/v1/alerts/activate")
    suspend fun activate(
        @Header("Idempotency-Key") idempotencyKey: String,
        @Body body: ActivateRequest,
    ): ActivationResponse

    @POST("api/v1/alerts/{id}/location")
    suspend fun recordLocation(@Path("id") id: String, @Body body: RecordLocationRequest)

    @POST("api/v1/alerts/{id}/resolve")
    suspend fun resolve(@Path("id") id: String, @Body body: ResolveRequest): AlertDto

    @GET("api/v1/alerts/{id}/timeline")
    suspend fun timeline(
        @Path("id") id: String,
        @Query("after") afterSequence: Int = 0,
    ): TimelineResponse
}

// --- Requests -------------------------------------------------------------------------

@Serializable
data class RegisterRequest(
    val email: String,
    val password: String,
    val displayName: String,
    // The server refuses a registration without it, so the field is not optional here
    // either. A user has to acknowledge that this is a demonstration.
    val acceptedDemoNotice: Boolean = true,
)

@Serializable
data class LoginRequest(val email: String, val password: String, val deviceName: String? = null)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class NewWorkerRequest(
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val jobRole: String? = null,
    val priority: Int = 1,
)

@Serializable
data class StartCountdownRequest(
    val durationSeconds: Int,
    val activationIdempotencyKey: String,
)

@Serializable
data class CancelCountdownRequest(val reason: String)

@Serializable
data class ActivateRequest(
    val countdownId: String? = null,
    val trigger: String = "sensor_threshold",
    val location: GeoPointDto? = null,
    /** When it happened, for a client that was offline. The server keeps this. */
    val occurredAt: String? = null,
)

@Serializable
data class RecordLocationRequest(val points: List<GeoPointDto>)

@Serializable
data class ResolveRequest(val resolution: String, val expectedVersion: Int)

// --- Responses ------------------------------------------------------------------------

@Serializable
data class AuthResponse(val user: UserDto, val tokens: TokenPairDto)

@Serializable
data class UserDto(val id: String, val displayName: String, val role: String)

@Serializable
data class TokenPairDto(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class WorkerDto(
    val id: String,
    val name: String,
    val email: String? = null,
    val phone: String? = null,
    val jobRole: String? = null,
    val priority: Int,
)

@Serializable
data class CountdownResponse(val id: String, val expiresAt: String)

@Serializable
data class ActivationResponse(val alert: AlertDto, val deduplicated: Boolean = false)

@Serializable
data class AlertDto(
    val id: String,
    val status: String,
    val priority: String,
    val activatedAt: String,
    val version: Int,
)

@Serializable
data class GeoPointDto(
    val latitude: Double,
    val longitude: Double,
    val accuracyMetres: Double,
    val capturedAt: String,
)

@Serializable
data class TimelineResponse(
    val alert: AlertDto,
    val events: List<AlertEventDto>,
    val latestSequence: Int,
)

@Serializable
data class AlertEventDto(
    val id: String,
    /** Ordering token. Sort by this, never by a timestamp. */
    val sequence: Int,
    val type: String,
    val occurredAt: String,
)

@Serializable
data class PageResponse<T>(val items: List<T>, val nextCursor: String? = null, val hasMore: Boolean = false)

@Serializable
data class ErrorEnvelope(@SerialName("error") val error: ErrorBody)

@Serializable
data class ErrorBody(
    val code: String,
    val message: String,
    val correlationId: String,
)

// --- Interceptors ---------------------------------------------------------------------

/**
 * Attaches the access token and refreshes it once on a 401.
 *
 * The refresh is serialised behind a lock. Five requests failing with 401 at once must
 * produce one refresh, not five: the extra four would present an already-rotated refresh
 * token, the server would see that as reuse, and it would revoke the whole family. The app
 * would log itself out for doing the obvious thing.
 */
class AuthInterceptor(
    private val tokens: TokenStore,
    private val refreshToken: suspend (String) -> AuthResponse?,
) : Interceptor {

    private val refreshLock = Any()

    override fun intercept(chain: Interceptor.Chain): Response {
        val access = tokens.accessToken()

        val request = chain.request().newBuilder()
            .apply { if (access != null) header("Authorization", "Bearer $access") }
            .build()

        val response = chain.proceed(request)
        if (response.code != 401 || access == null) return response

        response.close()

        val refreshed = synchronized(refreshLock) {
            // Somebody else may have refreshed while this thread waited on the lock.
            if (tokens.accessToken() != access) {
                tokens.accessToken()
            } else {
                kotlinx.coroutines.runBlocking {
                    tokens.refreshToken()?.let { current ->
                        refreshToken(current)?.also { tokens.store(it.tokens) }?.tokens?.accessToken
                    }
                }
            }
        } ?: return chain.proceed(request)

        return chain.proceed(
            chain.request().newBuilder().header("Authorization", "Bearer $refreshed").build(),
        )
    }
}

/**
 * Token storage.
 *
 * Backed by EncryptedSharedPreferences in the app, never plain preferences: those are an
 * XML file in the app data directory, and they are where a surprising number of apps keep
 * their tokens.
 */
interface TokenStore {
    fun accessToken(): String?
    fun refreshToken(): String?
    fun store(tokens: TokenPairDto)
    fun clear()
}
