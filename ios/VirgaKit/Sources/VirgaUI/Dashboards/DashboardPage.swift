// Ports src/dashboards/DashboardPage.jsx
// Ports src/dashboards/NewDashboardDialog.jsx
// Ports src/dashboards/dashboards.css (.dash-grid, .widget, the arrange list, the library)
//
// A dashboard: its cards on a twelve-column grid (CardGrid), answering for
// the period in the header unless a card keeps one of its own. On the page
// a card has no edge: a figure under a rule, a chart under its title, a
// list under its title on a rule in ink. From 860 wide down a third and two
// thirds take the whole row (a figure a third wide goes to half); from 620
// down every card does, and figures go two to a row. A card 440 wide or
// less puts its chart's modes under its title.
//
// The header: the dashboard's name with its ⋯ (Rename, Duplicate, New
// dashboard, Reset or Clear, Delete), the period's line, Customize and the
// period picker (on a phone the picker first, Customize at the row's end).
// Customize is the web's keyboard and phone path at every width: each card
// is a line to move up or down, with its name, its number or how many rows
// it shows, and a chevron; pressing the name opens the line to its size on
// a wide screen, its settings and Remove. Reports come in from the library,
// in a dialog (a count of them, a search and the kinds held over the list,
// each report's Add, and which are on this dashboard already). Changes save
// as they're made, and a toast says what was added, removed or reset.
// Arriving with ?edit=1 (a dashboard just made empty) opens it for
// customizing, and the flag leaves the address.
//
// A card's own settings (its title, period, kind of engagement and rows)
// open from its line (CardSettings.swift). Its chart cards carry Post this
// chart (PostChartButton). Not here: dragging cards and reports about (the
// up and down controls are the way).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// A dialog whose own view draws its frame (DialogFrame), so its foot can
/// hold the buttons that act on what is typed in it; presented as
/// `virgaDialog` presents one.
struct DashboardDialog<Inner: View>: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Binding var isPresented: Bool
  var size: DialogSize = .fit
  @ViewBuilder let inner: () -> Inner

  func body(content: Content) -> some View {
    content.sheet(isPresented: $isPresented) {
      inner()
        .presentationDetents(size == .fit ? [.medium, .large] : [.large])
        .presentationBackground(theme.surface)
        .presentationCornerRadius(Measure.Dialog.radius)
    }
  }
}

extension View {
  /// A dialog drawn by `inner` itself (RenameDashboard, NewDashboardDialog,
  /// CardSettings, AddToDashboard, the report library) over this view.
  func dashboardDialog<Inner: View>(
    isPresented: Binding<Bool>, size: DialogSize = .fit, @ViewBuilder inner: @escaping () -> Inner
  ) -> some View {
    modifier(DashboardDialog(isPresented: isPresented, size: size, inner: inner))
  }
}

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
        if dashboard.widgets.isEmpty {
          empty
        } else {
          ArrangeList(dashboard: dashboard, archive: report, period: period, toasts: toasts)
        }
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
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dash-grid")
      }
    }
    .onAppear {
      // ?edit=1 (a dashboard just made empty) opens it for customizing; the
      // flag then leaves the address (the web's replaceState), so the next
      // dashboard opened doesn't open customizing too.
      if JSURI.searchParam(navigator.search, "edit") == "1" {
        editing = true
        ReportQuery.replace(navigator, "edit", nil)
      }
    }
    .dashboardDialog(isPresented: binding(.rename)) {
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
    .dashboardDialog(isPresented: binding(.new)) {
      NewDashboardDialog { dialog = nil }
    }
    .dashboardDialog(isPresented: binding(.library), size: .tall) {
      ReportLibrary(dashboard: dashboard, toasts: toasts) { dialog = nil }
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
    } else if theme.isPhone {
      // A phone: the period first, Customize at the row's far end.
      HStack(spacing: Measure.PageHeader.phoneActionsGap) {
        PeriodPicker()
        Spacer(minLength: 0)
        customize
      }
    } else {
      HStack(spacing: Measure.PageHeader.actionsGap) {
        customize
        PeriodPicker()
      }
    }
  }

  private var customize: some View {
    Button {
      editing = true
    } label: {
      Label("Customize", systemImage: Glyph.customize)
    }
    .buttonStyle(.linkAction)
    .accessibilityIdentifier("customize")
  }
}

/// A card on the grid: a figure as it is; anything else under its title,
/// with the way to its full report. A list (a card that takes rows) has a
/// rule in ink under its heading, the top of its first row.
struct WidgetCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let card: DashboardCard
  let def: WidgetDef
  let archive: ReportArchive
  let period: AnalyticsPeriod
  /// WIDGET_HEADS' `views`: the follower chart's Total or New.
  @State private var view = "total"
  /// The card's own width (`@container widget`).
  @State private var width: CGFloat?

  var body: some View {
    let title = card.options?.title.flatMap { $0.isEmpty ? nil : $0 }
    Group {
      if def.kind == "stat" {
        WidgetBody(card: card, def: def, archive: archive, period: period, title: title)
      } else {
        let list = def.options?.contains("rows") == true
        VStack(alignment: .leading, spacing: 0) {
          head(title: title)
            .padding(.bottom, list ? Measure.Dashboard.listHeadSpaceBelow : Measure.Dashboard.headGap)
          if list {
            Rectangle().fill(theme.rule).frame(height: 1)
          }
          WidgetBody(card: card, def: def, archive: archive, period: period, title: title, view: view)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      GeometryReader { geometry in
        Color.clear
          .onAppear { width = geometry.size.width }
          .onChange(of: geometry.size.width) { _, next in width = next }
      }
    )
    .environment(\.widgetWidth, width)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("widget-\(card.type)")
  }

  /// The heading: the title (and its lines), the chart's modes, and the
  /// tools; in a card 440 wide or less the modes go under the titles.
  private func head(title: String?) -> some View {
    let chartModes = modes
    let under = chartModes != nil && (width ?? .infinity) <= Measure.Dashboard.headModesAt
    return VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: theme.space2) {
        VStack(alignment: .leading, spacing: 2) {
          Text(title ?? def.name)
            .virgaText(
              size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, tracking: ThemeKit.cardTitleTracking)
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
          ownLine
          if let sub = headSub {
            Text(sub).virgaText(.textSm).foregroundStyle(theme.muted)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if !under, let chartModes { chartModes }
        tools(title: title)
      }
      if under, let chartModes {
        chartModes.padding(.top, Measure.Dashboard.headModesSpaceAbove)
      }
    }
  }

  /// The follower chart's Total and New, a small Segmented.
  private var modes: AnyView? {
    guard card.type == "follower-growth", !archive.followers.isEmpty else { return nil }
    let m = ReportModels.followersModel(archive, period, archive.nowMs ?? SyncStatus.now())
    return AnyView(
      Segmented(
        label: "Chart",
        options: [SegmentedOption("total", "Total"), SegmentedOption("new", "New per \(ChartFormat.unitNoun(m.unit))")],
        selection: $view, size: .small))
  }

  /// Post as a picture and the way to the full report.
  private func tools(title: String?) -> some View {
    HStack(spacing: 0) {
      PostChartButton(type: card.type, name: title ?? def.name, options: card.options, period: period)
      Button {
        navigate(def.href)
      } label: {
        Image(systemName: Glyph.openReport)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .accessibilityLabel("Open the full \(def.name) report")
    }
  }

  /// WIDGET_HEADS' `sub`: the lists' count heads the lists you're on.
  private var headSub: String? {
    guard card.type == "lists-on", archive.meta.lists != nil else { return nil }
    let lists = ReportModels.listsModel(archive)
    guard !lists.isEmpty else { return nil }
    let mod = lists.filter { $0.purpose == "moderation" }.count
    return "\(AppLocale.formatNumber(lists.count)) \(lists.count == 1 ? "list" : "lists"), \(AppLocale.formatNumber(mod)) of them moderation lists"
  }

  /// `OwnLine`: the card's own period and kind, when it keeps them, each
  /// with the web's title as its hint.
  @ViewBuilder private var ownLine: some View {
    let own = card.options?.period.flatMap { Periods.presetPeriod($0) }
    let kind = card.options?.kind.flatMap { WidgetParts.kindNoun[$0] }
    if own != nil || kind != nil {
      FlowLayout(spacing: 0, lineSpacing: 0) {
        if let own {
          MetaPiece(isLast: kind == nil) { Text(Periods.periodWindowWord(own)) }
            .accessibilityHint("This card keeps its own period")
        }
        if let kind {
          MetaPiece(isLast: true) { Text("\(kind) only") }
            .accessibilityHint("This card counts one kind of engagement")
        }
      }
    }
  }
}

/// Customize: each card a line to move up or down, its name, its number or
/// how many rows it shows, and a chevron; pressing the name opens it to its
/// size on a wide screen, its settings and Remove.
struct ArrangeList: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let archive: ReportArchive?
  let period: AnalyticsPeriod
  let toasts: ToastCenter?
  @State private var chosen: String?
  @State private var settingsFor: String?

  var body: some View {
    let widgets = dashboard.widgets
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(widgets.enumerated()), id: \.element.id) { index, card in
        if let def = Catalog.widgets[card.type] {
          row(card, def: def, index: index, count: widgets.count)
        }
      }
    }
    .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The reports on \(dashboard.name), in order")
    .dashboardDialog(isPresented: Binding(get: { settingsFor != nil }, set: { if !$0 { settingsFor = nil } })) {
      if let card = settingsCard, let def = Catalog.widgets[card.type] {
        CardSettings(dashboardId: dashboard.id, card: card, def: def) { settingsFor = nil }
      }
    }
  }

  private func row(_ card: DashboardCard, def: WidgetDef, index: Int, count: Int) -> some View {
    let name = card.options?.title.flatMap { $0.isEmpty ? nil : $0 } ?? def.name
    let open = chosen.map { $0.jsEquals(card.id) } ?? false
    return VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 0) {
        Button {
          dashboards.moveWidget(dashboard.id, card.id, to: index - 1)
        } label: {
          Image(systemName: Glyph.moveUp)
        }
        .buttonStyle(.virga(.ghost, icon: true))
        .disabled(index == 0)
        .accessibilityLabel("Move \(name) up")
        .padding(.leading, -Measure.Dashboard.arrangeArrowBleed)
        Button {
          dashboards.moveWidget(dashboard.id, card.id, to: index + 1)
        } label: {
          Image(systemName: Glyph.moveDown)
        }
        .buttonStyle(.virga(.ghost, icon: true))
        .disabled(index == count - 1)
        .accessibilityLabel("Move \(name) down")
        // The name opens the line; its reach runs to the line's end, over
        // the number and the chevron.
        Button {
          chosen = open ? nil : card.id
        } label: {
          HStack(spacing: 0) {
            Text(name)
              .virgaText(.textMd, weight: open ? VirgaWeight.semibold : VirgaWeight.medium)
              .foregroundStyle(theme.ink)
              .lineLimit(1)
              .truncationMode(.tail)
              .frame(maxWidth: .infinity, alignment: .leading)
            value(card, def: def)
              .padding(.leading, Measure.Dashboard.arrangeValueSpaceBefore)
            Image(systemName: ReportParts.chevronDown)
              .font(.system(size: Measure.Dashboard.arrangeChevron))
              .foregroundStyle(theme.muted)
              .rotationEffect(.degrees(open ? 180 : 0))
              .animation(theme.motion.knob, value: open)
              .padding(.leading, Measure.Dashboard.arrangeChevronSpaceBefore)
              .accessibilityHidden(true)
          }
          .frame(maxHeight: .infinity)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, Measure.Dashboard.arrangeNameSpaceBefore)
        .accessibilityValue(open ? "Open" : "Closed")
        .accessibilityIdentifier("arrange-open-\(card.type)")
      }
      .frame(minHeight: Measure.Dashboard.arrangeLineHeight)
      if open {
        detail(card, def: def, name: name)
      }
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("arrange-\(card.type)")
  }

  /// `.arrange-value`: a figure's own number, or how many rows a list shows.
  @ViewBuilder
  private func value(_ card: DashboardCard, def: WidgetDef) -> some View {
    if def.kind == "stat", let archive {
      WidgetBody(card: card, def: def, archive: archive, period: DashboardPage.period(of: card, else: period, nowMs: 0), title: nil)
        .environment(\.statValueOnly, true)
        .allowsHitTesting(false)
    } else if def.options?.contains("rows") == true {
      Text("\(AppLocale.formatNumber(WidgetParts.rowsShown(card.type, card.size, card.options?.rows))) rows")
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .lineLimit(1)
        .fixedSize()
    }
  }

  private func detail(_ card: DashboardCard, def: WidgetDef, name: String) -> some View {
    VStack(alignment: .leading, spacing: Measure.Dashboard.arrangeDetailGap) {
      if def.sizes.count > 1 {
        VStack(alignment: .leading, spacing: Measure.Dashboard.arrangeSizeGap) {
          Text("Size on a wide screen. On a phone every card is full width.")
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: theme.measure, alignment: .leading)
          Segmented(
            label: "Size of \(name) on a wide screen",
            options: def.sizes.map { key in
              SegmentedOption(key, Layouts.sizes[key]?.label ?? key, accessibilityLabel: Layouts.sizes[key]?.name)
            },
            selection: card.size, size: .small
          ) { size in
            dashboards.resizeWidget(dashboard.id, card.id, size)
          }
        }
      }
      FlowLayout(spacing: Measure.Dashboard.arrangeToolsGap, lineSpacing: Measure.Dashboard.arrangeToolsLineGap) {
        if !(def.options ?? []).isEmpty {
          Button {
            settingsFor = card.id
          } label: {
            Label("Settings", systemImage: Glyph.settings)
          }
          .buttonStyle(.linkAction)
          .accessibilityLabel("Settings for \(name)")
          .accessibilityIdentifier("card-settings-\(card.type)")
        }
        Button {
          chosen = nil
          dashboards.removeWidget(dashboard.id, card.id)
          toasts?.push("\(def.name) removed.")
        } label: {
          Label("Remove", systemImage: Glyph.close)
        }
        .buttonStyle(.linkAction)
        .accessibilityLabel("Remove \(name)")
      }
    }
    .padding(.top, Measure.Dashboard.arrangeDetailSpaceAbove)
    .padding(.bottom, Measure.Dashboard.arrangeDetailSpaceBelow)
  }

  private var settingsCard: DashboardCard? {
    settingsFor.flatMap { id in dashboard.widgets.first { $0.id.jsEquals(id) } }
  }
}

/// The report library, in a dialog: how many reports and how many are on
/// this dashboard, a search and a kind held over the list, which scrolls
/// under them on a rule in ink; each report with its glyph, its name (and
/// "Figure"), what it shows, whether it is on this dashboard already, and
/// its Add.
struct ReportLibrary: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let toasts: ToastCenter?
  let onClose: () -> Void
  @State private var query = ""
  @State private var category = "all"

  var body: some View {
    let wanted = Commands.fold(query.jsTrimmed())
    let shown = Catalog.widgetList.filter { w in
      (category == "all" || w.category.jsEquals(category))
        && (wanted.isEmpty || Commands.fold("\(w.name) \(w.desc)").contains(wanted))
    }
    let phone = theme.isPhone
    VStack(alignment: .leading, spacing: 0) {
      DialogHead(title: "Report library", onClose: onClose)
      VStack(alignment: .leading, spacing: Measure.Dashboard.libraryGap) {
        Text(
          "\(AppLocale.formatNumber(Catalog.widgetList.count)) reports, \(AppLocale.formatNumber(dashboard.widgets.count)) of them on this dashboard. Press a report’s plus to add it."
        )
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        SearchField("Search reports", text: $query)
        Segmented(
          label: "Kind of report",
          options: [SegmentedOption("all", "All")] + Catalog.categories.map { SegmentedOption($0.key, $0.label) },
          selection: $category, size: .small)
      }
      .padding(.horizontal, phone ? Measure.Dialog.phoneBody.leading : Measure.Dialog.body.leading)
      .padding(.top, phone ? Measure.Dialog.phoneBody.top : Measure.Dialog.body.top)
      .padding(.bottom, Measure.Dashboard.libraryGap)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(shown, id: \.type) { w in
            item(w, on: dashboard.widgets.filter { $0.type.jsEquals(w.type) }.count)
          }
          if shown.isEmpty {
            Text("No report matches “\(query)”.")
              .virgaText(.textBase)
              .foregroundStyle(theme.muted)
              .padding(.vertical, theme.rowPad)
          }
        }
        .overlay(alignment: .top) { Rectangle().fill(theme.rule).frame(height: 1) }
        .padding(.horizontal, phone ? Measure.Dialog.phoneBody.leading : Measure.Dialog.body.leading)
        .padding(.bottom, phone ? Measure.Dialog.phoneBody.bottom : Measure.Dialog.body.bottom)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .background(theme.surface)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("report-library")
  }

  private func item(_ w: WidgetDef, on n: Int) -> some View {
    HStack(alignment: .top, spacing: Measure.Dashboard.libraryItemGap) {
      Image(systemName: w.sfSymbol)
        .font(.system(size: Measure.Dashboard.libraryIcon))
        .foregroundStyle(theme.ink2)
        .frame(width: Measure.Dashboard.libraryIcon, height: Measure.Dashboard.libraryIconBox)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: Measure.Dashboard.libraryTextGap) {
        HStack(alignment: .firstTextBaseline, spacing: Measure.Dashboard.libraryNameGap) {
          Text(w.name).virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Dashboard.libraryLineHeight).foregroundStyle(theme.ink)
          if w.kind == "stat" {
            Text("Figure").virgaText(.textSm).foregroundStyle(theme.muted)
          }
        }
        Text(w.desc)
          .virgaText(.textSm, lineHeight: Measure.Dashboard.libraryLineHeight)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
        if n > 0 {
          HStack(spacing: Measure.Dashboard.libraryOnGap) {
            Image(systemName: Glyph.check).font(.system(size: Measure.Dashboard.libraryOnIcon))
            Text("On this dashboard\(n > 1 ? " ×\(n)" : "")")
          }
          .virgaText(.textSm, weight: VirgaWeight.medium)
          .foregroundStyle(theme.ink2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
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
    .padding(.vertical, theme.rowPad)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }
}

/// A dialog's head (DialogFrame's): its title and Close, for a dialog that
/// lays out its own body (the library, whose list scrolls under its search).
struct DialogHead: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let onClose: () -> Void

  var body: some View {
    HStack(alignment: .center, spacing: theme.space3) {
      Text(title)
        .virgaText(.textLg, weight: VirgaWeight.semibold, tracking: Measure.Dialog.titleTracking)
        .foregroundStyle(theme.ink)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("dialog-title")
      Spacer(minLength: 0)
      Button(action: onClose) {
        Image(systemName: Glyph.close)
      }
      .buttonStyle(.virga(.ghost, size: .small, icon: true))
      .accessibilityLabel("Close")
      .accessibilityIdentifier("dialog-close")
    }
    .padding(theme.isPhone ? Measure.Dialog.phoneHead : Measure.Dialog.head)
  }
}

/// `RenameDialog`: the name, at most 60, saved as it is (trimmed); a name
/// that is only spaces isn't saved, and the dialog stays.
struct RenameDashboard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ShellDashboards.self) private var dashboards
  let dashboard: Dashboard
  let done: () -> Void
  @State private var value = ""
  @FocusState private var focused: Bool

  var body: some View {
    DialogFrame(title: "Rename dashboard", onClose: done) {
      DialogForm {
        FieldStack("Name") {
          TextField("", text: $value)
            .virgaField()
            .focused($focused)
            .submitLabel(.done)
            .onChange(of: value) { _, next in if next.count > 60 { value = String(next.prefix(60)) } }
            .onSubmit(save)
        }
      }
    } actions: {
      Button("Cancel", action: done).buttonStyle(.virga)
      Button("Save", action: save).buttonStyle(.virga(.primary))
    }
    .onAppear {
      value = dashboard.name
      focused = true
    }
  }

  private func save() {
    guard !value.jsTrimmed().isEmpty else { return }
    dashboards.renameDashboard(dashboard.id, value)
    done()
  }
}

/// `NewDashboardDialog`: a name, and what it starts with (nothing, or a
/// template); Return in the name creates it, as the web's form does.
struct NewDashboardDialog: View {
  @Environment(\.navigate) private var navigate
  @Environment(ShellDashboards.self) private var dashboards
  let done: () -> Void
  @State private var name = ""
  @State private var template = ""
  @FocusState private var focused: Bool

  var body: some View {
    DialogFrame(title: "New dashboard", onClose: done) {
      DialogForm {
        FieldStack("Name") {
          TextField("Weekly check-in", text: $name)
            .virgaField()
            .focused($focused)
            .submitLabel(.done)
            .onChange(of: name) { _, next in if next.count > 60 { name = String(next.prefix(60)) } }
            .onSubmit(create)
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
      }
    } actions: {
      Button("Cancel", action: done).buttonStyle(.virga)
      Button("Create", action: create).buttonStyle(.virga(.primary))
    }
    .onAppear { focused = true }
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
