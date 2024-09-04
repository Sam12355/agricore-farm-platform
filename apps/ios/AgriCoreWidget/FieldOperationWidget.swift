import SwiftUI
import WidgetKit

/// Home-screen widget showing the current field operation.
///
/// It shows **session status only, never live alert state**, and that is a deliberate
/// trade-off rather than an omission.
///
/// A widget refreshing during an active alert would mean the system waking the
/// extension every few minutes to fetch a position, which costs battery at the exact
/// moment the phone most needs it, and puts a live location on a home screen that anybody
/// glancing over a shoulder can read. Neither is worth the convenience.
///
/// So the widget answers one question: is a field operation running, and when is it due to
/// end. Everything else is in the app, behind the lock screen.
struct FieldOperationWidget: Widget {
    let kind = "FieldOperationWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FieldOperationProvider()) { entry in
            FieldOperationView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Field operation")
        .description("Shows whether a field operation is running and when it is due to end.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct FieldOperationEntry: TimelineEntry {
    let date: Date
    let status: Status
    let expectedEndAt: Date?
    let destination: String?

    enum Status: String {
        case none
        case active
        case overdue
    }

    static let placeholder = FieldOperationEntry(
        date: Date(),
        status: .active,
        expectedEndAt: Date().addingTimeInterval(1_800),
        destination: "Evening class"
    )
}

/// Reads from the shared app group container.
///
/// The extension does not call the API. It reads what the app last wrote, which keeps the
/// widget cheap and means it cannot leak a token: the app group holds session status and
/// nothing else, no credentials and no coordinates.
struct FieldOperationProvider: TimelineProvider {
    private static let appGroup = "group.com.agricore"

    func placeholder(in context: Context) -> FieldOperationEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (FieldOperationEntry) -> Void) {
        completion(context.isPreview ? .placeholder : currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FieldOperationEntry>) -> Void) {
        let entry = currentEntry()

        // Refresh policy is driven by the session, not by a fixed interval. With no session
        // there is nothing to show and nothing to refresh for, so the widget asks to be
        // left alone rather than waking hourly to display "no session".
        let policy: TimelineReloadPolicy

        switch entry.status {
        case .none:
            policy = .never
        case .active:
            // Once at the expected end, plus a light cadence so the countdown stays roughly
            // right without waking every minute.
            let next = min(entry.expectedEndAt ?? .distantFuture, Date().addingTimeInterval(900))
            policy = .after(next)
        case .overdue:
            policy = .after(Date().addingTimeInterval(300))
        }

        completion(Timeline(entries: [entry], policy: policy))
    }

    private func currentEntry() -> FieldOperationEntry {
        guard let defaults = UserDefaults(suiteName: Self.appGroup) else {
            return FieldOperationEntry(date: Date(), status: .none, expectedEndAt: nil, destination: nil)
        }

        let raw = defaults.string(forKey: "session.status") ?? "none"
        let endAt = defaults.object(forKey: "session.expectedEndAt") as? Date
        let destination = defaults.string(forKey: "session.destination")

        let status: FieldOperationEntry.Status = {
            guard let parsed = FieldOperationEntry.Status(rawValue: raw) else { return .none }
            guard parsed == .active, let endAt, endAt < Date() else { return parsed }
            // The app may not have run since the session went overdue, so the widget works
            // it out rather than showing a stale "active".
            return .overdue
        }()

        return FieldOperationEntry(
            date: Date(),
            status: status,
            expectedEndAt: endAt,
            destination: destination
        )
    }
}

struct FieldOperationView: View {
    let entry: FieldOperationEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(tint)

            if let destination = entry.destination, entry.status != .none {
                Text(destination)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let endAt = entry.expectedEndAt, entry.status != .none {
                Text(endAt, style: .relative)
                    .font(.caption)
                    .monospacedDigit()
            }

            Spacer(minLength: 0)

            Text("Demonstration only")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // The whole widget is one accessibility element with a sentence, rather than four
        // fragments a screen reader reads out separately.
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityDescription)
    }

    private var title: String {
        switch entry.status {
        case .none: return "No session"
        case .active: return "Session running"
        case .overdue: return "Session overdue"
        }
    }

    private var icon: String {
        switch entry.status {
        case .none: return "shield"
        case .active: return "shield.checkerboard"
        case .overdue: return "exclamationmark.shield"
        }
    }

    /// Never colour alone. The icon and the wording both change with the state.
    private var tint: Color {
        switch entry.status {
        case .none: return .secondary
        case .active: return .green
        case .overdue: return .orange
        }
    }

    private var accessibilityDescription: String {
        switch entry.status {
        case .none:
            return "No field operation is running."
        case .active:
            let destination = entry.destination.map { " to \($0)" } ?? ""
            return "A field operation\(destination) is running."
        case .overdue:
            return "A field operation is overdue. Open AgriCore to check in."
        }
    }
}
