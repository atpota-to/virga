// Ports src/settings/SettingsPage.jsx (DashboardsSection)
// Ports src/settings/settings.css (.dash-list)
//
// Settings › Dashboards: every dashboard as a row, its name the way to it
// and how many reports it holds beside it, with a ⋯ to rename it, move it
// up or down, or delete it (the last one can't go: the app always opens
// on one). New dashboard at the section's head, Reset to the three starting
// dashboards at its foot, and where they're kept under it. The dashboards
// are the shell's (ShellDashboards); renaming one and making one are the
// dashboards' own dialogs (RenameDashboard, NewDashboardDialog). After a
// move or a delete the focus is the system's to place.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

struct DashboardsSection: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  @State private var renaming: Dashboard?
  @State private var confirm: Confirm?
  @State private var creating = false

  /// What the confirm dialog asks: every dashboard reset, or one deleted.
  enum Confirm: Equatable {
    case reset
    case delete(Dashboard)
  }

  var body: some View {
    let list = dashboards.dashboards
    VStack(alignment: .leading, spacing: theme.sectionGap) {
      SettingsSectionView(
        title: "Your dashboards",
        sub: "Each is a set of reports, arranged your way. Open one and press Customize to change it.",
        action: AnyView(
          Button {
            creating = true
          } label: {
            Label("New dashboard", systemImage: Glyph.plus)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("settings-new-dashboard"))
      ) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(list.enumerated()), id: \.element.id) { index, dashboard in
            DashListRow(dashboard: dashboard, entries: entries(dashboard, index: index, count: list.count))
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dash-list")
        SectionFoot {
          Button {
            confirm = .reset
          } label: {
            Label("Reset to the three starting dashboards", systemImage: Glyph.rebuild)
          }
          .buttonStyle(.linkAction)
          .accessibilityIdentifier("settings-reset-dashboards")
        }
      }
      SettingsSectionView(title: "Where they’re kept", sub: nil) {
        SettingsText("Kept in this browser, like your archive. Another browser starts with the three starting dashboards.")
      }
    }
    .virgaDialog(
      isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), title: "Rename dashboard"
    ) {
      if let renaming {
        RenameDashboard(dashboard: renaming) { self.renaming = nil }
      }
    }
    .virgaDialog(isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), title: confirmTitle) {
      Text(
        confirm == .reset
          ? "Every dashboard you made goes, and Overview, Growth and Content come back as they started."
          : "The dashboard and its arrangement go. The reports and your archive stay."
      )
      .virgaText(.textBase)
      .fixedSize(horizontal: false, vertical: true)
    } actions: {
      Button("Cancel") { confirm = nil }
        .buttonStyle(.virga)
      Button(confirm == .reset ? "Reset" : "Delete") { confirmed() }
        .buttonStyle(.virga(.danger))
        .accessibilityIdentifier("dash-confirm")
    }
    .virgaDialog(isPresented: $creating, title: "New dashboard") {
      NewDashboardDialog { creating = false }
    }
  }

  private var confirmTitle: String {
    switch confirm {
    case .reset: return "Reset every dashboard?"
    case .delete(let d): return "Delete \(d.name)?"
    case nil: return ""
    }
  }

  /// Rename…, Move up and Move down where there is somewhere to go, and
  /// Delete, after a separator, while there is more than one.
  private func entries(_ d: Dashboard, index: Int, count: Int) -> [MenuEntry] {
    var out: [MenuEntry] = [.item(MenuItem("Rename…", systemImage: Glyph.rename) { renaming = d })]
    if index > 0 {
      out.append(.item(MenuItem("Move up", systemImage: Glyph.moveUp) { dashboards.moveDashboard(d.id, to: index - 1) }))
    }
    if index < count - 1 {
      out.append(.item(MenuItem("Move down", systemImage: Glyph.moveDown) { dashboards.moveDashboard(d.id, to: index + 1) }))
    }
    if count > 1 {
      out.append(.separator)
      out.append(.item(MenuItem("Delete", systemImage: Glyph.trash, destructive: true) { confirm = .delete(d) }))
    }
    return out
  }

  private func confirmed() {
    switch confirm {
    case .reset:
      dashboards.resetAll()
      toasts?.push("Your dashboards are back to the three starting ones.")
    case .delete(let d):
      dashboards.deleteDashboard(d.id)
    case nil:
      break
    }
    confirm = nil
  }
}

/// `.dash-list-item`: the name (the way to it, ending in an ellipsis) and
/// its count on one baseline, the ⋯ at the right.
struct DashListRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let dashboard: Dashboard
  let entries: [MenuEntry]

  var body: some View {
    let n = dashboard.widgets.count
    HStack(alignment: .top, spacing: Measure.Settings.dashRowGap) {
      HStack(alignment: .firstTextBaseline, spacing: Measure.Settings.dashTextGap) {
        Button {
          navigate("/dashboard/\(dashboard.id)")
        } label: {
          Text(dashboard.name)
            .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Settings.dashNameLineHeight)
            .foregroundStyle(theme.ink)
            .lineLimit(1)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .accessibilityIdentifier("dash-list-\(dashboard.id)")
        Text("\(AppLocale.formatNumber(n)) \(n == 1 ? "report" : "reports")")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      MoreMenu(label: "More for \(dashboard.name)", entries: entries)
        .padding(.trailing, theme.isPhone ? -Measure.Settings.dashMenuOutset : 0)
        .accessibilityIdentifier("dash-list-menu-\(dashboard.id)")
    }
    .padding(.vertical, theme.rowPadLg)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

extension Measure.Settings {
  /// `.dash-list-item { gap: 16px }`, `.dash-list-text { gap: 12px }`, the name's line 1.45.
  static let dashRowGap: CGFloat = 16
  static let dashTextGap: CGFloat = 12
  static let dashNameLineHeight: Double = 1.45
  /// On a phone the ⋯'s dots end on the column's edge (`margin-right: -14px` to a finger).
  static let dashMenuOutset: CGFloat = 14
}
#endif
