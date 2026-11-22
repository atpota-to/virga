// Ports src/dashboards/widgets/index.jsx (the other figures, charts and lists)
// Ports src/dashboards/widgets/content.jsx
//
// The cards WidgetBody hands on: the unfollows, per-post, given and blocked
// figures; engagement by type and given, blocks over time and repo
// activity; the lists (top posts, top engagers, you engage with, the
// follow-back queue, newest followers, unfollows, the lists you're on,
// records by collection); and the content cards (a typical post, media
// described, formats, length, tags, sites). The posting cards say they
// need the composer.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct MoreWidget: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let card: DashboardCard
  let def: WidgetDef
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let title: String?

  private var kind: String { card.options?.kind ?? "all" }
  private var nowMs: Double { archive.nowMs ?? SyncStatus.now() }
  private var rows: Int { card.options?.rows ?? WidgetParts.rows[card.size] ?? 5 }
  private var spark: Bool { card.size != "xs" }
  static let needsSync = "Read from your repo at the next sync."

  var body: some View {
    switch card.type {
    case "stat-unfollows": statUnfollows
    case "stat-per-post": statPerPost
    case "stat-given": statGiven
    case "stat-blocks": statBlocks
    case "stat-typical-post": statTypical
    case "stat-alt-text": statAlt
    case "engagement-by-type":
      let m = ReportModels.engagementModel(archive, period, nowMs)
      BarList(
        rows: m.byKind.map { BarListRow(key: $0.kind, label: $0.label, value: Double($0.value), systemImage: WidgetParts.kindGlyph[$0.kind]) },
        accessibilityLabel: "Engagement by type")
    case "engagement-given":
      let m = ReportModels.givenModel(archive, period, nowMs, kind: kind)
      SeriesChart(
        series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit, height: WidgetParts.height(card.size),
        accessibilityLabel: "\(WidgetParts.kindWord(kind, "Engagement")) given per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
    case "blocks-over-time": blocksOverTime
    case "repo-activity": repoActivity
    case "top-posts": topPosts
    case "top-engagers":
      let m = ReportModels.peopleModel(archive, period, nowMs, kind: kind)
      people(m.inbound.map { ($0.did, AppLocale.formatNumber($0.total), InteractionModel.kindsLine($0.byKind, byCount: true)) },
        empty: "Nobody has engaged with you in this window yet.")
    case "you-engage-with":
      let m = ReportModels.peopleModel(archive, period, nowMs, kind: kind)
      people(m.outbound.map { ($0.did, AppLocale.formatNumber($0.total), InteractionModel.kindsLine($0.byKind, byCount: true)) },
        empty: "You haven’t engaged with anyone in this window.")
    case "follow-back":
      people(
        ReportModels.followBackModel(archive, period, nowMs).map { ($0.did, nil, "\($0.total) interaction\($0.total == 1 ? "" : "s")") },
        empty: "Everyone who follows you and engages, you already follow.", followLabel: "Follow back", rel: false)
    case "newest-followers":
      let m = ReportModels.followersModel(archive, period, nowMs)
      people(
        m.newest.map { ($0.row.did, nil, "followed \(Time.relativeTime($0.atMs, now: SyncStatus.now()))") }, empty: "Nobody new in this window.",
        followLabel: "Follow back", rel: false)
    case "unfollows": unfollows
    case "lists-on": listsOn
    case "repo-collections": repoCollections
    case "content-formats", "content-length": contentGroups
    case "top-tags", "top-links": contentUsed
    default:
      Text(def.category == "posting" ? Unported.postingCard : Unported.card)
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  // MARK: Figures

  private var statUnfollows: some View {
    let m = ReportModels.followerLogModel(archive)
    return Stat(
      icon: def.sfSymbol, label: title ?? "Unfollows", to: def.href, window: "Last sync",
      value: m.tracking ? ChartFormat.fmtFigure(Double(m.latestLost.count)) : "—", delta: nil,
      sub: m.tracking
        ? "\(AppLocale.formatNumber(m.latestGained.count)) arrived · \(AppLocale.formatNumber(m.lost.count)) left in all"
        : "Counting starts with your next sync", spark: nil)
  }

  private var statPerPost: some View {
    let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind)
    let delta = m.rateCompare.flatMap { c in
      c.previous.map { AnyView(DeltaView(pct: c.pct, title: "\(Periods.periodBefore(period, true)): \(ChartFormat.fmtRate($0))")) }
    }
    return Stat(
      icon: def.sfSymbol, label: title ?? "\(WidgetParts.kindWord(kind, "Engagement")) per post", to: def.href,
      window: Periods.periodWindowWord(period), value: m.ownRate == nil ? "—" : ChartFormat.fmtRate(m.ownRate), delta: delta,
      sub: "Over \(AppLocale.formatNumber(m.ownPosts)) posts and threads", spark: spark ? m.rate.map { $0.v ?? 0 } : nil)
  }

  private var statGiven: some View {
    let m = ReportModels.givenModel(archive, period, nowMs, kind: kind)
    let delta: AnyView? = (period.days ?? 0) != 0 && m.compare.previous != 0
      ? AnyView(DeltaView(pct: m.compare.pct, title: WidgetParts.compareTitle(period, m.compare.previous))) : nil
    return Stat(
      icon: def.sfSymbol, label: title ?? "\(WidgetParts.kindWord(kind, "Engagement")) given", to: def.href,
      window: Periods.periodWindowWord(period), value: ChartFormat.fmtFigure(Double(m.total)), delta: delta,
      sub: "To \(AppLocale.formatNumber(m.accounts)) accounts", spark: spark ? m.series.map(\.v) : nil)
  }

  @ViewBuilder private var statBlocks: some View {
    if archive.meta.blocks == nil {
      Stat(icon: def.sfSymbol, label: title ?? "Blocked by", to: nil, window: nil, value: "—", delta: nil, sub: "Read at the next sync", spark: nil)
    } else {
      let m = ReportModels.blocksModel(archive, period, nowMs)
      Stat(
        icon: def.sfSymbol, label: title ?? "Blocked by", to: def.href, window: "Now", value: ChartFormat.fmtFigure(Double(m.total)),
        delta: AnyView(
          Text("+\(AppLocale.formatNumber(m.received))").virgaText(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight)
            .foregroundStyle(theme.ink).accessibilityHint("New in \(Periods.periodPhrase(period))")),
        sub: "\(AppLocale.formatNumber(m.directTotal)) direct · \(AppLocale.formatNumber(m.listTotal)) via lists",
        spark: spark ? m.cumulative.map(\.v) : nil)
    }
  }

  private var statTypical: some View {
    let m = ReportModels.contentModel(archive, period, nowMs)
    return Stat(
      icon: def.sfSymbol, label: title ?? "A typical post earns", to: def.href, window: Periods.periodWindowWord(period),
      value: m.typical == nil ? "—" : ChartFormat.fmtRate(m.typical), delta: nil,
      sub: "The middle of \(AppLocale.formatNumber(m.posts)) posts and threads", spark: nil)
  }

  @ViewBuilder private var statAlt: some View {
    let m = ReportModels.contentModel(archive, period, nowMs)
    if !m.ready {
      Stat(icon: def.sfSymbol, label: title ?? "Media described", to: nil, window: nil, value: "—", delta: nil, sub: Self.needsSync, spark: nil)
    } else {
      Stat(
        icon: def.sfSymbol, label: title ?? "Media described", to: def.href, window: Periods.periodWindowWord(period),
        value: m.alt.pct.map { "\(Int($0.jsRounded))%" } ?? "—", delta: nil,
        sub: m.alt.items != 0
          ? "\(AppLocale.formatNumber(m.alt.itemsDescribed)) of \(AppLocale.formatNumber(m.alt.items)) pictures and videos have alt text"
          : "No pictures or video in this window", spark: nil)
    }
  }

  // MARK: Charts

  @ViewBuilder private var blocksOverTime: some View {
    if archive.meta.blocks == nil {
      EmptyState("Blocks are read at the next sync.")
    } else {
      let m = ReportModels.blocksModel(archive, period, nowMs)
      SeriesChart(
        series: ChartPoint.of(m.directCumulative), seriesLabel: "Direct",
        secondary: ChartSecondary(label: "Via lists", series: ChartPoint.of(m.listCumulative)), stacked: true, mode: .line, unit: m.unit,
        zeroBase: false, height: WidgetParts.height(card.size),
        accessibilityLabel: "Block reach over \(Periods.periodPhrase(period)), direct and through moderation lists")
    }
  }

  @ViewBuilder private var repoActivity: some View {
    if let m = ReportModels.atmosphereModel(archive, period, nowMs) {
      SeriesChart(
        series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit, height: WidgetParts.height(card.size),
        accessibilityLabel: "Records written to the repo per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
    } else {
      EmptyState("The repo is read at the next sync.")
    }
  }

  // MARK: Lists

  @ViewBuilder private var topPosts: some View {
    let m = ReportModels.engagementModel(archive, period, nowMs, kind: kind)
    let shown = Array(m.top.prefix(rows))
    if shown.isEmpty {
      EmptyState("No posts in this window.")
    } else {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(shown.enumerated()), id: \.element.uri) { i, post in
          PostRowView(post: post, did: archive.did, kind: kind, rank: i + 1, breakdown: false)
        }
      }
    }
  }

  @ViewBuilder
  private func people(_ list: [(did: String, value: String?, meta: String?)], empty: String, followLabel: String = "Follow", rel: Bool = true)
    -> some View
  {
    let shown = Array(list.prefix(rows))
    if shown.isEmpty {
      EmptyState(empty)
    } else {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(shown, id: \.did) { r in
          PersonRow(archive: archive, did: r.did, meta: r.meta, value: r.value, follow: true, followLabel: followLabel, rel: rel)
        }
      }
      .task(id: shown.map(\.did).joined(separator: "|")) { await model?.wantActors(shown.map(\.did)) }
    }
  }

  @ViewBuilder private var unfollows: some View {
    let m = ReportModels.followerLogModel(archive)
    if !m.tracking {
      EmptyState("Unfollows are found by comparing two syncs. Counting starts with your next one.")
    } else {
      people(
        m.lost.map { ($0.did, nil, $0.at.map { "noticed \(Time.relativeTime($0, now: SyncStatus.now()))" }) },
        empty: "Nobody has unfollowed you since \(m.since.map { Time.relativeTime($0, now: SyncStatus.now()) } ?? "").")
    }
  }

  @ViewBuilder private var listsOn: some View {
    if archive.meta.lists == nil {
      EmptyState("Lists are read at the next sync.")
    } else {
      let lists = ReportModels.listsModel(archive)
      if lists.isEmpty {
        EmptyState("You aren’t on any lists.")
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(lists.prefix(rows), id: \.uri) { list in
            VStack(alignment: .leading, spacing: 2) {
              Text(list.name.isEmpty ? "Untitled list" : list.name).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
              HStack(spacing: theme.space2) {
                Text(list.purpose == "moderation" ? "Moderation" : list.purpose == "curation" ? "Curation" : list.purpose)
                  .fontWeight(list.purpose == "moderation" ? .semibold : .regular)
                if let subs = list.subscribers { Text("\(AppLocale.formatNumber(subs)) subscribers") }
              }
              .virgaText(.textSm)
              .foregroundStyle(theme.muted)
            }
            .padding(.vertical, theme.rowPad)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
          }
        }
      }
    }
  }

  @ViewBuilder private var repoCollections: some View {
    if let m = ReportModels.atmosphereModel(archive, period, nowMs) {
      let n = rows + 3
      let shown = Array(m.ranked.prefix(n))
      if shown.isEmpty {
        EmptyState("No records written in this window.")
      } else {
        BarList(
          rows: shown.map { BarListRow(key: $0.collection, label: $0.collection, value: Double($0.count), title: $0.collection, code: true) },
          accessibilityLabel: "Records by collection")
        Text(
          (m.ranked.count > n ? "And \(AppLocale.formatNumber(m.ranked.count - n)) more collections. " : "")
            + "\(AppLocale.formatNumber(m.total)) records in \(Periods.periodPhrase(period))."
        )
        .virgaText(.textSm)
        .foregroundStyle(theme.muted)
      }
    } else {
      EmptyState("The repo is read at the next sync.")
    }
  }

  // MARK: Content

  @ViewBuilder private var contentGroups: some View {
    let m = ReportModels.contentModel(archive, period, nowMs)
    let formats = card.type == "content-formats"
    let groups = (formats ? m.formats : m.lengths).filter { $0.posts > 0 }
    if !m.ready {
      EmptyState(Self.needsSync)
    } else if groups.isEmpty {
      EmptyState("No posts in this window.")
    } else {
      if formats, let insight = ContentWords.standout(m.formats, m.typical, "text", noun: ContentWords.formatNoun) {
        Text(insight).virgaText(.textBase).foregroundStyle(theme.ink2).fixedSize(horizontal: false, vertical: true)
      }
      BarList(
        rows: groups.map { ContentWords.barRow(key: $0.key, label: $0.label, posts: $0.posts, share: $0.share, typical: $0.typical, measure: "typical") },
        accessibilityLabel: formats ? "What a typical post earns, by format" : "What a typical post earns, by length")
      Text("What a typical post in each group earns.").virgaText(.textSm).foregroundStyle(theme.muted)
    }
  }

  @ViewBuilder private var contentUsed: some View {
    let m = ReportModels.contentModel(archive, period, nowMs)
    let tags = card.type == "top-tags"
    let all = tags ? m.tags : m.links
    let shown = Array(all.prefix(rows))
    if !m.ready {
      EmptyState(Self.needsSync)
    } else if shown.isEmpty {
      EmptyState(tags ? "No tags on your posts in this window." : "No links in your posts in this window.")
    } else {
      BarList(
        rows: shown.map {
          BarListRow(
            key: $0.name, label: tags ? "#\($0.name)" : $0.name, value: Double($0.posts),
            title: $0.typical == nil
              ? "\(AppLocale.formatNumber($0.posts)) posts" : "\(AppLocale.formatNumber($0.posts)) posts, typically earning \(ChartFormat.fmtRate($0.typical))")
        }, accessibilityLabel: "Posts using each")
      Text(
        "Posts using each."
          + (all.count > shown.count
            ? " \(AppLocale.formatNumber(all.count - shown.count)) more in the report, with what they earn." : " The report has what they earn.")
      )
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
    }
  }
}
#endif
