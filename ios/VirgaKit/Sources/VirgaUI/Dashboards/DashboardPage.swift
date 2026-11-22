// Ports src/dashboards/DashboardPage.jsx
// Ports src/dashboards/NewDashboardDialog.jsx
// Ports src/dashboards/dashboards.css (.dash-grid, .widget, the arrange list, the library)
//
// A dashboard: its cards on a twelve-column grid (CardGrid), answering for
// the period in the header unless a card keeps one of its own. On the page
// a card has no edge: a figure under a rule, a chart or a list under its
// title. From 860 wide down a third and two thirds take the whole row (a
// figure a third wide goes to half); from 620 down every card does, and
// figures go two to a row.
//
// The header: the dashboard's name with its ⋯ (Rename, Duplicate, New
// dashboard, Reset or Clear, Delete), the period's line, Customize and the
// period picker. Customize is the web's keyboard and phone path at every
// width: each card is a line to move up or down, its size to pick, and
// Remove; reports come in from the library, in a dialog (search, a kind,
// each report's Add). Changes save as they're made, and a toast says what
// was added, removed or reset. Arriving with ?edit=1 (a dashboard just made
// empty) opens it for customizing.
//
// Not here yet: dragging cards and reports about (the up and down
// controls are the way), a card's own settings (its title, period, kind of
// engagement and rows: the dialog isn't ported, though a stored card's
// settings are read), and Post this chart (the share dialog, next).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// `.dash-grid`: cards placed by their share of twelve columns, wrapping.
struct CardGrid: Layout {
  var columnGap: CGFloat
  var rowGap: CGFloat

  struct SizeKey: LayoutValueKey { static let defaultValue = "m" }
  struct StatKey: LayoutValueKey { static let defaultValue = false }

  /// A card's span at this width, as dashboards.css's container rules give it.
  static func span(size: String, stat: Bool, width: CGFloat) -> Int {
    if width <= Measure.Dashboard.phone { return stat ? 6 : 12 }
    let cols = Layouts.sizes[size]?.cols ?? 6
    if width <= Measure.Dashboard.narrow {
      if size == "s" { return stat ? 6 : 12 }
      if size == "l" { return 12 }
    }
    return cols
  }

  private func rows(_ width: CGFloat, _ subviews: Subviews) -> [[(index: Int, x: CGFloat, width: CGFloat)]] {
    var out: [[(index: Int, x: CGFloat, width: CGFloat)]] = [[]]
    var used = 0
    let column = (width - columnGap * 11) / 12
    for (i, view) in subviews.enumerated() {
      let span = Self.span(size: view[SizeKey.self], stat: view[StatKey.self], width: width)
      if used + span > 12 {
        out.append([])
        used = 0
      }
      let x = CGFloat(used) * (column + columnGap)
      let w = column * CGFloat(span) + columnGap * CGFloat(span - 1)
      out[out.count - 1].append((i, x, w))
      used += span
    }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 600
    let lines = rows(width, subviews)
    var height: CGFloat = 0
    for (k, line) in lines.enumerated() where !line.isEmpty {
      let tallest = line.map { subviews[$0.index].sizeThatFits(ProposedViewSize(width: $0.width, height: nil)).height }.max() ?? 0
      height += tallest + (k > 0 ? rowGap : 0)
    }
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for line in rows(bounds.width, subviews) where !line.isEmpty {
      let tallest = line.map { subviews[$0.index].sizeThatFits(ProposedViewSize(width: $0.width, height: nil)).height }.max() ?? 0
      for cell in line {
        subviews[cell.index].place(
          at: CGPoint(x: bounds.minX + cell.x, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: cell.width, height: nil))
      }
      y += tallest + rowGap
    }
  }
}

struct DashboardPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellNavigator.self) private var navigator
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let dashboard: Dashboard

  @State private var editing = false
  @State private var dialog: Which?

  enum Which: Identifiable {
    case rename, delete, new, library
    var id: Self { self }
  }

  var body: some View {
    let period = preferences.period()
    let report = archive.map { ReportArchive($0) }
    let nowMs = archive?.nowMs ?? SyncStatus.now()
    VirgaPage(
      header: PageHeader(
        PageHeaderModel(
          title: dashboard.name,
          sub: editing ? "Press a card to move, resize or remove it. Changes save as you go." : Periods.periodLine(period, nowMs),
          crumbs: [Crumb("Dashboards")]),
        titleTools: AnyView(titleTools), actions: AnyView(headerActions))
    ) {
      if editing {
        Button {
          dialog = .library
        } label: {
          Label("Add a report from the library", systemImage: Glyph.plus)
        }
        .buttonStyle(.virga)
        .accessibilityIdentifier("library-open")
        if dashboard.widgets.isEmpty { empty } else { ArrangeList(dashboard: dashboard, toasts: toasts) }
      } else if dashboard.widgets.isEmpty {
        empty
      } else if let report {
        CardGrid(columnGap: theme.isPhone ? Measure.Dashboard.phoneColumnGap : theme.gridGapX, rowGap: theme.gridGap) {
          ForEach(dashboard.widgets) { card in
            if let def = Catalog.widgets[card.type] {
              WidgetCard(card: card, def: def, archive: report, period: Self.period(of: card, else: period, nowMs: nowMs))
                .layoutValue(key: CardGrid.SizeKey.self, value: card.size)
                .layoutValue(key: CardGrid.StatKey.self, value: def.kind == "stat")
            }
          }
        }
        .accessibilityIdentifier("dash-grid")
      }
    }
    .onAppear {
      // ?edit=1 (a dashboard just made empty) opens it for customizing.
      if navigator.search.contains("edit=1") { editing = true }
    }
    .virgaDialog(isPresented: binding(.rename), title: "Rename dashboard") {
      RenameDashboard(dashboard: dashboard) { dialog = nil }
    }
    .virgaDialog(isPresented: binding(.delete), title: "Delete \(dashboard.name)?") {
      Text("The dashboard and its arrangement go. The reports themselves, and your archive, stay.")
        .fixedSize(horizontal: false, vertical: true)
    } actions: {
      Button("Keep it") { dialog = nil }
        .buttonStyle(.virga)
      Button("Delete") {
        let next = dashboards.dashboards.first { !$0.id.jsEquals(dashboard.id) }
        dashboards.deleteDashboard(dashboard.id)
        dialog = nil
        if let next { navigate("/dashboard/\(next.id)") }
      }
      .buttonStyle(.virga(.danger))
    }
    .virgaDialog(isPresented: binding(.new), title: "New dashboard") {
      NewDashboardDialog { dialog = nil }
    }
    .virgaDialog(isPresented: binding(.library), title: "Report library", size: .tall) {
      Library(dashboard: dashboard, toasts: toasts)
    }
  }

  /// A card's own period, or the dashboard's.
  static func period(of card: DashboardCard, else period: AnalyticsPeriod, nowMs: Double) -> AnalyticsPeriod {
    guard let own = card.options?.period, let preset = Periods.presetPeriod(own) else { return period }
    return preset
  }

  private func binding(_ which: Which) -> Binding<Bool> {
    Binding(get: { dialog == which }, set: { if !$0 { dialog = nil } })
  }

  private var empty: some View {
    VStack(alignment: .leading, spacing: theme.space3) {
      Text(
        "This dashboard is empty. "
          + (editing
            ? "Bring in the reports you want to see each time you open it, from the library."
            : "Add the reports you want to see each time you open it.")
      )
      .virgaText(.textBase)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      if !editing {
        Button {
          editing = true
        } label: {
          Label("Add reports", systemImage: Glyph.plus)
        }
        .buttonStyle(.virga)
      }
    }
    .accessibilityIdentifier("dash-empty")
  }

  @ViewBuilder private var titleTools: some View {
    if editing {
      Button {
        dialog = .rename
      } label: {
        Image(systemName: Glyph.rename)
      }
      .buttonStyle(.virga(.ghost, icon: true))
      .accessibilityLabel("Rename this dashboard")
    } else {
      MoreMenu(label: "Dashboard options", entries: menu, size: .medium)
        .accessibilityIdentifier("dashboard-options")
    }
  }

  private var menu: [MenuEntry] {
    var out: [MenuEntry] = [
      .item(MenuItem("Rename", systemImage: Glyph.rename) { dialog = .rename }),
      .item(
        MenuItem("Duplicate", systemImage: Glyph.duplicate) {
          if let copy = dashboards.duplicateDashboard(dashboard.id) { navigate("/dashboard/\(copy)") }
        }),
      .item(MenuItem("New dashboard", systemImage: Glyph.plus) { dialog = .new }),
      .separator,
      .item(
        MenuItem(dashboard.template != nil ? "Reset to the original reports" : "Clear every report", systemImage: Glyph.rebuild) {
          dashboards.resetDashboard(dashboard.id)
          toasts?.push("\(dashboard.name) is back to how it started.")
        }),
    ]
    if dashboards.dashboards.count > 1 {
      out.append(.item(MenuItem("Delete dashboard", systemImage: Glyph.trash, destructive: true) { dialog = .delete }))
    }
    return out
  }

  @ViewBuilder private var headerActions: some View {
    if editing {
      Button {
        editing = false
      } label: {
        Label("Done", systemImage: Glyph.check)
      }
      .buttonStyle(.virga(.primary))
      .accessibilityAddTraits(.isSelected)
      .accessibilityIdentifier("customize-done")
    } else {
      HStack(spacing: theme.space4) {
        Button {
          editing = true
        } label: {
          Label("Customize", systemImage: Glyph.customize)
        }
        .buttonStyle(.linkAction)
        .accessibilityIdentifier("customize")
        PeriodPicker()
      }
    }
  }
}

/// A card on the grid: a figure as it is; anything else under its title,
/// with the way to its full report.
struct WidgetCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let card: DashboardCard
  let def: WidgetDef
  let archive: ReportArchive
  let period: AnalyticsPeriod

  var body: some View {
    let title = card.options?.title.flatMap { $0.isEmpty ? nil : $0 }
    Group {
      if def.kind == "stat" {
        WidgetBody(card: card, def: def, archive: archive, period: period, title: title)
      } else {
        VStack(alignment: .leading, spacing: Measure.Dashboard.headGap) {
          HStack(alignment: .firstTextBaseline, spacing: theme.space2) {
            Text(title ?? def.name)
              .virgaText(
                size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, tracking: ThemeKit.cardTitleTracking)
              .foregroundStyle(theme.ink)
              .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button {
              navigate(def.href)
            } label: {
              Image(systemName: Glyph.openReport)
            }
            .buttonStyle(.virga(.ghost, size: .small, icon: true))
            .accessibilityLabel("Open the full \(def.name) report")
          }
          WidgetBody(card: card, def: def, archive: archive, period: period, title: title)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("widget-\(card.type)")
  }
}

/// Customize: each card a line to move up or down, its size, and Remove.
struct ArrangeList: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let toasts: ToastCenter?

  var body: some View {
    let widgets = dashboard.widgets
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(widgets.enumerated()), id: \.element.id) { index, card in
        let def = Catalog.widgets[card.type]
        let name = card.options?.title.flatMap { $0.isEmpty ? nil : $0 } ?? def?.name ?? card.type
        VStack(alignment: .leading, spacing: theme.space2) {
          HStack(spacing: theme.space2) {
            Button {
              dashboards.moveWidget(dashboard.id, card.id, to: index - 1)
            } label: {
              Image(systemName: Glyph.moveUp)
            }
            .buttonStyle(.virga(.ghost, icon: true))
            .disabled(index == 0)
            .accessibilityLabel("Move \(name) up")
            Button {
              dashboards.moveWidget(dashboard.id, card.id, to: index + 1)
            } label: {
              Image(systemName: Glyph.moveDown)
            }
            .buttonStyle(.virga(.ghost, icon: true))
            .disabled(index == widgets.count - 1)
            .accessibilityLabel("Move \(name) down")
            Text(name)
              .virgaText(.textMd, weight: VirgaWeight.medium)
              .foregroundStyle(theme.ink)
              .lineLimit(1)
            Spacer(minLength: 0)
            Button("Remove") {
              dashboards.removeWidget(dashboard.id, card.id)
              toasts?.push("\(def?.name ?? name) removed.")
            }
            .buttonStyle(.linkAction)
            .accessibilityLabel("Remove \(name)")
          }
          if let def, def.sizes.count > 1 {
            Segmented(
              label: "Size of \(name)",
              options: def.sizes.map { key in
                SegmentedOption(key, Layouts.sizes[key]?.label ?? key, accessibilityLabel: Layouts.sizes[key]?.name)
              },
              selection: card.size, size: .small
            ) { size in
              dashboards.resizeWidget(dashboard.id, card.id, size)
            }
          }
        }
        .padding(.vertical, theme.space3)
        .frame(minHeight: Measure.Dashboard.arrangeRowHeight, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("arrange-\(card.type)")
      }
    }
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The reports on \(dashboard.name), in order")
  }
}

/// The report library: a search, a kind, and each report with its Add.
struct Library: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let toasts: ToastCenter?
  @State private var query = ""
  @State private var category = "all"

  var body: some View {
    let wanted = Commands.fold(query.jsTrimmed())
    let shown = Catalog.widgetList.filter { w in
      (category == "all" || w.category.jsEquals(category))
        && (wanted.isEmpty || Commands.fold("\(w.name) \(w.desc)").contains(wanted))
    }
    VStack(alignment: .leading, spacing: theme.space4) {
      SearchField("Search reports", text: $query)
      Segmented(
        label: "Kind of report",
        options: [SegmentedOption("all", "All")] + Catalog.categories.map { SegmentedOption($0.key, $0.label) },
        selection: $category, size: .small)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(shown, id: \.type) { w in
          HStack(alignment: .top, spacing: theme.space3) {
            Image(systemName: w.sfSymbol)
              .font(.system(size: Measure.Dashboard.statIcon))
              .foregroundStyle(theme.muted)
              .padding(.top, 3)
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: theme.space2) {
                Text(w.name).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
                if w.kind == "stat" {
                  Text("Figure").virgaText(.textXs).foregroundStyle(theme.muted)
                }
              }
              Text(w.desc)
                .virgaText(.textSm)
                .foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button {
              dashboards.addWidget(dashboard.id, w.type)
              toasts?.push("\(w.name) added to \(dashboard.name).")
            } label: {
              Image(systemName: Glyph.plus)
            }
            .buttonStyle(.virga(size: .small, icon: true))
            .accessibilityLabel("Add \(w.name)")
            .accessibilityIdentifier("library-add-\(w.type)")
          }
          .padding(.vertical, theme.space3)
          .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        }
        if shown.isEmpty {
          Text("No report matches “\(query)”.")
            .virgaText(.textBase)
            .foregroundStyle(theme.muted)
            .padding(.vertical, theme.space4)
        }
      }
    }
  }
}

/// `RenameDialog`: the name, at most 60, saved as it is (trimmed).
struct RenameDashboard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let done: () -> Void
  @State private var value = ""

  var body: some View {
    DialogForm {
      FieldStack("Name") {
        TextField("", text: $value)
          .virgaField()
          .onChange(of: value) { _, next in if next.count > 60 { value = String(next.prefix(60)) } }
          .onSubmit(save)
      }
      HStack(spacing: Measure.Dialog.actionsGap) {
        Spacer(minLength: 0)
        Button("Cancel", action: done).buttonStyle(.virga)
        Button("Save", action: save).buttonStyle(.virga(.primary))
      }
    }
    .onAppear { value = dashboard.name }
  }

  private func save() {
    dashboards.renameDashboard(dashboard.id, value)
    done()
  }
}

/// `NewDashboardDialog`: a name, and what it starts with (nothing, or a template).
struct NewDashboardDialog: View {
  @Environment(\.navigate) private var navigate
  @Environment(ShellDashboards.self) private var dashboards
  let done: () -> Void
  @State private var name = ""
  @State private var template = ""

  var body: some View {
    DialogForm {
      FieldStack("Name") {
        TextField("Weekly check-in", text: $name)
          .virgaField()
          .onChange(of: name) { _, next in if next.count > 60 { name = String(next.prefix(60)) } }
      }
      VStack(alignment: .leading, spacing: 0) {
        FieldLabel("Start from")
        ChoiceRow("Empty", description: "Start blank and add reports from the library.", isOn: choosing(""))
        ForEach(Layouts.templateKeys, id: \.self) { key in
          if let t = Layouts.templates[key] {
            ChoiceRow(t.name, description: "\(t.widgets.count) reports to start from.", isOn: choosing(key))
          }
        }
      }
      HStack(spacing: Measure.Dialog.actionsGap) {
        Spacer(minLength: 0)
        Button("Cancel", action: done).buttonStyle(.virga)
        Button("Create", action: create).buttonStyle(.virga(.primary))
      }
    }
  }

  private func choosing(_ key: String) -> Binding<Bool> {
    Binding(get: { template.jsEquals(key) }, set: { if $0 { template = key } })
  }

  private func create() {
    let trimmed = name.jsTrimmed()
    let label = !trimmed.isEmpty ? trimmed : (template.isEmpty ? "New dashboard" : Layouts.templates[template]?.name ?? "New dashboard")
    let id = dashboards.addDashboard(name: label, template: template.isEmpty ? nil : template)
    done()
    navigate("/dashboard/\(id)\(template.isEmpty ? "?edit=1" : "")")
  }
}
#endif
