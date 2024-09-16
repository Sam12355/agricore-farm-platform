import Foundation
import UIKit

/// The API client.
///
/// URLSession is confined to this file. Nothing else in the app imports it, which is why
/// the test target has no network stubs: the tests inject a `FakeApiClient` conforming to
/// the same protocol.
///
/// Two behaviours worth reading:
///
///   - **Token refresh is serialised.** Five requests failing with 401 at once must produce
///     one refresh, not five. Without that, four of them present an already-rotated refresh
///     token, the server sees reuse, and it revokes the whole family. The app logs itself
///     out for doing the obvious thing.
///
///   - **No connectivity is not an error.** It is `ApiError.offline`, and the caller queues
///     rather than showing a failure. That distinction is what makes the app work on the
///     underground.
actor HttpApiClient: ApiClient {
    private let baseURL: URL
    private let session: URLSession
    private let credentials: CredentialStore
    private let clock: Clock

    /// The in-flight refresh, if there is one. Everybody waits on the same task.
    private var refreshTask: Task<AuthSession, Error>?

    init(baseURL: URL, session: URLSession = .shared, credentials: CredentialStore, clock: Clock) {
        self.baseURL = baseURL
        self.session = session
        self.credentials = credentials
        self.clock = clock
    }

    // MARK: - Identity

    func register(email: String, password: String, displayName: String) async throws -> AuthSession {
        let response: AuthResponse = try await send(
            .post,
            "/api/v1/auth/register",
            body: [
                "email": email,
                "password": password,
                "displayName": displayName,
                "acceptedDemoNotice": true,
            ],
            authenticated: false
        )
        return try persist(response)
    }

    func login(email: String, password: String) async throws -> AuthSession {
        let response: AuthResponse = try await send(
            .post,
            "/api/v1/auth/login",
            body: ["email": email, "password": password, "deviceName": deviceName()],
            authenticated: false
        )
        return try persist(response)
    }

    func refresh(refreshToken: String) async throws -> AuthSession {
        let response: AuthResponse = try await send(
            .post,
            "/api/v1/auth/refresh",
            body: ["refreshToken": refreshToken],
            authenticated: false
        )
        return try persist(response)
    }

    // MARK: - Assigned workers

    func listWorkers() async throws -> [Worker] {
        let page: Page<Worker> = try await send(.get, "/api/v1/workers")
        return page.items
    }

    func addWorker(_ worker: NewWorker) async throws -> Worker {
        try await send(
            .post,
            "/api/v1/workers",
            body: [
                "name": worker.name,
                "email": worker.email as Any,
                "phone": worker.phone as Any,
                "jobRole": worker.jobRole as Any,
                "priority": worker.priority,
            ].compactMapValues { $0 is NSNull ? nil : $0 }
        )
    }

    func removeWorker(id: UUID) async throws {
        let _: EmptyResponse = try await send(.delete, "/api/v1/workers/\(id.uuidString.lowercased())")
    }

    // MARK: - Alerts

    func startCountdown(durationSeconds: Int, idempotencyKey: String) async throws -> CountdownResponse {
        try await send(
            .post,
            "/api/v1/alerts/countdown",
            body: ["durationSeconds": durationSeconds, "activationIdempotencyKey": idempotencyKey]
        )
    }

    func cancelCountdown(id: UUID, reason: String) async throws {
        let _: EmptyResponse = try await send(
            .post,
            "/api/v1/alerts/countdown/\(id.uuidString.lowercased())/cancel",
            body: ["reason": reason]
        )
    }

    func activateAlert(
        countdownId: UUID?,
        trigger: String,
        location: LocationFix?,
        occurredAt: Date?,
        idempotencyKey: String
    ) async throws -> Alert {
        var body: [String: Any] = ["trigger": trigger]
        if let countdownId { body["countdownId"] = countdownId.uuidString.lowercased() }
        if let occurredAt { body["occurredAt"] = ISO8601DateFormatter.agriCore.string(from: occurredAt) }
        if let location {
            body["location"] = [
                "latitude": location.latitude,
                "longitude": location.longitude,
                "accuracyMetres": location.accuracyMetres,
                "capturedAt": ISO8601DateFormatter.agriCore.string(from: location.capturedAt),
            ]
        }

        let wrapper: ActivationResponse = try await send(
            .post,
            "/api/v1/alerts/activate",
            body: body,
            // The key comes from the queued operation, not from here. The same operation
            // retried after a relaunch must send the same key.
            idempotencyKey: idempotencyKey
        )
        return wrapper.alert
    }

    func recordLocation(alertId: UUID, points: [LocationFix]) async throws {
        let _: LocationAccepted = try await send(
            .post,
            "/api/v1/alerts/\(alertId.uuidString.lowercased())/location",
            body: [
                "points": points.map { point in
                    [
                        "latitude": point.latitude,
                        "longitude": point.longitude,
                        "accuracyMetres": point.accuracyMetres,
                        "capturedAt": ISO8601DateFormatter.agriCore.string(from: point.capturedAt),
                    ]
                },
            ]
        )
    }

    func resolveAlert(alertId: UUID, resolution: String, expectedVersion: Int) async throws -> Alert {
        try await send(
            .post,
            "/api/v1/alerts/\(alertId.uuidString.lowercased())/resolve",
            body: ["resolution": resolution, "expectedVersion": expectedVersion]
        )
    }

    func alertTimeline(alertId: UUID, afterSequence: Int) async throws -> AlertTimeline {
        try await send(
            .get,
            "/api/v1/alerts/\(alertId.uuidString.lowercased())/timeline?after=\(afterSequence)"
        )
    }

    // MARK: - Transport

    private enum Method: String {
        case get = "GET"
        case post = "POST"
        case delete = "DELETE"
    }

    private func send<T: Decodable>(
        _ method: Method,
        _ path: String,
        body: [String: Any]? = nil,
        authenticated: Bool = true,
        idempotencyKey: String? = nil,
        isRetry: Bool = false
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw ApiError.validation(message: "Malformed path \(path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }

        if authenticated {
            let session = try await validSession()
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where Self.offlineCodes.contains(error.code) {
            // Not a failure the user should see. The caller queues.
            throw ApiError.offline
        }

        guard let http = response as? HTTPURLResponse else {
            throw ApiError.server(status: 0, correlationId: nil)
        }

        let correlationId = http.value(forHTTPHeaderField: "X-Correlation-Id")

        switch http.statusCode {
        case 200 ..< 300:
            if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T { return empty }
            return try JSONDecoder.agriCore.decode(T.self, from: data)

        case 401 where authenticated && !isRetry:
            // One retry, after a refresh. isRetry stops an infinite loop when the refresh
            // itself keeps producing a token the server rejects.
            _ = try await refreshSession()
            return try await send(method, path, body: body, authenticated: authenticated,
                                  idempotencyKey: idempotencyKey, isRetry: true)

        case 401:
            try? credentials.clear()
            throw ApiError.unauthenticated

        case 403:
            throw ApiError.forbidden

        case 404:
            throw ApiError.notFound

        case 409:
            let decoded = try? JSONDecoder.agriCore.decode(ErrorEnvelope.self, from: data)
            throw ApiError.conflict(currentVersion: decoded?.error.details?.currentVersion)

        case 429:
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init) ?? 30
            throw ApiError.rateLimited(retryAfter: retryAfter)

        case 400, 422:
            let decoded = try? JSONDecoder.agriCore.decode(ErrorEnvelope.self, from: data)
            throw ApiError.validation(message: decoded?.error.message ?? "That request was not valid.")

        default:
            throw ApiError.server(status: http.statusCode, correlationId: correlationId)
        }
    }

    private static let offlineCodes: Set<URLError.Code> = [
        .notConnectedToInternet, .networkConnectionLost, .timedOut,
        .dataNotAllowed, .internationalRoamingOff, .cannotConnectToHost,
    ]

    private func validSession() async throws -> AuthSession {
        guard let session = try credentials.loadSession() else { throw ApiError.unauthenticated }
        // Refresh a minute early. A token that expires mid-request produces a 401 the user
        // sees, and the whole class of problem is avoidable.
        guard session.needsRefresh(at: clock.now()) else { return session }
        return try await refreshSession()
    }

    /// Serialised refresh. Concurrent callers await the same task.
    private func refreshSession() async throws -> AuthSession {
        if let existing = refreshTask { return try await existing.value }

        let task = Task<AuthSession, Error> {
            guard let current = try credentials.loadSession() else { throw ApiError.unauthenticated }
            return try await refresh(refreshToken: current.refreshToken)
        }

        refreshTask = task
        defer { refreshTask = nil }

        return try await task.value
    }

    private func persist(_ response: AuthResponse) throws -> AuthSession {
        let session = AuthSession(
            userId: response.user.id,
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
            expiresAt: clock.now().addingTimeInterval(TimeInterval(response.tokens.expiresIn)),
            displayName: response.user.displayName
        )
        try credentials.store(session: session)
        return session
    }

    private func deviceName() -> String {
        // The model, never the user-assigned device name, which is often a person's name.
        UIDevice.current.model
    }
}

// MARK: - Wire types

private struct AuthResponse: Decodable {
    struct User: Decodable {
        let id: UUID
        let displayName: String
    }

    struct Tokens: Decodable {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int
    }

    let user: User
    let tokens: Tokens
}

private struct ActivationResponse: Decodable {
    let alert: Alert
}

private struct LocationAccepted: Decodable {
    let accepted: Int
}

private struct Page<T: Decodable>: Decodable {
    let items: [T]
}

private struct EmptyResponse: Decodable {}

private struct ErrorEnvelope: Decodable {
    struct Body: Decodable {
        struct Details: Decodable {
            let currentVersion: Int?
        }

        let code: String
        let message: String
        let details: Details?
    }

    let error: Body
}

extension ISO8601DateFormatter {
    static let agriCore: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

extension JSONDecoder {
    static let agriCore: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)

            // The API always sends fractional seconds, but a date without them is valid
            // ISO 8601 and a decoder that only accepts one form fails on a field somebody
            // formats slightly differently later.
            if let date = ISO8601DateFormatter.agriCore.date(from: raw) { return date }

            let fallback = ISO8601DateFormatter()
            fallback.formatOptions = [.withInternetDateTime]
            if let date = fallback.date(from: raw) { return date }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Not an ISO 8601 timestamp: \(raw)"
            )
        }
        return decoder
    }()
}
