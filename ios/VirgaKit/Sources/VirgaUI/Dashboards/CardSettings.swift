// Ports src/dashboards/DashboardPage.jsx (CardSettingsDialog)
//
// A card's own settings, for the ones it takes: its title (at most 60;
// empty keeps the report's name), its own period (it then stays put when
// the period at the top changes), one kind of engagement, and how many rows
// a list shows; Use the defaults clears them. Saved through the dashboards'
// setWidgetOptions, which cleans them as the web does.

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

  var body: some View {
    let takes = def.options ?? []
    DialogForm {
      if takes.contains("title") {
        FieldStack("Title") {
          TextField(def.name, text: $title)
            .virgaField()
            .onChange(of: title) { _, next in if next.count > Layouts.cardTitleMax { title = String(next.prefix(Layouts.cardTitleMax)) } }
            .accessibilityIdentifier("card-title")
          FieldHint("Leave it empty to keep “\(def.name)”.")
        }
      }
      if takes.contains("period") {
        FieldStack("Period") {
          picker($period, [("", "The dashboard’s period")] + Analytics.analyticsPeriods.map { ($0.key, Periods.periodWindowWord($0)) })
          FieldHint("A card with its own period stays put when the period at the top changes, and says which it is.")
        }
      }
      if takes.contains("kind") {
        FieldStack("Engagement counted") {
          picker($kind, [("", "Likes, reposts, replies and quotes")] + Layouts.cardKinds.map { ($0, "\(WidgetParts.kindNoun[$0] ?? $0) only") })
        }
      }
      if takes.contains("rows") {
        FieldStack("Rows") {
          picker($rows, [("", "What fits the card’s size")] + Layouts.cardRows.map { ("\($0)", "\($0)") })
        }
      }
      if card.options.map({ $0.jsonValue != .object([:]) }) ?? false {
        Button {
          save(.object([:]))
        } label: {
          Label("Use the defaults", systemImage: Glyph.rebuild)
        }
        .buttonStyle(.linkAction)
      }
      HStack(spacing: Measure.Dialog.actionsGap) {
        Spacer(minLength: 0)
        Button("Cancel", action: done).buttonStyle(.virga)
        Button("Save") { save(draft) }
          .buttonStyle(.virga(.primary))
          .accessibilityIdentifier("card-settings-save")
      }
    }
    .onAppear {
      title = card.options?.title ?? ""
      period = card.options?.period ?? ""
      kind = card.options?.kind ?? ""
      rows = card.options?.rows.map { "\($0)" } ?? ""
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

  private func picker(_ value: Binding<String>, _ choices: [(String, String)]) -> some View {
    Picker("", selection: value) {
      ForEach(choices, id: \.0) { choice in
        Text(choice.1).tag(choice.0)
      }
    }
    .pickerStyle(.menu)
    .labelsHidden()
    .tint(theme.ink)
  }
}
#endif
