// Ports src/dashboards/widgets/index.jsx (the figures, the charts and Best time)
// Ports src/dashboards/widgets/parts.jsx
// Ports src/dashboards/widgets/content.jsx (its place in the library)
// Ports src/dashboards/widgets/posting.jsx (its place in the library)
// Ports src/dashboards/dashboards.css (.stat, .widget-insight, .widget-foot)
//
// What each card on a dashboard draws, from the shared report models
// (VirgaInsights' ReportModels) for the dashboard's period (or the card's
// own), so a card says the same as the report it links to. A figure (kind
// "stat") is a Stat: its label (a link to its report), the window it
// answers for, the number at --figure-size, its trend beside it where the
// card is wide enough, and a line under it (the change against the window
// before, and a note in parts). The charts are SeriesChart at the height
// for their size, and Best time is its sentence, the heatmap and its foot.
//
// Here: the followers, new followers, engagement and posts figures;
// follower growth, new followers, engagement over time, engagement rate,
// posting cadence and Best time; every other card is MoreWidget's
// (MoreWidgets.swift). The posting cards (scheduled posts, timers, what
// goes out next, drafts) say they need the composer, which isn't ported.
// The chart cards carry the notes, and the follower cards the milestones
// (ChartNotesModels.marks, useChartMarks).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

extension Unported {
  /// A card whose body isn't ported yet.
  public static let card = "This card isn’t in the iOS app yet."
  /// A posting card: it needs the composer.
  public static let postingCard = "This card needs the composer, which isn’t in the iOS app yet."
}

/// `ROWS`, `HEIGHT`: a list's rows and a chart's height by the card's size.
enum WidgetParts {
  static let rows: [String: Int] = ["xs": 3, "s": 4, "m": 5, "l": 6, "xl": 8]
  static let height: [String: CGFloat] = ["xs": 140, "s": 150, "m": 180, "l": 220, "xl": 240]

  static func height(_ size: String) -> CGFloat { height[size] ?? 180 }

  /// `KIND_ICON`.
  static let kindGlyph: [String: String] = ["like": Glyph.heart, "repost": Glyph.repost, "reply": Glyph.reply, "quote": Glyph.quote]

  /// `KIND_NOUN`, and the word for every kind.
  static let kindNoun: [String: String] = ["like": "Likes", "repost": "Reposts", "reply": "Replies", "quote": "Quotes"]

  static func kindWord(_ kind: String, _ all: String) -> String { kindNoun[kind] ?? all }

  /// `compareTitle(period, previous)`.
  static func compareTitle(_ period: AnalyticsPeriod, _ previous: Double) -> String? {
    guard let days = period.days, days != 0 else { return nil }
    return "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(previous.jsRounded))"
  }

  /// `bestTimeWindow(period)`: under 90 days, the last year.
  static func bestTimeWindow(_ period: AnalyticsPeriod) -> AnalyticsPeriod {
    if let days = period.days, days != 0, days < 90 { return AnalyticsPeriod(key: "1y", days: 365, label: "Year") }
    return period
  }

  static func bestTimeSentence(_ m: BestTimeReport) -> String {
    guard let top = m.best.first else { return "Not enough posts yet to say when yours do best." }
    let against = m.overall.map { ", against \(ChartFormat.fmtRate($0)) overall" } ?? ""
    return
      "Your posts do best on \(ReportModels.weekdaysLong[top.day])s, \(ReportModels.hourRange(top.col, m.block)): a typical post there earns \(ChartFormat.fmtRate(top.avg))\(against)."
  }

  /// `bestTimeRows(m)`: the reader's week, the best cell marked.
  static func bestTimeRows(_ m: BestTimeReport) -> [HeatmapRow] {
    let best = m.best.first
    return ReportModels.weekdayOrder().compactMap { day in
      guard m.rows.indices.contains(day) else { return nil }
      let row = m.rows[day]
      let cells = row.cells.enumerated().map { col, cell in
        let when = "\(ReportModels.weekdays[day]) \(ReportModels.hourRange(col, m.block))"
        let title =
          cell.avg == nil
          ? "\(when): \(cell.posts != 0 ? "only \(cell.posts) post\(cell.posts == 1 ? "" : "s")" : "no posts")"
          : "\(when): a typical post earns \(ChartFormat.fmtRate(cell.avg)) (\(cell.posts) posts)"
        return HeatmapCell(value: cell.avg, title: title, best: best.map { $0.day == day && $0.col == col } ?? false)
      }
      return HeatmapRow(label: row.label, cells: cells)
    }
  }
}

/// What a card draws for its type.
struct WidgetBody: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let card: DashboardCard
  let def: WidgetDef
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let title: String?
  /// The follower chart's view (WIDGET_HEADS): "total" or "new".
  var view = "total"

  private var kind: String { card.options?.kind ?? "all" }
  private var nowMs: Double { archive.nowMs ?? SyncStatus.now() }

  var body: some View {
    switch card.type {
    case "stat-followers": statFollowers
    case "stat-new-followers": statNewFollowers
    case "stat-engagement": statEngagement
    case "stat-posts": statPosts
    case "follower-growth": followerGrowth
    case "new-followers": newFollowers
    case "engagement-over-time": engagementOverTime
    case "engagement-rate": engagementRate
    case "posting-cadence": postingCadence
    case "best-time": bestTime
    default:
      MoreWidget(card: card, def: def, archive: archive, period: period, title: title)
    }
  }

  // MARK: Figures

  /// A card wide enough draws its trend beside the number; a quarter of a
  /// row doesn't.
  private func spark(_ values: [Double]) -> [Double]? {
    card.size == "xs" ? nil : values
  }

  private func change(_ compare: PeriodComparison) -> DeltaView? {
    guard let days = period.days, days != 0, compare.previous != 0 else { return nil }
    return DeltaView(pct: compare.pct, title: WidgetParts.compareTitle(period, compare.previous))
  }

  private var statFollowers: some View {
    let m = ReportModels.followersModel(archive, period, nowMs)
    let lead = m.profileCount ?? m.total
    let differs = m.profileCount.map { $0 != m.total } ?? false
    return Stat(
      icon: def.sfSymbol, label: title ?? "Followers", to: def.href, window: "Now",
      value: ChartFormat.fmtFigure(Double(lead)),
      delta: AnyView(
        Text("+\(AppLocale.formatNumber(m.gained))").virgaText(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight)
          .foregroundStyle(theme.ink)
          .accessibilityHint("New in \(Periods.periodPhrase(period))")),
      sub: differs ? "\(AppLocale.formatNumber(m.total)) can be listed" : nil,
      spark: spark(m.cumulative.map(\.v)))
  }

  private var statNewFollowers: some View {
    let m = ReportModels.followersModel(archive, period, nowMs)
    let sub: String
    if period.days == nil || period.days == 0 {
      sub = "\(ChartFormat.fmtFigure(m.perDay, decimals: true)) a day"
    } else if m.compare.previous != 0 {
      sub = "\(AppLocale.formatNumber(m.compare.previous)) \(Periods.periodBefore(period))"
    } else {
      sub = "None \(Periods.periodBefore(period))"
    }
    return Stat(
      icon: def.sfSymbol, label: title ?? "New followers", to: def.href, window: Periods.periodWindowWord(period),
      value: ChartFormat.fmtFigure(Double(m.gained)), delta: change(m.compare).map { AnyView($0) }, sub: sub,
      spark: spark(m.counts.map(\.v)))
  }

  private var statEngagement: some View {
    let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind)
    return Stat(
      icon: def.sfSymbol, label: title ?? WidgetParts.kindWord(kind, "Engagement"), to: def.href,
      window: Periods.periodWindowWord(period), value: ChartFormat.fmtFigure(Double(m.total)),
      delta: change(m.compare).map { AnyView($0) },
      sub: m.ownRate.map { "\(ChartFormat.fmtRate($0)) per post" } ?? "No posts in this window", spark: spark(m.series.map(\.v)))
  }

  private var statPosts: some View {
    let m = ReportModels.postsModel(archive, period, nowMs)
    let replies = m.count != 0 ? Int((Double(m.replies) / Double(m.count) * 100).jsRounded) : 0
    return Stat(
      icon: def.sfSymbol, label: title ?? "Posts", to: def.href, window: Periods.periodWindowWord(period),
      value: ChartFormat.fmtFigure(Double(m.count)), delta: change(m.compare).map { AnyView($0) },
      sub: "\(ChartFormat.fmtFigure(m.perDay, decimals: true)) a day · \(replies)% replies", spark: spark(m.counts.map(\.v)))
  }

  // MARK: Charts

  @ViewBuilder private var followerGrowth: some View {
    let m = ReportModels.followersModel(archive, period, nowMs)
    if archive.followers.isEmpty {
      EmptyState("Your followers haven’t been read yet.")
    } else {
      let total = view != "new"
      SeriesChart(
        series: ChartPoint.of(total ? m.cumulative : m.counts), mode: total ? .line : .bars, unit: m.unit, zeroBase: !total,
        ghost: total && (m.counterGap ?? 0) > 0 ? m.profileCount.map { ChartGhost(v: Double($0)) } : nil,
        marks: ChartNotesModels.marks(app, archive, total ? m.cumulative : m.counts, m.unit, milestones: true),
        height: WidgetParts.height(card.size),
        accessibilityLabel: total
          ? "Followers over \(Periods.periodPhrase(period))" : "New followers per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
    }
  }

  @ViewBuilder private var newFollowers: some View {
    let m = ReportModels.followersModel(archive, period, nowMs)
    if archive.followers.isEmpty {
      EmptyState("Your followers haven’t been read yet.")
    } else {
      SeriesChart(
        series: ChartPoint.of(m.counts), trend: ChartPoint.of(Analytics.movingAverage(m.counts, 7)), mode: .bars, unit: m.unit,
        marks: ChartNotesModels.marks(app, archive, m.counts, m.unit, milestones: true), height: WidgetParts.height(card.size),
        accessibilityLabel: "New followers per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
    }
  }

  private var engagementOverTime: some View {
    let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind)
    return SeriesChart(
      series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
      marks: ChartNotesModels.marks(app, archive, m.series, m.unit), height: WidgetParts.height(card.size),
      accessibilityLabel:
        "\(WidgetParts.kindWord(kind, "Engagement")) on posts made each \(m.unit.rawValue), over \(Periods.periodPhrase(period))")
  }

  private var engagementRate: some View {
    let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind)
    return SeriesChart(
      series: ChartPoint.of(m.rate), trend: ChartPoint.of(m.rateTrend), mode: .bars, unit: m.rateUnit,
      format: { ChartFormat.fmtRate($0) }, height: WidgetParts.height(card.size),
      accessibilityLabel:
        "\(WidgetParts.kindWord(kind, "Engagement")) per post, by the \(m.rateUnit.rawValue) each post was made, over \(Periods.periodPhrase(period))"
    )
  }

  private var postingCadence: some View {
    let m = ReportModels.postsModel(archive, period, nowMs)
    return SeriesChart(
      series: ChartPoint.of(m.counts), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit,
      marks: ChartNotesModels.marks(app, archive, m.counts, m.unit), height: WidgetParts.height(card.size),
      accessibilityLabel: "Posts per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
  }

  private var bestTime: some View {
    let window = WidgetParts.bestTimeWindow(period)
    let m = ReportModels.bestTimeModel(archive, window, nowMs)
    let sentence = WidgetParts.bestTimeSentence(m)
    return VStack(alignment: .leading, spacing: theme.space3) {
      Text(sentence)
        .virgaText(.textBase)
        .foregroundStyle(theme.ink2)
        .fixedSize(horizontal: false, vertical: true)
      Heatmap(rows: WidgetParts.bestTimeRows(m), columns: ReportModels.hourColumns(m.block).map { HeatmapColumn(label: $0.label, span: $0.span) }, summary: sentence)
      Text("\(AppLocale.formatNumber(m.posts)) posts and threads over \(Periods.periodPhrase(window)), in your time zone.")
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// `Stat`: a figure tile, under a 2-point rule in --line.
struct Stat: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let icon: String?
  let label: String
  let to: String?
  let window: String?
  let value: String
  let delta: AnyView?
  let sub: String?
  let spark: [Double]?

  var body: some View {
    VStack(alignment: .leading, spacing: Measure.Dashboard.statGap) {
      HStack(spacing: Measure.Dashboard.statHeadGap) {
        Button {
          if let to { navigate(to) }
        } label: {
          HStack(spacing: Measure.Dashboard.statLabelGap) {
            if let icon { Image(systemName: icon).font(.system(size: Measure.Dashboard.statIcon)) }
            Text(label).lineLimit(1)
          }
        }
        .buttonStyle(.plain)
        .disabled(to == nil)
        .accessibilityAddTraits(to == nil ? [] : .isLink)
        Spacer(minLength: 0)
        if let window {
          Text(window).foregroundStyle(theme.muted).lineLimit(1)
        }
      }
      .virgaText(.textSm, weight: VirgaWeight.medium)
      .foregroundStyle(theme.ink2)
      HStack(alignment: .bottom, spacing: Measure.Dashboard.statLineGap) {
        Text(value)
          .virgaText(size: theme.figureSize, weight: VirgaWeight.medium, lineHeight: 1, tracking: Measure.Dashboard.statTracking)
          .foregroundStyle(theme.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        if let spark {
          Sparkline(values: spark.map { Optional($0) })
            .frame(minWidth: Measure.Dashboard.sparkMinWidth, maxWidth: Measure.Dashboard.sparkMaxWidth)
        }
      }
      if delta != nil || sub != nil {
        FlowLayout(spacing: Measure.Dashboard.noteGap, lineSpacing: 2) {
          if let delta { delta }
          if let sub {
            ForEach(Array(sub.components(separatedBy: " · ").enumerated()), id: \.offset) { _, part in
              Text(part)
            }
          }
        }
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
    }
    .padding(.top, theme.isPhone ? Measure.Dashboard.phoneStatPaddingTop : Measure.Dashboard.statPaddingTop)
    .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 2) }
    .accessibilityElement(children: .combine)
  }
}
#endif
