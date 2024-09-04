import AppIntents
import Foundation

/// Starting a field operation from Siri, Shortcuts, or the Action button.
///
/// The point of exposing this as an intent: at the moment somebody most wants to start an
/// operation, they are climbing into a cab with gloves on. Taking the phone out, unlocking
/// it and finding the app is exactly what they will not do. "Hey Siri, start a field
/// operation" works with the phone still in a pocket.
///
/// Deliberately **not** an intent: raising an alert. A voice-triggered alert has no cancel
/// window that works in the situation it is for, it can be set off by a radio in the cab,
/// and it would call out the whole crew because a phrase happened to be said nearby. The
/// countdown exists precisely so an alert is never one utterance away.
struct StartFieldOperationIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a field operation"

    static var description = IntentDescription(
        """
        Starts an AgriCore field operation. If you do not end it in time, the workers \
        assigned to the farm are told. AgriCore is a demonstration and is not connected \
        to any real farm.
        """,
        categoryName: "Operations"
    )

    /// Runs without bringing the app to the foreground. That is the whole value here.
    static var openAppWhenRun: Bool = false

    @Parameter(
        title: "Expected duration",
        description: "How long the job should take, in minutes.",
        default: 30,
        inclusiveRange: (5, 480)
    )
    var durationMinutes: Int

    @Parameter(
        title: "Which block",
        description: "Optional. Shown to a manager if the operation goes overdue.",
        requestValueDialog: "Which block are you working?"
    )
    var destination: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Start a field operation for \(\.$durationMinutes) minutes") {
            \.$destination
        }
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let container = AppContainer.shared

        guard try container.credentials.loadSession() != nil else {
            // No account, so nothing useful can happen silently. Say so rather than
            // failing quietly, because the worker believes an operation has started.
            throw StartFieldOperationError.notSignedIn
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
                    "Field operation started. If you have not ended it by \(ending), your assigned workers will be told."
                )
            )
        } catch ApiError.offline {
            // A session that exists only on the device is not a field operation: nothing
            // server-side would notice it going overdue. Better to say so.
            throw StartFieldOperationError.offline
        }
    }
}

/// Ending a session. The counterpart, and the one people forget to build.
struct EndFieldOperationIntent: AppIntent {
    static var title: LocalizedStringResource = "End my field operation"
    static var description = IntentDescription("Ends the running AgriCore field operation.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let container = AppContainer.shared

        guard let active = try await container.sessions.activeSession() else {
            return .result(dialog: IntentDialog("You do not have a field operation running."))
        }

        try await container.sessions.end(sessionId: active.id, outcome: "finished")
        container.sharedState.write(status: "none", expectedEndAt: nil, destination: nil)

        return .result(dialog: IntentDialog("Field operation ended."))
    }
}

enum StartFieldOperationError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case offline

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            return "Open AgriCore and sign in first."
        case .offline:
            return "There is no connection, so the session could not be registered. Try again when you have signal."
        }
    }
}

/// Makes both intents discoverable in Shortcuts without the user building anything.
struct AgriCoreShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartFieldOperationIntent(),
            phrases: [
                "Start a field operation in \(.applicationName)",
                "\(.applicationName) start a field operation",
                "Log a job with \(.applicationName)",
            ],
            shortTitle: "Start operation",
            systemImageName: "leaf"
        )

        AppShortcut(
            intent: EndFieldOperationIntent(),
            phrases: [
                "End my field operation in \(.applicationName)",
                "Mark the job finished in \(.applicationName)",
            ],
            shortTitle: "End operation",
            systemImageName: "checkmark.circle"
        )
    }
}
