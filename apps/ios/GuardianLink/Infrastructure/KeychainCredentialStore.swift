import Foundation
import Security

/// Session storage in the Keychain.
///
/// Not UserDefaults. UserDefaults is a plist in the app container, readable from a backup
/// and from any process that can reach the container, and it is where a surprising number
/// of apps keep their tokens.
///
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` is doing two things. `AfterFirstUnlock`
/// so the background sync worker can reach the token when the phone is locked, which it has
/// to be able to do or a queued alert never flushes. `ThisDeviceOnly` so the token does not
/// travel to a new device in an encrypted backup: a restored backup should require signing
/// in again.
final class KeychainCredentialStore: CredentialStore {
    private let service: String
    private let account = "session"

    init(service: String = "com.guardianlink.session") {
        self.service = service
    }

    enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
        case decodingFailed
    }

    func store(session: AuthSession) throws {
        let data = try JSONEncoder().encode(session)

        // Delete first rather than using SecItemUpdate. Update has to handle the
        // not-found case anyway, so this is one code path instead of two.
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }

    func loadSession() throws -> AuthSession? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unexpectedStatus(status)
        }

        do {
            return try JSONDecoder().decode(AuthSession.self, from: data)
        } catch {
            // A stored session we cannot decode is worse than no session: it will fail on
            // every launch. Clear it and make the user sign in again.
            try? clear()
            throw KeychainError.decodingFailed
        }
    }

    func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }
}

/// In-memory store for tests and previews. Never reachable from a running app.
final class InMemoryCredentialStore: CredentialStore {
    private var session: AuthSession?

    init(session: AuthSession? = nil) {
        self.session = session
    }

    func store(session: AuthSession) throws { self.session = session }
    func loadSession() throws -> AuthSession? { session }
    func clear() throws { session = nil }
}
