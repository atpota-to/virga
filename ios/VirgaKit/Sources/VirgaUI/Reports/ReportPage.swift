// Ports src/reports/ReportPage.jsx (ReportsIndex, the followers, posts and engagement reports)
// Ports src/reports/parts.jsx (Card, unitOptions, fig)
// Ports src/reports/reports.css (.report-index, .report-tile)
//
// Reports: the index, each report as its leading figure under a rule (the
// number is the way in), and a report's own page: its header with the
// period picker, its figures, and its charts each under a card's title
// with its modes, every chart with its table. Over VirgaInsights' report
// models for the period chosen.
//
// Every report is here: Followers, Posts and Engagement (below), Content
// (ContentReport.swift), and Blocks, People and Atmosphere
// (MoreReports.swift). Still to come in these: the followers' newest list
// and biggest days, the top posts, the given direction and its kinds, and
// Add to dashboard.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// `unitOptions(units, noun)`: a bucket's keys for a chart's modes.
enum ReportParts {
  static func unitOptions(_ units: [AnalyticsUnit], _ noun: String) -> [SegmentedOption<String>] {
    units.map { u in
      SegmentedOption(u.rawValue, ChartFormat.unitLabel(u), accessibilityLabel: "\(noun) per \(ChartFormat.unitNoun(u))")
    }
  }

  /// `fig(label, value, { delta, deltaTitle, sub, decimals })`.
  static func fig(_ label: String, _ value: Double?, decimals: Bool = false, unit: String = "", delta: Double?? = nil, deltaTitle: String? = nil, sub: String? = nil) -> FigureItem {
    let shown = value.map { ChartFormat.fmtFigure($0, decimals: decimals) + unit }
    let note: AnyView?
    if delta != nil || sub != nil {
      note = AnyView(FigureNote(delta: delta, deltaTitle: deltaTitle, words: sub))
    } else {
      note = nil
    }
    return FigureItem(label: label, value: shown.map { .text($0) } ?? .text("—"), note: note)
  }
}

/// `Card`: a report's band, its title and line, and its modes at the right.
struct ReportCard<Content: View>: View {
  let title: String
  let sub: String?
  let tools: AnyView?
  @ViewBuilder let content: () -> Content

  var body: some View {
    VirgaSection(title: title, sub: sub, trailing: tools) {
      content()
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
    VirgaPage(
      header: PageHeader(
        PageHeaderModel(title: "Reports", sub: "Every number Virga works out, one page each."), actions: AnyView(PeriodPicker()))
    ) {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: Measure.Reports.tileMin), spacing: theme.gridGapX, alignment: .top)], alignment: .leading,
        spacing: theme.gridGap
      ) {
        ForEach(ReportsRegistry.reports, id: \.key) { report in
          Button {
            navigate("/reports/\(report.key)")
          } label: {
            VStack(alignment: .leading, spacing: theme.space2) {
              HStack(spacing: Measure.Dashboard.statLabelGap) {
                Image(systemName: report.sfSymbol).font(.system(size: Measure.Dashboard.statIcon))
                Text(report.label)
              }
              .virgaText(.textSm, weight: VirgaWeight.medium)
              .foregroundStyle(theme.ink2)
              if let h = headline[report.key] {
                Text(h.0)
                  .virgaText(size: theme.figureSize, weight: VirgaWeight.medium, lineHeight: 1, tracking: Measure.Dashboard.statTracking)
                  .foregroundStyle(theme.ink)
                Text(h.1).virgaText(.textSm).foregroundStyle(theme.muted)
              }
              Text(report.desc)
                .virgaText(.textSm)
                .foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, Measure.Dashboard.statPaddingTop)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 2) }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(.isLink)
          .accessibilityIdentifier("report-\(report.key)")
        }
      }
    }
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

/// A report's page.
struct ReportPage: View {
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let report: ReportEntry
  @State private var adding = false
  @State private var kind = "all"
  @State private var direction = "received"
  @State private var relation = "all"

  var body: some View {
    let widget = ReportWidgets.byReport[report.key].flatMap { Catalog.widgets[$0] }
    let header = PageHeader(
      PageHeaderModel(title: report.label, sub: report.desc, crumbs: [Crumb("Reports", to: "/reports")]),
      actions: AnyView(
        HStack(spacing: Measure.Chart.footGap) {
          if widget != nil {
            Button {
              adding = true
            } label: {
              Label("Add to dashboard", systemImage: Glyph.dashboards)
            }
            .buttonStyle(.linkAction)
            .accessibilityIdentifier("add-to-dashboard")
          }
          PeriodPicker()
        }), extra: filters)
    if let archive, ["followers", "posts", "engagement", "content", "blocks", "people", "atmosphere"].contains(report.key) {
      let period = preferences.period()
      let data = ReportArchive(archive)
      VirgaPage(header: header) {
        switch report.key {
        case "followers": FollowersReportView(archive: data, period: period)
        case "posts": PostsReportView(archive: data, period: period)
        case "content": ContentReportView(archive: data, period: period)
        case "blocks": BlocksReportView(archive: data, period: period)
        case "people": PeopleReportView(archive: data, period: period, kind: kind, relation: relation)
        case "atmosphere": AtmosphereReportView(archive: data, period: period)
        default: EngagementReportView(archive: data, period: period, kind: kind, given: direction == "given")
        }
      }
      .virgaDialog(isPresented: $adding, title: "Add \(widget?.name ?? report.label) to a dashboard") {
        if let widget { AddToDashboard(widget: widget) { adding = false } }
      }
    } else {
      UnportedPage(PageHeaderModel(title: report.label, sub: report.desc, crumbs: [Crumb("Reports", to: "/reports")]))
    }
  }
}

extension ReportPage {
  /// The engagement and people reports' filters: the direction (engagement),
  /// the kind of engagement, and whom to show (people).
  var filters: AnyView? {
    guard report.key == "engagement" || report.key == "people" else { return nil }
    let kinds = report.key == "people" ? Analytics.eventKinds : Analytics.engagementKinds
    return AnyView(
      FlowLayout(spacing: 24, lineSpacing: 12) {
        if report.key == "engagement" {
          Segmented(
            label: "Direction",
            options: [
              SegmentedOption("received", "Received", systemImage: Glyph.received), SegmentedOption("given", "Given", systemImage: Glyph.given),
            ], selection: $direction, size: .small)
        }
        Segmented(
          label: "Engagement type", options: kinds.map { SegmentedOption($0.key, $0.label, systemImage: WidgetParts.kindGlyph[$0.key]) },
          selection: $kind, size: .small)
        if report.key == "people" {
          Segmented(
            label: "Show people",
            options: [SegmentedOption("all", "Everyone"), SegmentedOption("not", "Not following"), SegmentedOption("following", "Following")],
            selection: $relation, size: .small)
        }
      })
  }
}

struct FollowersReportView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  @State private var mode = "cumulative"

  var body: some View {
    let unitPick = mode == "cumulative" || mode == "together" ? nil : AnalyticsUnit(mode)
    let m = ReportModels.followersModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick)
    let log = ReportModels.followerLogModel(archive)
    let together = mode == "together"
    let cumulative = mode == "cumulative" || together
    let series = ChartPoint.of(cumulative ? m.cumulative : m.counts)
    let days = period.days.map { $0 != 0 } ?? false
    if archive.followers.isEmpty {
      EmptyState("Your followers haven’t been read yet. Run a sync to gather the list.")
    } else {
      FiguresView(
        [
          ReportParts.fig(
            "Followers", Double(m.profileCount ?? m.total),
            sub: (m.counterGap ?? 0) != 0 ? "\(AppLocale.formatNumber(m.total)) can be listed" : nil),
          ReportParts.fig(
            days ? "New in \(Periods.periodPhrase(period))" : "Gained, all time", Double(m.gained),
            delta: days ? .some(m.compare.pct) : nil,
            deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil,
            sub: days ? "\(AppLocale.formatNumber(m.compare.previous)) \(Periods.periodBefore(period))" : nil),
          ReportParts.fig("Per day", m.perDay, decimals: true, sub: "Averaged over the window"),
          FigureItem(
            label: "Unfollows at the last sync", value: log.tracking ? .number(Double(log.latestLost.count)) : .text("—"),
            note: AnyView(Text(log.tracking ? "Open the Unfollow tracker" : "Counted from your next sync"))),
        ], label: "Followers in figures")
      ReportCard(
        title: "Growth",
        sub: cumulative
          ? "Followers over the window. The dashed reach is Bluesky’s profile counter."
          : "New followers per \(ChartFormat.unitNoun(m.unit)), dated by each follow record",
        tools: AnyView(
          Segmented(
            label: "Growth",
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
          accessibilityLabel: cumulative
            ? "Followers over \(Periods.periodPhrase(period))" : "New followers per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
        ChartTable(
          series: series, secondary: together ? ChartPoint.of(m.blockCumulative) : nil, unit: m.unit,
          valueHead: cumulative ? "Followers" : "New followers", secondaryHead: together ? "Blocks" : nil)
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
}

struct PostsReportView: View {
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  @State private var unitPick: String?

  var body: some View {
    let m = ReportModels.postsModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick.map { AnalyticsUnit($0) })
    let days = period.days.map { $0 != 0 } ?? false
    let pct = { (n: Int) -> Double in m.count != 0 ? (Double(n) / Double(m.count) * 100).jsRounded : 0 }
    if archive.posts.isEmpty {
      EmptyState("The post archive is empty. Run a sync to build it.")
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
      ReportCard(
        title: "Posts per \(ChartFormat.unitNoun(m.unit))", sub: "With the moving average",
        tools: AnyView(
          Segmented(
            label: "Posts per", options: ReportParts.unitOptions(m.units, "Posts"), selection: m.unit.rawValue, size: .small
          ) { unitPick = $0 })
      ) {
        SeriesChart(
          series: ChartPoint.of(m.counts), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
          marks: ChartNotesModels.marks(app, archive, m.counts, m.unit), height: 260,
          accessibilityLabel: "Posts per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
        ChartTable(series: ChartPoint.of(m.counts), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "Posts")
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
      ChartNotes(did: archive.did)
    }
  }
}

struct EngagementReportView: View {
  @Environment(AppModel.self) private var app
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var kind = "all"
  var given = false
  @State private var unitPick: String?

  var body: some View {
    let m = ReportModels.engagementModel(archive, period, archive.nowMs ?? SyncStatus.now(), kind: kind, unit: unitPick.map { AnalyticsUnit($0) })
    if given {
      GivenReportView(archive: archive, period: period, kind: kind)
    } else {
      received(m)
    }
  }

  @ViewBuilder
  private func received(_ m: EngagementReport) -> some View {
    let days = period.days.map { $0 != 0 } ?? false
    FiguresView(
      [
        ReportParts.fig(
          days ? "Received in \(Periods.periodPhrase(period))" : "Received, all time", Double(m.total),
          delta: days ? .some(m.compare.pct) : nil,
          deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil),
        ReportParts.fig("Per post", m.ownRate, decimals: true),
      ], label: "Engagement in figures")
    ReportCard(
      title: "Engagement over time", sub: "What each \(ChartFormat.unitNoun(m.unit))’s posts have earned",
      tools: AnyView(
        Segmented(
          label: "Engagement per", options: ReportParts.unitOptions(m.units, "Engagement"), selection: m.unit.rawValue, size: .small
        ) { unitPick = $0 })
    ) {
      SeriesChart(
        series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
        marks: ChartNotesModels.marks(app, archive, m.series, m.unit), height: 260,
        accessibilityLabel: "Engagement on posts made each \(m.unit.rawValue), over \(Periods.periodPhrase(period))")
      ChartTable(series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "Engagement")
    }
    ReportCard(title: "By kind", sub: nil, tools: nil) {
      BarList(
        rows: m.byKind.map { BarListRow(key: $0.kind, label: $0.label, value: Double($0.value)) }, accessibilityLabel: "Engagement by kind")
    }
    TopPostsCard(archive: archive, posts: m.top, kind: kind)
  }
}
#endif

#if canImport(UIKit)
/// The engagement report's other direction: what you gave.
struct GivenReportView: View {
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let kind: String
  @State private var unitPick: String?

  var body: some View {
    let m = ReportModels.givenModel(archive, period, archive.nowMs ?? SyncStatus.now(), kind: kind, unit: unitPick.map { AnalyticsUnit($0) })
    let days = period.days.map { $0 != 0 } ?? false
    let head = kind == "all" ? "Engagement" : Analytics.engagementKinds.first { $0.key == kind }?.label ?? "Engagement"
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
      ReportCard(
        title: "\(head) given per \(ChartFormat.unitNoun(m.unit))", sub: "Counted on the day you gave it",
        tools: AnyView(
          Segmented(label: "Chart", options: ReportParts.unitOptions(m.units, "\(head) given"), selection: m.unit.rawValue, size: .small) {
            unitPick = $0
          })
      ) {
        SeriesChart(
          series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit, height: 260,
          accessibilityLabel: "\(head) given per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
        ChartTable(series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "\(head) given")
      }
      if kind == "all" {
        ReportCard(title: "By type", sub: nil, tools: nil) {
          BarList(
            rows: m.byKind.map { k in
              let noun = ReportModels.givenNoun.first { $0.kind == k.kind }?.noun ?? k.kind
              return BarListRow(
                key: k.kind, label: noun.prefix(1).uppercased() + noun.dropFirst(), value: Double(k.count), systemImage: WidgetParts.kindGlyph[k.kind])
            }, accessibilityLabel: "Engagement given by type")
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
