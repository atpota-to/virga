// Ports src/reports/ReportPage.jsx (ReportsIndex, the page, its filters and actions, exportReport, the followers, posts and engagement reports)
// Ports src/reports/parts.jsx (Card, ModeToggle, unitOptions, fig)
// Ports src/reports/reports.css (.report-index, .report-tile, .report-filters, .report-filter-bar, .report-split, .fig-unit)
//
// Reports: the index, each report as its leading figure under a rule (the
// number is the way in; two to a row on a phone, without the words under
// it, four on a wide screen), and a report's own page: its header with the
// period picker; what narrows it (the direction and the kind of
// engagement, whom People shows) as one row of small keys that scrolls
// sideways, a hairline between groups; its figures; and its charts each
// under a card's title with its modes (under the title on a phone), every
// chart with its table. What can be done with a report (Export, Post this
// chart, Add to dashboard) is on the line under its lead chart, after Show
// as table, or a ⋯ at that line's end on a phone; People, which has no
// chart, ends its filter row with them. The direction is the address's
// (?direction=given), as the web's useSearchParam has it, so a card that
// links to the given report lands on it.
//
// Every report is here: Followers, Posts and Engagement (below), Content
// (ContentReport.swift), and Blocks, People and Atmosphere
// (MoreReports.swift), over VirgaInsights' report models for the period.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

enum ReportParts {
  /// `KIND_ICON`, the mention's with the rest (People's kinds).
  static let kindGlyph: [String: String] = WidgetParts.kindGlyph.merging(["mention": ToolGlyph.mention]) { kept, _ in kept }

  /// `ModeToggle`'s name for every report chart's modes.
  static let modeLabel = "Chart"

  /// lucide's ChevronDown and ChevronUp (Show all, Show fewer).
  static let chevronDown = "chevron.down"
  static let chevronUp = "chevron.up"

  /// `unitOptions(units, noun)`: a bucket's keys for a chart's modes.
  static func unitOptions(_ units: [AnalyticsUnit], _ noun: String) -> [SegmentedOption<String>] {
    units.map { u in
      SegmentedOption(u.rawValue, ChartFormat.unitLabel(u), accessibilityLabel: "\(noun) per \(ChartFormat.unitNoun(u))")
    }
  }

  /// `fig(label, value, { delta, deltaTitle, sub, decimals, unit })` for a number.
  static func fig(
    _ label: String, _ value: Double?, decimals: Bool = false, unit: String? = nil, delta: Double?? = nil, deltaTitle: String? = nil,
    sub: String? = nil
  ) -> FigureItem {
    fig(label, text: value.map { ChartFormat.fmtFigure($0, decimals: decimals) } ?? "—", unit: unit, delta: delta, deltaTitle: deltaTitle, sub: sub)
  }

  /// `fig(label, value, …)` for a value already in words ("—", a rate).
  static func fig(
    _ label: String, text: String, unit: String? = nil, delta: Double?? = nil, deltaTitle: String? = nil, sub: String? = nil
  ) -> FigureItem {
    let note: AnyView? = delta != nil || sub != nil ? AnyView(FigNote(delta: delta, deltaTitle: deltaTitle, sub: sub)) : nil
    return FigureItem(label: label, value: .text(text), note: note, unit: unit)
  }

  /// `fig(label, value, { sub: <markup> })`: a note that is a link, or words with an (i).
  static func fig(_ label: String, text: String, note: AnyView?) -> FigureItem {
    FigureItem(label: label, value: .text(text), note: note)
  }

  static func days(_ period: AnalyticsPeriod) -> Bool { period.days.map { $0 != 0 } ?? false }

  /// The engagement kind's word for a report's heads ("Likes"), or "Engagement".
  static func head(_ kind: String) -> String {
    kind == "all" ? "Engagement" : Analytics.engagementKinds.first { $0.key == kind }?.label ?? "Engagement"
  }
}

/// `.figures-note`: the change, then a faint dot that belongs to it, then the
/// words about it, as one line of text that wraps a word at a time.
struct FigNote: View {
  @Environment(\.virgaTheme) private var theme
  /// nil: no change to give; `.some(nil)`: "new".
  let delta: Double??
  let deltaTitle: String?
  let sub: String?

  var body: some View {
    words
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityHint(deltaTitle ?? "")
  }

  private var words: Text {
    var out = Text("")
    if case .some(let pct) = delta {
      out = out + Text(ChartFormat.deltaText(pct)).font(theme.font(ThemeKit.deltaFontSize, weight: ThemeKit.deltaWeight)).foregroundStyle(theme.ink)
      // The web's 4 and 6 around the dot are the font's no-break spaces,
      // so a wrapped line never starts with it.
      if sub != nil { out = out + Text("\u{00A0}·\u{00A0}").foregroundStyle(theme.faint) }
    }
    if let sub { out = out + Text(sub) }
    return out
  }
}

/// A `<Link>` in a figure's note: words in ink with a line under them.
struct NoteLink: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let text: String
  let to: String

  var body: some View {
    Button {
      navigate(to)
    } label: {
      Text(text).underline()
    }
    .buttonStyle(.plain)
    .foregroundStyle(theme.ink)
    .accessibilityAddTraits(.isLink)
  }
}

/// "4,810 can be listed (i)": the count, and why it isn't the profile's,
/// kept on one line (`.stat-keep`).
struct ListedNote: View {
  let profileCount: Int
  let listed: Int
  /// The card's own words: "can be listed" before its (i).
  var words = "can be listed"

  var body: some View {
    HStack(spacing: 0) {
      Text("\(AppLocale.formatNumber(listed)) \(words)")
      FollowerCountTip(profileCount: Double(profileCount), listed: Double(listed))
        .padding(.vertical, -Measure.Reports.infoTipMarginV)
        .padding(.horizontal, -Measure.Reports.infoTipMarginH)
    }
  }
}

/// `Card`: a report's band, its title and line, and its modes at the right
/// (under the title and its line on a phone, as controls.css's 560 rule
/// has a section's small Segmented). `flush` is a list's: a rule in ink
/// under the heading.
struct ReportCard<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  let title: String
  let sub: String?
  let tools: AnyView?
  var flush = false
  var caption: String? = nil
  @ViewBuilder let content: () -> Content

  var body: some View {
    let under = theme.isPhone && tools != nil
    VirgaSection(title: title, sub: sub, trailing: under ? nil : tools, flush: flush, caption: caption) {
      if under, let tools {
        tools
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, Measure.Dashboard.headModesSpaceAbove - theme.points(ThemeKit.cardHeadSpaceBelow))
          .padding(.bottom, theme.points(ThemeKit.cardHeadSpaceBelow))
      }
      content()
    }
  }
}

/// `.report-split`: two sections side by side where each has its 400 (the
/// wide one 2 : 1 from 1100, its side at least 260), one under the other
/// where they don't.
struct ReportSplit<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  var wide = false
  @ViewBuilder let content: () -> Content

  var body: some View {
    if wide {
      ToolSplit(
        minColumn: Measure.Reports.wideSplitSideMin, columnGap: theme.gridGapX, rowGap: theme.gridGap,
        shares: Measure.Reports.wideSplitShares, stacked: theme.windowWidth < Measure.Reports.wideSplitAt
      ) {
        content()
      }
    } else {
      ToolSplit(minColumn: Measure.Reports.splitMin, columnGap: theme.gridGapX, rowGap: theme.gridGap) {
        content()
      }
    }
  }
}

/// `history.replaceState` for one parameter of the address's query, as
/// URLSearchParams' delete and set write it.
enum ReportQuery {
  static func setting(_ name: String, _ value: String?, in search: String) -> String {
    var pairs = JSURI.parseSearchParams(search)
    let first = pairs.firstIndex { $0.0.jsEquals(name) }
    pairs.removeAll { $0.0.jsEquals(name) }
    if let value {
      if let first { pairs.insert((name, value), at: min(first, pairs.count)) } else { pairs.append((name, value)) }
    }
    let query = JSURI.searchParams(pairs)
    return query.isEmpty ? "" : "?\(query)"
  }

  /// The address with `name` set (or removed), the page staying put.
  @MainActor
  static func replace(_ navigator: ShellNavigator, _ name: String, _ value: String?) {
    navigator.navigate(navigator.path + setting(name, value, in: navigator.search), keepQuery: false)
  }
}

/// `exportReport(archive, key, period, nowMs)`: what a report's Export writes.
@MainActor
enum ReportExport {
  static func file(_ model: ArchiveModel, _ archive: ReportArchive, _ key: String, _ period: AnalyticsPeriod, _ nowMs: Double) -> ExportFile? {
    func n(_ value: Int) -> JSONValue? { .number(Double(value)) }
    switch key {
    case "posts", "engagement", "content":
      return model.exportPosts()
    case "followers":
      var rows: [[JSONValue?]] = [ToolExport.row(["did", "handle", "display_name", "followed_at"])]
      for f in archive.followers {
        rows.append([.string(f.did), .string(f.handle), .string(f.displayName), .string(f.followedAt ?? "")])
      }
      return model.exportRows("followers", rows)
    case "blocks":
      var rows: [[JSONValue?]] = [ToolExport.row(["did", "source", "list", "blocked_at"])]
      for b in archive.blocks {
        rows.append([.string(b.did), b.source.map(JSONValue.string), .string(b.listUri ?? ""), .string(b.blockedAt ?? "")])
      }
      return model.exportRows("blocks", rows)
    case "people":
      let m = ReportModels.peopleModel(archive, period, nowMs)
      func handle(_ did: String) -> JSONValue? { .string(People.card(model, archive, did).handle ?? "") }
      func of(_ r: TopActor, _ kind: String) -> JSONValue? { n(r.byKind[kind] ?? 0) }
      var rows: [[JSONValue?]] = [ToolExport.row(["direction", "did", "handle", "total", "likes", "reposts", "replies", "quotes", "mentions"])]
      for r in m.inbound {
        rows.append([
          .string("received"), .string(r.did), handle(r.did), n(r.total), of(r, "like"), of(r, "repost"), of(r, "reply"), of(r, "quote"),
          of(r, "mention"),
        ])
      }
      for r in m.outbound {
        rows.append([
          .string("given"), .string(r.did), handle(r.did), n(r.total), of(r, "like"), of(r, "repost"), of(r, "reply"), of(r, "quote"),
          .string(""),
        ])
      }
      return model.exportRows("people", rows)
    case "atmosphere":
      let m = ReportModels.atmosphereModel(archive, period, nowMs)
      var rows: [[JSONValue?]] = [ToolExport.row(["collection", "records"])]
      for c in m?.ranked ?? [] {
        rows.append([.string(c.collection), n(c.count)])
      }
      return model.exportRows("collections", rows)
    default:
      return nil
    }
  }
}

/// `ReportsIndex`.
struct ReportsIndex: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?

  var body: some View {
    let period = preferences.period()
    let headline = headlines(period)
    let phone = theme.isPhone
    let columns: Int? = phone ? 2 : (theme.windowWidth >= Measure.Reports.indexWideAt ? Measure.Reports.indexWideColumns : nil)
    VirgaPage(
      header: PageHeader(
        PageHeaderModel(title: "Reports", sub: "Every number Virga works out, one page each."), actions: AnyView(PeriodPicker()))
    ) {
      ReportIndexLayout(
        columns: columns,
        minWidth: Measure.Reports.tileMinWidth, columnGap: phone ? Measure.Reports.phoneIndexColumnGap : theme.gridGapX,
        rowGap: theme.gridGap, spanOddLast: phone
      ) {
        ForEach(ReportsRegistry.reports, id: \.key) { report in
          tile(report, headline[report.key], phone: phone)
        }
      }
    }
  }

  private func tile(_ report: ReportEntry, _ h: (String, String)?, phone: Bool) -> some View {
    Button {
      navigate("/reports/\(report.key)")
    } label: {
      VStack(alignment: .leading, spacing: Measure.Reports.tileGap) {
        HStack(spacing: Measure.Dashboard.statLabelGap) {
          Image(systemName: report.sfSymbol).font(.system(size: Measure.Dashboard.statIcon))
          Text(report.label)
        }
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .foregroundStyle(theme.ink2)
        if let h {
          Text(h.0)
            .virgaText(size: theme.figureSize, weight: VirgaWeight.medium, lineHeight: 1, tracking: Measure.Dashboard.statTracking)
            .foregroundStyle(theme.ink)
          Text(h.1).virgaText(.textSm).foregroundStyle(theme.muted).fixedSize(horizontal: false, vertical: true)
        }
        // A phone leaves the words out; they stay as the link's hint.
        if !phone {
          Text(report.desc)
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, Measure.Reports.tileDescSpaceAbove)
        }
      }
      .padding(.top, phone ? Measure.Reports.phoneTilePaddingTop : Measure.Dashboard.statPaddingTop)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 2) }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(.isLink)
    .accessibilityHint(phone ? report.desc : "")
    .accessibilityIdentifier("report-\(report.key)")
  }

  /// The leading figures, for the reports the models are ported for.
  private func headlines(_ period: AnalyticsPeriod) -> [String: (String, String)] {
    guard let archive, archive.data.meta.posts != nil else { return [:] }
    let a = ReportArchive(archive)
    let now = archive.nowMs
    let phrase = Periods.periodPhrase(period)
    let f = ReportModels.followersModel(a, period, now)
    let p = ReportModels.postsModel(a, period, now)
    let e = ReportModels.engagementModel(a, period, now)
    let later = ("—", "read at the next sync")
    let blocks = a.meta.blocks != nil ? ReportModels.blocksModel(a, period, now) : nil
    let people = ReportModels.peopleModel(a, period, now)
    let repo = ReportModels.atmosphereModel(a, period, now)
    return [
      "followers": (ChartFormat.fmtFigure(Double(f.profileCount ?? f.total)), "+\(AppLocale.formatNumber(f.gained)) in \(phrase)"),
      "blocks": blocks.map { (ChartFormat.fmtFigure(Double($0.total)), "blocked by, +\(AppLocale.formatNumber($0.received)) in \(phrase)") } ?? later,
      "posts": (ChartFormat.fmtFigure(Double(p.count)), "posts in \(phrase)"),
      "content": ReportModels.contentReady(a) ? Self.contentHeadline(ReportModels.contentModel(a, period, now)) : later,
      "engagement": (ChartFormat.fmtFigure(Double(e.total)), "received in \(phrase)"),
      "people": (ChartFormat.fmtFigure(Double(people.inbound.count)), "people engaged with you in \(phrase)"),
      "atmosphere": repo.map {
        (ChartFormat.fmtFigure(Double($0.allTime)), "records in \($0.collections != 0 ? "\($0.collections) collections" : "your repo")")
      } ?? later,
    ]
  }

  /// `contentHeadline(m)`.
  static func contentHeadline(_ m: ContentReport) -> (String, String) {
    let known = m.formats.filter { $0.typical != nil }
    if known.count > 1, let best = known.reduce(nil, { (a: ContentGroup?, b: ContentGroup) in a.map { (b.typical ?? 0) > ($0.typical ?? 0) ? b : $0 } ?? b }) {
      var label = best.label.jsLowercased()
      if label.hasSuffix(" post") { label = String(label.dropLast(5)) }
      return (ChartFormat.fmtRate(best.typical), "a typical \(label) post earns")
    }
    return (m.typical == nil ? "—" : ChartFormat.fmtRate(m.typical), "a typical post earns")
  }
}

/// `.report-index`: `columns` to a row (or as many of `minWidth` as fit),
/// the tiles of a row as tall as its tallest, so their rules line up; on a
/// phone an odd one out at the end takes the whole row.
struct ReportIndexLayout: Layout {
  var columns: Int?
  var minWidth: CGFloat
  var columnGap: CGFloat
  var rowGap: CGFloat
  var spanOddLast: Bool

  private func count(_ width: CGFloat, _ items: Int) -> Int {
    if let columns { return max(1, columns) }
    return max(1, Int((width + columnGap) / (min(width, minWidth) + columnGap)))
  }

  private func frames(_ width: CGFloat, _ subviews: Subviews) -> [CGRect] {
    let cols = count(width, subviews.count)
    let cell = (width - columnGap * CGFloat(cols - 1)) / CGFloat(cols)
    var out: [CGRect] = []
    var y: CGFloat = 0
    var index = 0
    while index < subviews.count {
      let inRow = min(cols, subviews.count - index)
      let span = spanOddLast && cols == 2 && inRow == 1
      let w = span ? width : cell
      let height = (0..<inRow).map { subviews[index + $0].sizeThatFits(ProposedViewSize(width: w, height: nil)).height }.max() ?? 0
      for k in 0..<inRow {
        out.append(CGRect(x: CGFloat(k) * (cell + columnGap), y: y, width: w, height: height))
      }
      y += height + rowGap
      index += inRow
    }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 800
    return CGSize(width: width, height: frames(width, subviews).map(\.maxY).max() ?? 0)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (index, frame) in frames(bounds.width, subviews).enumerated() {
      subviews[index].place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(width: frame.width, height: frame.height))
    }
  }
}

/// A report's page.
struct ReportPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @Environment(ShellNavigator.self) private var navigator: ShellNavigator?
  let report: ReportEntry
  @State private var adding = false
  @State private var kind = "all"
  @State private var relation = "all"
  @State private var share: ShareRequest?
  @State private var exporting: ExportFile?

  static let ported = ["followers", "posts", "engagement", "content", "blocks", "people", "atmosphere"]

  /// `useSearchParam('direction', 'received')`.
  private var direction: String {
    navigator.flatMap { JSURI.searchParam($0.search, "direction") } ?? "received"
  }

  private var widget: WidgetDef? { ReportWidgets.byReport[report.key].flatMap { Catalog.widgets[$0] } }

  /// Engagement and People narrow by kind.
  private var showKind: Bool { report.key == "engagement" || report.key == "people" }

  private var canPost: Bool {
    guard let widget else { return false }
    return ShareSpec.canShare(widget.type) && direction != "given"
  }

  var body: some View {
    let crumbs = [Crumb("Reports", to: "/reports")]
    if let archive, Self.ported.contains(report.key) {
      let period = preferences.period()
      let data = ReportArchive(archive)
      let header = PageHeader(
        PageHeaderModel(title: report.label, sub: report.desc, crumbs: crumbs), actions: AnyView(PeriodPicker()),
        extra: filters(archive, data, period))
      // On a phone the line under the lead chart ends in a ⋯; elsewhere it
      // says them in words. People has no chart: its filter row ends with them.
      let people = report.key == "people"
      let lineEnd: AnyView? = theme.isPhone && !people ? moreMenu(archive, data, period) : nil
      let lineWords: AnyView? = !theme.isPhone && !people ? chartActions(archive, data, period) : nil
      let engagementKind = kind == "mention" ? "all" : kind
      VirgaPage(header: header) {
        switch report.key {
        case "followers": FollowersReportView(archive: data, period: period, actions: lineWords, more: lineEnd)
        case "posts": PostsReportView(archive: data, period: period, actions: lineWords, more: lineEnd)
        case "content": ContentReportView(archive: data, period: period, actions: lineWords, more: lineEnd)
        case "blocks": BlocksReportView(archive: data, period: period, actions: lineWords, more: lineEnd)
        case "people":
          PeopleReportView(archive: data, period: period, kind: kind, relation: archive.data.meta.following != nil ? relation : "all")
        case "atmosphere": AtmosphereReportView(archive: data, period: period, actions: lineWords, more: lineEnd)
        default:
          if direction == "given" {
            GivenReportView(archive: data, period: period, kind: engagementKind, actions: lineWords, more: lineEnd)
          } else {
            EngagementReportView(archive: data, period: period, kind: engagementKind, actions: lineWords, more: lineEnd)
          }
        }
      }
      .dashboardDialog(isPresented: $adding) {
        if let widget { AddToDashboard(widget: widget) { adding = false } }
      }
      .shareDialog($share, period: period)
      .toolExporter($exporting)
    } else {
      UnportedPage(PageHeaderModel(title: report.label, sub: report.desc, crumbs: crumbs))
    }
  }

  // MARK: What can be done with the report

  private func exportIt(_ model: ArchiveModel, _ data: ReportArchive, _ period: AnalyticsPeriod) {
    exporting = ReportExport.file(model, data, report.key, period, data.nowMs ?? SyncStatus.now())
  }

  private func postIt() {
    guard let widget else { return }
    share = ShareRequest(type: widget.type, kind: showKind && kind != "all" && kind != "mention" ? kind : nil)
  }

  /// The words: Export, Post this chart, Add to dashboard, as link actions.
  private func chartActions(_ model: ArchiveModel, _ data: ReportArchive, _ period: AnalyticsPeriod) -> AnyView {
    AnyView(
      ReportActionWords(
        widgetName: canPost ? widget?.name : nil, canAdd: widget != nil, onExport: { exportIt(model, data, period) }, onPost: postIt,
        onAdd: { adding = true }))
  }

  /// The same in a ⋯ (a phone's, and People's where the words don't fit).
  private func moreMenu(_ model: ArchiveModel, _ data: ReportArchive, _ period: AnalyticsPeriod) -> AnyView {
    var entries: [MenuEntry] = [.item(MenuItem("Export", key: "export", systemImage: Glyph.download) { exportIt(model, data, period) })]
    if canPost { entries.append(.item(MenuItem("Post this chart as a picture", key: "post", systemImage: ToolGlyph.picture) { postIt() })) }
    if widget != nil { entries.append(.item(MenuItem("Add to dashboard", key: "add", systemImage: Glyph.dashboards) { adding = true })) }
    return AnyView(
      MoreMenu(label: report.key == "people" ? "More for this report" : "More for this chart", entries: entries, size: .small)
        .accessibilityIdentifier("report-more"))
  }

  // MARK: What narrows it

  /// The engagement and people reports' first row: the direction
  /// (engagement), the kind of engagement, and whom to show (people, once
  /// follows are read); People's ends with what can be done with it.
  private func filters(_ model: ArchiveModel, _ data: ReportArchive, _ period: AnalyticsPeriod) -> AnyView? {
    guard showKind else { return nil }
    let row = ReportFilterRow(
      report: report.key, following: model.data.meta.following != nil,
      direction: Binding(get: { direction }, set: { next in
        if let navigator { ReportQuery.replace(navigator, "direction", next == "received" ? nil : next) }
      }),
      kind: $kind, relation: $relation)
    guard report.key == "people" else { return AnyView(ScrollRow { row }) }
    let menu = moreMenu(model, data, period).padding(.trailing, -Measure.Chart.footMenuBleed)
    if theme.isPhone {
      return AnyView(
        HStack(spacing: Measure.Reports.phoneFilterBarGap) {
          ScrollRow { row }
          menu
        })
    }
    let words = HStack(spacing: Measure.Reports.filterActionsGap) { chartActions(model, data, period) }
    return AnyView(
      ViewThatFits(in: .horizontal) {
        HStack(spacing: Measure.Reports.filterBarGap) {
          row.fixedSize()
          Spacer(minLength: 0)
          words.fixedSize()
        }
        HStack(spacing: Measure.Reports.filterBarGap) {
          ScrollRow { row }
          menu
        }
      })
  }
}

/// The row of small keys a report is narrowed by, a hairline between groups.
struct ReportFilterRow: View {
  @Environment(\.virgaTheme) private var theme
  let report: String
  let following: Bool
  @Binding var direction: String
  @Binding var kind: String
  @Binding var relation: String

  var body: some View {
    let kinds = report == "people" ? Analytics.eventKinds : Analytics.engagementKinds
    // At 760 and under the kinds are their glyphs, their names kept for VoiceOver.
    let glyphsOnly = theme.isTablet
    HStack(spacing: 0) {
      if report == "engagement" {
        Segmented(
          label: "Direction",
          options: [
            SegmentedOption("received", "Received", systemImage: Glyph.received), SegmentedOption("given", "Given", systemImage: Glyph.given),
          ], selection: $direction, size: .small)
        rule
      }
      Segmented(
        label: "Engagement type",
        options: kinds.map { k in
          let glyph = ReportParts.kindGlyph[k.key]
          return SegmentedOption(k.key, k.label, systemImage: glyph, iconOnly: glyphsOnly && glyph != nil)
        },
        selection: $kind, size: .small)
      if report == "people" && following {
        rule
        Segmented(
          label: "Show people",
          options: [SegmentedOption("all", "Everyone"), SegmentedOption("not", "Not following"), SegmentedOption("following", "Following")],
          selection: $relation, size: .small)
      }
    }
  }

  /// `.report-filters-rule`.
  private var rule: some View {
    Rectangle()
      .fill(theme.line)
      .frame(width: 1, height: Measure.Reports.filtersRuleHeight)
      .padding(.horizontal, Measure.Reports.filtersRuleMargin)
      .accessibilityHidden(true)
  }
}

/// Export, Post this chart and Add to dashboard, as link actions.
struct ReportActionWords: View {
  /// The chart's name when it can be posted as a picture.
  let widgetName: String?
  let canAdd: Bool
  let onExport: () -> Void
  let onPost: () -> Void
  let onAdd: () -> Void

  var body: some View {
    Button(action: onExport) {
      Label("Export", systemImage: Glyph.download)
    }
    .buttonStyle(.linkAction)
    .accessibilityIdentifier("report-export")
    if let widgetName {
      Button(action: onPost) {
        Label("Post this chart", systemImage: ToolGlyph.picture)
      }
      .buttonStyle(.linkAction)
      .accessibilityHint("\(widgetName), as a picture with its description")
      .accessibilityIdentifier("report-post-chart")
    }
    if canAdd {
      Button(action: onAdd) {
        Label("Add to dashboard", systemImage: Glyph.dashboards)
      }
      .buttonStyle(.linkAction)
      .accessibilityIdentifier("add-to-dashboard")
    }
  }
}

struct FollowersReportView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var mode = "cumulative"

  var body: some View {
    let unitPick = mode == "cumulative" || mode == "together" ? nil : AnalyticsUnit(mode)
    let m = ReportModels.followersModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick)
    let log = ReportModels.followerLogModel(archive)
    let together = mode == "together"
    let cumulative = mode == "cumulative" || together
    let series = ChartPoint.of(cumulative ? m.cumulative : m.counts)
    let days = ReportParts.days(period)
    let phrase = Periods.periodPhrase(period)
    // The figures that change shape, worked out first, so the list below
    // stays a short expression for the type checker.
    let listed: AnyView? = (m.counterGap ?? 0) != 0 ? AnyView(ListedNote(profileCount: m.profileCount ?? m.total, listed: m.total)) : nil
    let unfollows = Self.unfollowsFigure(log)
    if archive.followers.isEmpty {
      SyncEmpty(text: "Your followers haven’t been read yet. Run a sync to gather the list.")
    } else {
      FiguresView(
        [
          ReportParts.fig("Followers", text: ChartFormat.fmtFigure(Double(m.profileCount ?? m.total)), note: listed),
          ReportParts.fig(
            days ? "New in \(phrase)" : "Gained, all time", Double(m.gained),
            delta: days ? .some(m.compare.pct) : nil,
            deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil,
            sub: days ? "\(AppLocale.formatNumber(m.compare.previous)) \(Periods.periodBefore(period))" : nil),
          ReportParts.fig("Per day", m.perDay, decimals: true, sub: "Averaged over the window"),
          unfollows,
        ], label: "Followers in figures")
      ReportCard(
        title: "Growth",
        sub: cumulative
          ? "Followers over the window. The dashed reach is Bluesky’s profile counter."
          : "New followers per \(ChartFormat.unitNoun(m.unit)), dated by each follow record",
        tools: AnyView(
          Segmented(
            label: ReportParts.modeLabel,
            options: [
              SegmentedOption("cumulative", "Total", accessibilityLabel: "Running total over the window"),
              SegmentedOption("together", "With blocks", accessibilityLabel: "Followers and block reach on one chart"),
            ] + ReportParts.unitOptions(m.units, "New followers"),
            selection: $mode, size: .small))
      ) {
        SeriesChart(
          series: series, seriesLabel: together ? "Followers" : nil,
          secondary: together ? ChartSecondary(label: "Blocks", series: ChartPoint.of(m.blockCumulative)) : nil,
          mode: cumulative ? .line : .bars, unit: m.unit, zeroBase: !cumulative,
          ghost: !together && cumulative && (m.counterGap ?? 0) > 0 ? m.profileCount.map { ChartGhost(v: Double($0)) } : nil,
          marks: ChartNotesModels.marks(app, archive, cumulative ? m.cumulative : m.counts, m.unit, milestones: true), height: 280,
          accessibilityLabel: together
            ? "Followers and block reach over \(phrase)"
            : cumulative ? "Followers over \(phrase)" : "New followers per \(m.unit.rawValue) over \(phrase)")
        ChartTable(
          series: series, secondary: together ? ChartPoint.of(m.blockCumulative) : nil, unit: m.unit,
          valueHead: cumulative ? "Followers" : "New followers", secondaryHead: together ? "Blocks" : nil, trailing: more
        ) {
          if let actions { actions }
        }
      }
      FollowerLists(archive: archive, period: period, m: m)
      ChartNotes(did: archive.did)
      HowCounted(
        paragraphs: [
          "Virga walks your follower list and dates each follower by their follow record, so the total is the followers whose accounts exist right now.",
          "The diamonds on the chart mark the round numbers your count has passed, each on the day the follower who made it arrived. They are counted from the followers you have today, so if people have left since, you reached that number on that day or a little before it. Notes you add below are marked the same way.",
        ]
          + ((m.counterGap ?? 0) > 0
            ? [
              "Bluesky’s profile counter says \(AppLocale.formatNumber(m.profileCount ?? 0)). It keeps counting deactivated, suspended and deleted accounts, so the \(AppLocale.formatNumber(m.counterGap ?? 0))-account gap is followers who can’t currently be listed. The dashed reach on the chart marks that counter; it is not measured growth."
            ] : [])
          + [
            "The curve dates each follower by their follow record, so accounts that unfollowed are invisible to it. The Unfollow tracker finds them by comparing two syncs."
              + (m.undated > 0 ? " \(AppLocale.formatNumber(m.undated)) followers carry no readable follow date and sit outside the chart." : "")
          ])
    }
  }

  /// "Unfollows at the last sync": the count with the way to the Unfollow
  /// tracker once the log is kept, else when counting starts.
  static func unfollowsFigure(_ log: FollowerLogReport) -> FigureItem {
    if log.tracking {
      return ReportParts.fig(
        "Unfollows at the last sync", text: ChartFormat.fmtFigure(Double(log.latestLost.count)),
        note: AnyView(NoteLink(text: "Open the Unfollow tracker", to: "/tools/unfollow-tracker")))
    }
    return ReportParts.fig("Unfollows at the last sync", text: "—", sub: "Counted from your next sync")
  }
}

struct PostsReportView: View {
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var unitPick: String?

  var body: some View {
    let m = ReportModels.postsModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick.map { AnalyticsUnit($0) })
    let days = ReportParts.days(period)
    let pct = { (n: Int) -> Double in m.count != 0 ? (Double(n) / Double(m.count) * 100).jsRounded : 0 }
    if archive.posts.isEmpty {
      SyncEmpty(text: "The post archive is empty. Run a sync to build it.")
    } else {
      FiguresView(
        [
          ReportParts.fig(
            days ? "Posts in \(Periods.periodPhrase(period))" : "Posts, all time", Double(m.count),
            delta: days ? .some(m.compare.pct) : nil,
            deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil,
            sub: days ? "\(AppLocale.formatNumber(m.compare.previous)) \(Periods.periodBefore(period))" : nil),
          ReportParts.fig("Per day", m.perDay, decimals: true),
          ReportParts.fig("Replies", pct(m.replies), unit: "%", sub: "\(AppLocale.formatNumber(m.replies)) posts"),
          ReportParts.fig("With media", pct(m.withMedia), unit: "%", sub: "\(AppLocale.formatNumber(m.withMedia)) posts"),
        ], label: "Posts in figures")
      ReportSplit(wide: true) {
        ReportCard(
          title: "Posts per \(ChartFormat.unitNoun(m.unit))", sub: "With the moving average",
          tools: AnyView(
            Segmented(
              label: ReportParts.modeLabel, options: ReportParts.unitOptions(m.units, "Posts"), selection: m.unit.rawValue, size: .small
            ) { unitPick = $0 })
        ) {
          SeriesChart(
            series: ChartPoint.of(m.counts), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
            marks: ChartNotesModels.marks(app, archive, m.counts, m.unit), height: 260,
            accessibilityLabel: "Posts per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
          ChartTable(series: ChartPoint.of(m.counts), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "Posts", trailing: more) {
            if let actions { actions }
          }
        }
        ReportCard(title: "What kind of posts", sub: "Of the \(AppLocale.formatNumber(m.count)) in the window", tools: nil) {
          BarList(
            rows: [
              BarListRow(key: "standalone", label: "Standalone", value: Double(m.originals - m.quotes)),
              BarListRow(key: "replies", label: "Replies", value: Double(m.replies)),
              BarListRow(key: "quotes", label: "Quote posts", value: Double(m.quotes)),
              BarListRow(key: "media", label: "With media", value: Double(m.withMedia)),
            ], max: Double(max(m.count, 1)), accessibilityLabel: "Posts by kind")
        }
      }
      ChartNotes(did: archive.did)
      HowCounted(paragraphs: [
        "Every post in your archive, dated by when it was written, in your time zone. Replies to other people and to yourself both count as posts here; the engagement rate leaves replies to other people out."
      ])
    }
  }
}

/// The engagement report, received: what your posts earned.
struct EngagementReportView: View {
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var kind = "all"
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var unitPick: String?
  @State private var rateUnitPick: String?

  var body: some View {
    let m = ReportModels.engagementModel(
      archive, period, archive.nowMs ?? SyncStatus.now(), kind: kind, unit: unitPick.map { AnalyticsUnit($0) },
      rateUnit: rateUnitPick.map { AnalyticsUnit($0) })
    if archive.posts.isEmpty {
      SyncEmpty(text: "The post archive is empty. Run a sync to build it.")
    } else {
      figures(m)
      ReportSplit(wide: true) {
        lead(m)
        if kind == "all" {
          ReportCard(title: "By type", sub: "Of \(AppLocale.formatNumber(m.total)) in the window", tools: nil) {
            BarList(
              rows: m.byKind.map { BarListRow(key: $0.kind, label: $0.label, value: Double($0.value), systemImage: ReportParts.kindGlyph[$0.kind]) },
              accessibilityLabel: "Engagement by type")
          }
        }
      }
      rate(m)
      TopPostsCard(archive: archive, posts: m.top, kind: kind)
      HowCounted(paragraphs: [
        "Counted against the day each post was made, with counts as of the last sync. A bar is how much that \(ChartFormat.unitNoun(m.unit))’s posts have earned, not when it arrived. The newest posts are still collecting engagement, so the last bars run low.",
        "The rate averages over the posts made each \(ChartFormat.unitNoun(m.rateUnit)): your top-level posts and the replies in your own threads. A gap is a \(ChartFormat.unitNoun(m.rateUnit)) with nothing posted."
          + (m.ownPosts > 0 ? " \(AppLocale.formatNumber(m.ownPosts)) \(m.ownPosts == 1 ? "post" : "posts") in this window." : ""),
      ])
    }
  }

  private func figures(_ m: EngagementReport) -> some View {
    let days = ReportParts.days(period)
    let head = ReportParts.head(kind)
    // Each figure's parts worked out first, so the list below stays a
    // short expression for the type checker.
    let received: FigureItem = ReportParts.fig(
      kind == "all" ? "Received" : "\(head) received", Double(m.total),
      delta: days ? .some(m.compare.pct) : nil,
      deltaTitle: days ? "On posts from \(Periods.periodBefore(period)): \(AppLocale.formatNumber(m.compare.previous))" : nil,
      sub: "On \(AppLocale.formatNumber(m.posts)) posts")
    var rateDelta: Double?? = nil
    var rateTitle: String? = nil
    if let compare = m.rateCompare {
      rateDelta = .some(compare.pct)
      rateTitle = "\(Periods.periodBefore(period, true)): \(ChartFormat.fmtRate(compare.previous))"
    }
    let perPost: FigureItem = ReportParts.fig(
      "Per post", text: m.ownRate == nil ? "—" : ChartFormat.fmtRate(m.ownRate), delta: rateDelta, deltaTitle: rateTitle,
      sub: "Posts and threads")
    var bestCount = 0
    var bestWhen: String? = nil
    if let best = m.top.first {
      bestCount = Analytics.engagementOf(best, kind)
      bestWhen = Time.formatDateShort(best.at ?? "")
    }
    let bestPost: FigureItem = ReportParts.fig("Best post", Double(bestCount), sub: bestWhen)
    return FiguresView([received, perPost, bestPost], label: "Engagement in figures")
  }

  private func lead(_ m: EngagementReport) -> some View {
    let head = ReportParts.head(kind)
    return ReportCard(
      title: "\(head) by post date", sub: "What each \(ChartFormat.unitNoun(m.unit))’s posts have earned, as of the last sync",
      tools: AnyView(
        Segmented(
          label: ReportParts.modeLabel, options: ReportParts.unitOptions(m.units, head), selection: m.unit.rawValue, size: .small
        ) { unitPick = $0 })
    ) {
      SeriesChart(
        series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
        marks: ChartNotesModels.marks(app, archive, m.series, m.unit), height: 260,
        accessibilityLabel: "\(head) on posts made each \(m.unit.rawValue), over \(Periods.periodPhrase(period))")
      ChartTable(series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: head, trailing: more) {
        if let actions { actions }
      }
    }
  }

  /// The engagement rate: per post, by the bucket each post was made in.
  private func rate(_ m: EngagementReport) -> some View {
    let head = ReportParts.head(kind)
    let rateFormat: (Double?) -> String = { ChartFormat.fmtRate($0) }
    let buckets = m.rate.map { SeriesPoint(t: $0.t, v: $0.v ?? 0) }
    return ReportCard(
      title: kind == "all" ? "Engagement rate" : "\(head) per post",
      sub: "Per post, over your posts and threads only, so replies to other people don’t pull it down",
      tools: AnyView(
        Segmented(
          label: ReportParts.modeLabel, options: ReportParts.unitOptions(m.units, "Per post"), selection: m.rateUnit.rawValue, size: .small
        ) { rateUnitPick = $0 })
    ) {
      SeriesChart(
        series: ChartPoint.of(m.rate), trend: ChartPoint.of(m.rateTrend), mode: .bars, unit: m.rateUnit, format: rateFormat,
        marks: ChartNotesModels.marks(app, archive, buckets, m.rateUnit), height: 240,
        accessibilityLabel: "\(head) per post, by the \(m.rateUnit.rawValue) each post was made")
      ChartTable(
        series: ChartPoint.of(m.rate), secondary: m.rate.map { ChartPoint(t: $0.t, v: $0.posts) }, trend: ChartPoint.of(m.rateTrend),
        unit: m.rateUnit, valueHead: "Per post", secondaryHead: "Posts", format: rateFormat)
    }
  }
}
#endif

#if canImport(UIKit)
/// The engagement report's other direction: what you gave.
struct GivenReportView: View {
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let kind: String
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var unitPick: String?

  var body: some View {
    let m = ReportModels.givenModel(archive, period, archive.nowMs ?? SyncStatus.now(), kind: kind, unit: unitPick.map { AnalyticsUnit($0) })
    let days = ReportParts.days(period)
    let head = ReportParts.head(kind)
    let coverage = archive.meta.outbound?.coverageMs ?? 0
    if archive.posts.isEmpty && archive.outbound.isEmpty {
      SyncEmpty(text: "Nothing given on record yet. Run a sync to build the archive.")
    } else {
      FiguresView(
        [
          ReportParts.fig(
            kind == "all" ? "Given" : "\(head) given", Double(m.total), delta: days ? .some(m.compare.pct) : nil,
            deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil),
          ReportParts.fig("Per day", m.perDay, decimals: true),
          ReportParts.fig("Accounts", Double(m.accounts), sub: "Engaged with"),
        ], label: "Engagement given in figures")
      ReportSplit(wide: true) {
        ReportCard(
          title: "\(head) given per \(ChartFormat.unitNoun(m.unit))", sub: "Counted on the day you gave it",
          tools: AnyView(
            Segmented(
              label: ReportParts.modeLabel, options: ReportParts.unitOptions(m.units, "\(head) given"), selection: m.unit.rawValue,
              size: .small
            ) { unitPick = $0 })
        ) {
          SeriesChart(
            series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit, height: 260,
            accessibilityLabel: "\(head) given per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
          ChartTable(series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "\(head) given", trailing: more) {
            if let actions { actions }
          }
        }
        if kind == "all" {
          ReportCard(title: "By type", sub: nil, tools: nil) {
            BarList(
              rows: m.byKind.map { k in
                let noun = ReportModels.givenNoun.first { $0.kind == k.kind }?.noun ?? k.kind
                return BarListRow(
                  key: k.kind, label: noun.prefix(1).uppercased() + noun.dropFirst(), value: Double(k.count), systemImage: ReportParts.kindGlyph[k.kind])
              }, accessibilityLabel: "Engagement given by type")
          }
        }
      }
      HowCounted(paragraphs: [
        "Likes and reposts come from your repo"
          + (coverage > 0 ? ", which reaches back to \(Time.formatDateShort(coverage)) so far" : ", every one you have ever made")
          + "; replies and quotes from the post archive. Replies and quotes aimed at your own posts are threading, not engagement, and are left out. Who you engage with most is in the People report."
      ])
    }
  }
}
#endif
