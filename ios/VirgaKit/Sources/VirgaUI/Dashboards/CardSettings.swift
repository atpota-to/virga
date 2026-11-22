// Ports src/dashboards/DashboardPage.jsx (CardSettingsDialog)
//
// A card's own settings, for the ones it takes: its title (at most 60;
// empty keeps the report's name), its own period (it then stays put when
// the period at the top changes), one kind of engagement, and how many rows
// a list shows; Use the defaults clears them. Each choice is a field (the
// web's select), the title focused as it opens, and Cancel and Save are the
// dialog's foot. Saved through the dashboards' setWidgetOptions, which
// cleans them as the web does.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct CardSettings: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboardId: String
  let card: DashboardCard
  let def: WidgetDef
  let done: () -> Void
  @State private var title = ""
  @State private var period = ""
  @State private var kind = ""
  @State private var rows = ""
  @FocusState private var titleFocused: Bool

  var body: some View {
    let takes = def.options ?? []
    DialogFrame(title: "\(def.name) settings", onClose: done) {
      DialogForm {
        if takes.contains("title") {
          FieldStack("Title") {
            TextField(def.name, text: $title)
              .virgaField()
              .focused($titleFocused)
              .submitLabel(.done)
              .onSubmit { save(draft) }
              .onChange(of: title) { _, next in if next.count > Layouts.cardTitleMax { title = String(next.prefix(Layouts.cardTitleMax)) } }
              .accessibilityIdentifier("card-title")
            FieldHint("Leave it empty to keep “\(def.name)”.")
          }
        }
        if takes.contains("period") {
          FieldStack("Period") {
            picker("Period", $period, [("", "The dashboard’s period")] + Analytics.analyticsPeriods.map { ($0.key, Periods.periodWindowWord($0)) })
            FieldHint("A card with its own period stays put when the period at the top changes, and says which it is.")
          }
        }
        if takes.contains("kind") {
          FieldStack("Engagement counted") {
            picker(
              "Engagement counted", $kind,
              [("", "Likes, reposts, replies and quotes")] + Layouts.cardKinds.map { ($0, "\(WidgetParts.kindNoun[$0] ?? $0) only") })
          }
        }
        if takes.contains("rows") {
          FieldStack("Rows") {
            picker("Rows", $rows, [("", "What fits the card’s size")] + Layouts.cardRows.map { ("\($0)", "\($0)") })
          }
        }
        // A reset is a link action, under the fields it clears, so the foot
        // keeps to Cancel and Save.
        if card.options.map({ $0.jsonValue != .object([:]) }) ?? false {
          Button {
            save(.object([:]))
          } label: {
            Label("Use the defaults", systemImage: Glyph.rebuild)
          }
          .buttonStyle(.linkAction)
        }
      }
    } actions: {
      Button("Cancel", action: done).buttonStyle(.virga)
      Button("Save") { save(draft) }
        .buttonStyle(.virga(.primary))
        .accessibilityIdentifier("card-settings-save")
    }
    .onAppear {
      title = card.options?.title ?? ""
      period = card.options?.period ?? ""
      kind = card.options?.kind ?? ""
      rows = card.options?.rows.map { "\($0)" } ?? ""
      titleFocused = takes.contains("title")
    }
  }

  private var draft: JSONValue {
    var object: [String: JSONValue] = [:]
    if !title.isEmpty { object["title"] = .string(title) }
    if !period.isEmpty { object["period"] = .string(period) }
    if !kind.isEmpty { object["kind"] = .string(kind) }
    if let n = Int(rows) { object["rows"] = .number(Double(n)) }
    return .object(object)
  }

  private func save(_ options: JSONValue) {
    dashboards.setWidgetOptions(dashboardId, card.id, type: card.type, options)
    done()
  }

  /// `<select class="input">`: the choice in a field's pane and edge, the
  /// whole width, with the select's chevrons at its end.
  private func picker(_ label: String, _ value: Binding<String>, _ choices: [(String, String)]) -> some View {
    let current = choices.first { $0.0.jsEquals(value.wrappedValue) }?.1 ?? ""
    return Menu {
      Picker(label, selection: value) {
        ForEach(choices, id: \.0) { choice in
          Text(choice.1).tag(choice.0)
        }
      }
    } label: {
      HStack(spacing: theme.space2) {
        Text(current)
          .lineLimit(1)
          .frame(maxWidth: .infinity, alignment: .leading)
        Image(systemName: "chevron.up.chevron.down")
          .font(.system(size: Measure.Tools.linkGlyph, weight: .medium))
          .foregroundStyle(theme.muted)
      }
      .virgaField()
      .contentShape(Rectangle())
    }
    .accessibilityLabel(label)
    .accessibilityValue(current)
  }
}
#endif
