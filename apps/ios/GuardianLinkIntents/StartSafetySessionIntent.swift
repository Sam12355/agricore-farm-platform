import AppIntents
import Foundation

/// Starting a safety session from Siri, Shortcuts, or the Action button.
///
/// The point of exposing this as an intent: at the moment somebody most wants to start a
/// session, taking the phone out, unlocking it and finding the app is exactly what they do
/// not want to do. "Hey Siri, start a safety session" works with the phone in a pocket.
///
/// Deliberately **not** an intent: raising an SOS. A voice-triggered alert has no cancel
/// window that works in the situation it is for, it can be triggered by a television, and
/// it would notify somebody's family because a phrase happened to be said nearby. The
/// countdown exists precisely so an alert is never one utterance away.
struct StartSafetySessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a safety session"

    static var description = IntentDescription(
        """
        Starts a GuardianLink safety session. If you do not end it in time, your trusted \
        contacts are told. GuardianLink is a demonstration and does not contact emergency \
        services.
        """,
        categoryName: "Safety"
    )

    /// Runs without bringing the app to the foreground. That is the whole value here.
    static var openAppWhenRun: Bool = false

    @Parameter(
        title: "Expected duration",
        description: "How long you expect to be out, in minutes.",
        default: 30,
        inclusiveRange: (5, 480)
    )
    var durationMinutes: Int

    @Parameter(
        title: "Where are you going",
        description: "Optional. Shown to an operator if the session goes overdue.",
        requestValueDialog: "Where are you heading?"
    )
    var destination: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Start a safety session for \(\.$durationMinutes) minutes") {
            \.$destination
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let container = AppContainer.shared

        guard try container.credentials.loadSession() != nil else {
            // No account, so nothing useful can happen silently. Say so rather than
            // failing quietly, because the user believes a session has started.
            throw StartSafetySessionError.notSignedIn
        }

        do {
            let session = try await container.sessions.start(
                expectedDurationMinutes: durationMinutes,
                destination: destination
            )

            // Written to the app group so the widget reflects it immediately rather than
            // at its next refresh.
            container.sharedState.write(
                status: "active",
                expectedEndAt: session.expectedEndAt,
                destination: destination
            )

            let ending = session.expectedEndAt.formatted(date: .omitted, time: .shortened)

            return .result(
                dialog: IntentDialog(
                    "Safety session started. If you have not ended it by \(ending), your trusted contacts will be told."
                )
            )
        } catch ApiError.offline {
            // A session that exists only on the device is not a safety session: nothing
            // server-side would notice it going overdue. Better to say so.
            throw StartSafetySessionError.offline
        }
    }
}

/// Ending a session. The counterpart, and the one people forget to build.
struct EndSafetySessionIntent: AppIntent {
    static var title: LocalizedStringResource = "End my safety session"
    static var description = IntentDescription("Ends the running GuardianLink safety session.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let container = AppContainer.shared

        guard let active = try await container.sessions.activeSession() else {
            return .result(dialog: IntentDialog("You do not have a safety session running."))
        }

        try await container.sessions.end(sessionId: active.id, outcome: "arrived_safely")
        container.sharedState.write(status: "none", expectedEndAt: nil, destination: nil)

        return .result(dialog: IntentDialog("Safety session ended. Glad you arrived."))
    }
}

enum StartSafetySessionError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case offline

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            return "Open GuardianLink and sign in first."
        case .offline:
            return "There is no connection, so the session could not be registered. Try again when you have signal."
        }
    }
}

/// Makes both intents discoverable in Shortcuts without the user building anything.
struct GuardianLinkShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartSafetySessionIntent(),
            phrases: [
                "Start a safety session in \(.applicationName)",
                "\(.applicationName) walk me home",
                "Watch out for me with \(.applicationName)",
            ],
            shortTitle: "Start session",
            systemImageName: "shield.checkerboard"
        )

        AppShortcut(
            intent: EndSafetySessionIntent(),
            phrases: [
                "End my safety session in \(.applicationName)",
                "I arrived safely in \(.applicationName)",
            ],
            shortTitle: "End session",
            systemImageName: "checkmark.shield"
        )
    }
}
