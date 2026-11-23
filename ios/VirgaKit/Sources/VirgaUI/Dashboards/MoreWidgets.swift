// Ports src/dashboards/widgets/index.jsx (the other figures, charts and lists)
// Ports src/dashboards/widgets/content.jsx
// Ports src/dashboards/widgets/posting.jsx
//
// The cards WidgetBody hands on: the unfollows, per-post, given and blocked
// figures; engagement by type and given, blocks over time and repo
// activity; the lists (top posts, top engagers, you engage with, the
// follow-back queue, newest followers, unfollows with the names the log
// remembers, the lists you're on, records by collection); and the content
// cards (a typical post, media described, formats, length, tags, sites).
// In a list card what isn't rows (bars, a sentence) stands 16 off the rule
// under its heading. The posting cards (what is going out next, the drafts
// waiting, the timers counting down) read what the Posting overview reads,
// for the dashboard's account, and follow the same events; scheduling and
// timers need a long session and say so on an account without one.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork
import VirgaPosting
import VirgaSession

struct MoreWidget: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let card: DashboardCard
  let def: WidgetDef
  let archive: ReportArchive
  let period: AnalyticsPeriod
  let title: String?

  @Environment(AppModel.self) private var app
  private var kind: String { card.options?.kind ?? "all" }
  private var nowMs: Double { archive.nowMs ?? SyncStatus.now() }
  /// `rowsFor(size, rows)`.
  private var rows: Int { WidgetParts.rowsFor(card.size, card.options?.rows) }
  static let needsSync = "Read from your repo at the next sync."

  /// What isn't rows under a list's rule stands 16 off it.
  private func offRule<V: View>(_ view: V) -> some View {
    view.padding(.top, Measure.Dashboard.listBodySpaceAbove)
  }

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
    case "stat-scheduled": PostingStatScheduled(did: archive.did, def: def, title: title)
    case "stat-timers": PostingStatTimers(did: archive.did, def: def, title: title)
    case "posting-next": PostingNextCard(did: archive.did, def: def, rows: rows)
    case "posting-drafts": PostingDraftsCard(did: archive.did, rows: rows)
    default:
      placeholder(Unported.card)
        .padding(.top, def.options.contains("rows") ? Measure.Dashboard.listBodySpaceAbove : 0)
    }
  }

  private func placeholder(_ text: String) -> some View {
    Text(text)
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .fixedSize(horizontal: false, vertical: true)
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
      c.previous.map { StatDelta(text: ChartFormat.deltaText(c.pct), hint: "\(Periods.periodBefore(period, true)): \(ChartFormat.fmtRate($0))") }
    }
    // The rate's gaps (a week with nothing posted) are left out of its line.
    return Stat(
      icon: def.sfSymbol, label: title ?? "\(WidgetParts.kindWord(kind, "Engagement")) per post", to: def.href,
      window: Periods.periodWindowWord(period), value: m.ownRate == nil ? "—" : ChartFormat.fmtRate(m.ownRate), delta: delta,
      sub: "Over \(AppLocale.formatNumber(m.ownPosts)) posts and threads", spark: m.rate.map(\.v))
  }

  private var statGiven: some View {
    let m = ReportModels.givenModel(archive, period, nowMs, kind: kind)
    let delta: StatDelta? = (period.days ?? 0) != 0 && m.compare.previous != 0
      ? StatDelta(text: ChartFormat.deltaText(m.compare.pct), hint: WidgetParts.compareTitle(period, m.compare.previous)) : nil
    return Stat(
      icon: def.sfSymbol, label: title ?? "\(WidgetParts.kindWord(kind, "Engagement")) given", to: def.href,
      window: Periods.periodWindowWord(period), value: ChartFormat.fmtFigure(Double(m.total)), delta: delta,
      sub: "To \(AppLocale.formatNumber(m.accounts)) accounts", spark: m.series.map { Optional($0.v) })
  }

  @ViewBuilder private var statBlocks: some View {
    if archive.meta.blocks == nil {
      Stat(icon: def.sfSymbol, label: title ?? "Blocked by", to: nil, window: nil, value: "—", delta: nil, sub: "Read at the next sync", spark: nil)
    } else {
      let m = ReportModels.blocksModel(archive, period, nowMs)
      Stat(
        icon: def.sfSymbol, label: title ?? "Blocked by", to: def.href, window: "Now", value: ChartFormat.fmtFigure(Double(m.total)),
        delta: StatDelta(text: "+\(AppLocale.formatNumber(m.received))", hint: "New in \(Periods.periodPhrase(period))"),
        sub: "\(AppLocale.formatNumber(m.directTotal)) direct · \(AppLocale.formatNumber(m.listTotal)) via lists",
        spark: m.cumulative.map { Optional($0.v) })
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
      offRule(EmptyState("No posts in this window."))
    } else {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(shown.enumerated()), id: \.element.uri) { i, post in
          PostRowView(post: post, did: archive.did, kind: kind, rank: i + 1, breakdown: false)
        }
      }
    }
  }

  /// `PeopleList`: a row each, the names asked for; a row the caller
  /// remembers a card for (the log's) has it stand in.
  @ViewBuilder
  private func people(
    _ list: [(did: String, value: String?, meta: String?)], cards: [JSKey: People.Card] = [:], empty: String, followLabel: String = "Follow",
    rel: Bool = true
  ) -> some View {
    let shown = Array(list.prefix(rows))
    if shown.isEmpty {
      offRule(EmptyState(empty))
    } else {
      PersonList {
        ForEach(shown, id: \.did) { r in
          PersonRow(
            archive: archive, did: r.did, card: cards[JSKey(r.did)], meta: r.meta, value: r.value, follow: true, followLabel: followLabel, rel: rel)
        }
      }
      .task(id: shown.map(\.did).joined(separator: "|")) { await model?.wantActors(shown.map(\.did)) }
    }
  }

  @ViewBuilder private var unfollows: some View {
    let m = ReportModels.followerLogModel(archive)
    if !m.tracking {
      offRule(EmptyState("Unfollows are found by comparing two syncs. Counting starts with your next one."))
    } else {
      people(
        m.lost.map { ($0.did, nil, $0.at.map { "noticed \(Time.relativeTime($0, now: SyncStatus.now()))" }) }, cards: Self.remembered(m.lost),
        empty: "Nobody has unfollowed you since \(m.since.map { Time.relativeTime($0, now: SyncStatus.now()) } ?? "").")
    }
  }

  /// The log remembers who left as they were: their card stands in until a
  /// fresher one is read (`r.handle != null`).
  static func remembered(_ entries: [FollowerLogEntry]) -> [JSKey: People.Card] {
    var cards: [JSKey: People.Card] = [:]
    for e in entries where e.handle != nil { cards[JSKey(e.did)] = (e.handle, e.displayName, e.avatar) }
    return cards
  }

  /// `PURPOSE_WORD`.
  static let purposeWord = ["moderation": "Moderation", "curation": "Curation"]

  /// The lists you're on, one line each: the name, and at the row's end
  /// what it is for (Moderation a step louder) and who subscribes.
  @ViewBuilder private var listsOn: some View {
    if archive.meta.lists == nil {
      offRule(EmptyState("Lists are read at the next sync."))
    } else {
      let lists = ReportModels.listsModel(archive)
      if lists.isEmpty {
        offRule(EmptyState("You aren’t on any lists."))
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(lists.prefix(WidgetParts.rowsShown(card.type, card.size, card.options?.rows)), id: \.uri) { list in
            HStack(spacing: Measure.Dashboard.listRowGap) {
              Text(list.name.isEmpty ? "Untitled list" : list.name)
                .virgaText(.textMd, weight: VirgaWeight.medium)
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
              MetaLine(
                [MetaItem(Self.purposeWord[list.purpose] ?? list.purpose, isKey: list.purpose == "moderation")]
                  + (list.subscribers.map { [MetaItem("\(AppLocale.formatNumber($0)) subscribers")] } ?? [])
              )
              .fixedSize()
            }
            .padding(.vertical, theme.rowPad)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
          }
        }
      }
    }
  }

  @ViewBuilder private var repoCollections: some View {
    if let m = ReportModels.atmosphereModel(archive, period, nowMs) {
      let n = WidgetParts.rowsShown(card.type, card.size, card.options?.rows)
      let shown = Array(m.ranked.prefix(n))
      if shown.isEmpty {
        offRule(EmptyState("No records written in this window."))
      } else {
        // `.widget-stack`: the bars and the caption under them, 12 apart.
        offRule(
          VStack(alignment: .leading, spacing: theme.space3) {
            BarList(
              rows: shown.map { BarListRow(key: $0.collection, label: $0.collection, value: Double($0.count), title: $0.collection, code: true) },
              accessibilityLabel: "Records by collection")
            Text(
              (m.ranked.count > n ? "And \(AppLocale.formatNumber(m.ranked.count - n)) more collections. " : "")
                + "\(AppLocale.formatNumber(m.total)) records in \(Periods.periodPhrase(period))."
            )
            .virgaText(.textSm)
            .foregroundStyle(theme.muted)
            .fixedSize(horizontal: false, vertical: true)
          })
      }
    } else {
      offRule(EmptyState("The repo is read at the next sync."))
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
        // `.widget-insight`: small, over the bars.
        Text(insight).virgaText(.textSm).foregroundStyle(theme.ink2).fixedSize(horizontal: false, vertical: true)
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
      offRule(EmptyState(Self.needsSync))
    } else if shown.isEmpty {
      offRule(EmptyState(tags ? "No tags on your posts in this window." : "No links in your posts in this window."))
    } else {
      offRule(contentUsedBars(all: all, shown: shown, tags: tags))
    }
  }

  private func contentUsedBars(all: [ContentUse], shown: [ContentUse], tags: Bool) -> some View {
    VStack(alignment: .leading, spacing: theme.space3) {
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
      .fixedSize(horizontal: false, vertical: true)
    }
  }
}

// MARK: - The posting cards (posting.jsx)

/// What the posting cards read: posting.jsx's `useBackend(did)`, the
/// account's requester for Virga's server or nil without a long session.
@MainActor
enum PostingWidgets {
  /// posting.jsx's `NEEDS`.
  static let needs = "Needs a long session"

  static func backend(_ app: AppModel, _ did: String) -> VirgaBackend? {
    app.session.capabilitiesFor(did).canSchedule ? app.session.backendFor(did) : nil
  }
}

/// `useScheduled(did, limit)`'s answer: scheduledOverview and whether the
/// server can schedule just now.
struct PostingWidgetScheduled {
  var overview: ScheduledOverview
  var unavailable: Bool
}

/// StatTimers' answer: timersOverview and whether the server holds timers.
struct PostingWidgetTimers {
  var overview: TimersOverview
  var unavailable: Bool
}

// Isolated as PostingLoad is, said outright: it calls `follow`.
@MainActor
extension PostingLoad where Value == PostingWidgetScheduled {
  /// `useScheduled(did, limit)`: the account's scheduled posts, read again on
  /// the scheduling event, nothing read without a long session.
  func followScheduled(did: String, req: VirgaBackend?, limit: Int) {
    follow(
      key: "\(did):\(req != nil):\(limit)", did: did, events: [PostingEvents.scheduledChangedEvent], enabled: req != nil
    ) {
      let list = try await ScheduleService.listScheduled(req)
      return PostingWidgetScheduled(
        overview: HubModel.scheduledOverview(.array(list.rows), limit: Double(limit)), unavailable: list.unavailable)
    }
  }
}

/// `StatScheduled`: how many posts wait to go out, and when the next does
/// (or how many didn't go out).
struct PostingStatScheduled: View {
  @Environment(AppModel.self) private var app
  let did: String
  let def: WidgetDef
  let title: String?
  @State private var load = PostingLoad<PostingWidgetScheduled>()

  var body: some View {
    let req = PostingWidgets.backend(app, did)
    stat(req: req)
      .task(id: "\(did)|\(req != nil)") { load.followScheduled(did: did, req: req, limit: 1) }
      .onDisappear { load.stop() }
  }

  @ViewBuilder
  private func stat(req: VirgaBackend?) -> some View {
    let label = title ?? "Scheduled"
    if req == nil {
      tile(label, window: nil, value: "—", sub: PostingWidgets.needs)
    } else if load.phase == .loading || load.phase == .idle {
      tile(label, window: nil, value: "…", sub: "Reading")
    } else if let read = load.data, !read.unavailable {
      tile(label, window: "Waiting", value: AppLocale.fmtInt(Double(read.overview.waiting)), sub: sub(read.overview))
    } else {
      tile(label, window: nil, value: "—", sub: "Couldn’t be read just now")
    }
  }

  private func sub(_ overview: ScheduledOverview) -> String {
    if overview.failed > 0 { return "\(HubModel.countPhrase(Double(overview.failed), "post")) didn’t go out" }
    if let next = overview.next.first { return "Next: \(HubModel.whenLabel(next["scheduledFor"], now: SyncStatus.now()))" }
    return "Nothing is scheduled"
  }

  private func tile(_ label: String, window: String?, value: String, sub: String) -> Stat {
    Stat(icon: def.sfSymbol, label: label, to: def.href, window: window, value: value, delta: nil, sub: sub, spark: nil)
  }
}

/// `StatTimers`: how many timers count down, and when the next is checked.
struct PostingStatTimers: View {
  @Environment(AppModel.self) private var app
  let did: String
  let def: WidgetDef
  let title: String?
  @State private var load = PostingLoad<PostingWidgetTimers>()

  var body: some View {
    let req = PostingWidgets.backend(app, did)
    stat(req: req)
      .task(id: "\(did)|\(req != nil)") { follow(req) }
      .onDisappear { load.stop() }
  }

  private func follow(_ req: VirgaBackend?) {
    load.follow(key: "\(did):\(req != nil)", did: did, events: [PostingEvents.timersChangedEvent], enabled: req != nil) {
      let list = try await TimerService.listTimers(req)
      return PostingWidgetTimers(overview: HubModel.timersOverview(.array(list.rows)), unavailable: list.unavailable)
    }
  }

  @ViewBuilder
  private func stat(req: VirgaBackend?) -> some View {
    let label = title ?? "Timers"
    if req == nil {
      tile(label, window: nil, value: "—", sub: PostingWidgets.needs)
    } else if load.phase == .loading || load.phase == .idle {
      tile(label, window: nil, value: "…", sub: "Reading")
    } else if let read = load.data, !read.unavailable {
      tile(label, window: "Counting down", value: AppLocale.fmtInt(Double(read.overview.live)), sub: sub(read.overview))
    } else {
      tile(label, window: nil, value: "—", sub: "Couldn’t be read just now")
    }
  }

  private func sub(_ overview: TimersOverview) -> String {
    guard let check = overview.nextCheck else { return "None counting down" }
    return "Next check \(PostingQueue.relativeWhen(check, now: SyncStatus.now()))"
  }

  private func tile(_ label: String, window: String?, value: String, sub: String) -> Stat {
    Stat(icon: def.sfSymbol, label: label, to: def.href, window: window, value: value, delta: nil, sub: sub, spark: nil)
  }
}

/// `PostingNext`: the posts going out soonest, each led by its day and hour
/// in the overview's time column, a queued one saying so after its hour;
/// how many didn't go out under them. What isn't rows stands 16 off the rule.
struct PostingNextCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  let did: String
  let def: WidgetDef
  let rows: Int
  @State private var load = PostingLoad<PostingWidgetScheduled>()

  var body: some View {
    let req = PostingWidgets.backend(app, did)
    content(req: req)
      .task(id: "\(did)|\(req != nil)|\(rows)") { load.followScheduled(did: did, req: req, limit: rows) }
      .onDisappear { load.stop() }
  }

  @ViewBuilder
  private func content(req: VirgaBackend?) -> some View {
    if req == nil {
      needsSession.padding(.top, Measure.Dashboard.listBodySpaceAbove)
    } else if load.phase == .loading || load.phase == .idle {
      RowSkeleton(rows: min(rows, 3))
    } else if let read = load.data {
      if read.unavailable {
        EmptyState("Scheduling isn’t available on Virga’s server just now.")
          .padding(.top, Measure.Dashboard.listBodySpaceAbove)
      } else if read.overview.next.isEmpty {
        EmptyState("Nothing is scheduled. Write a post and choose Schedule, or add it to your queue.")
          .padding(.top, Measure.Dashboard.listBodySpaceAbove)
      } else {
        list(read.overview)
      }
    } else {
      LoadError(message: "Your scheduled posts couldn’t be read from Virga’s server.") { load.reload() }
        .padding(.top, Measure.Dashboard.listBodySpaceAbove)
    }
  }

  private func list(_ overview: ScheduledOverview) -> some View {
    let now = SyncStatus.now()
    return VStack(alignment: .leading, spacing: 0) {
      ForEach(overview.next, id: \.self) { row in
        HubNextRow(row: row, now: now)
      }
      if overview.failed > 0 {
        // `.widget-foot { padding-top: 12px }`, muted and small.
        Text("\(HubModel.countPhrase(Double(overview.failed), "post")) didn’t go out.")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, theme.space3)
      }
    }
  }

  /// Without a long session: why, and the way to see how.
  private var needsSession: some View {
    FlowLayout(spacing: 0, lineSpacing: 0) {
      Text("Scheduling needs a long session, because Virga’s server posts while Virga is closed. ")
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
      NoteLink(text: "See how", to: def.href)
        .virgaText(.textBase)
    }
  }
}

/// `PostingDrafts`: the newest drafts, each with Open, as the overview
/// lists them.
struct PostingDraftsCard: View {
  @Environment(\.navigate) private var navigate
  @Environment(ComposerHost.self) private var composer: ComposerHost?
  @Environment(AppModel.self) private var app
  let did: String
  let rows: Int
  @State private var load = PostingLoad<HubDraftsRead>()

  var body: some View {
    content
      .task(id: did) { follow() }
      .onDisappear { load.stop() }
  }

  private func follow() {
    let session = app.session
    let did = self.did
    let device = PostingPages.deviceId(app)
    load.follow(key: did, did: did, events: [PostingEvents.draftsChangedEvent]) {
      let agent = try await session.agentFor(did)
      let page = try await Drafts.listDrafts(agent, limit: .number(Double(Measure.Hub.hubDraftsRead)))
      return HubDraftsRead(rows: HubModel.draftRows(.array(page.drafts), deviceId: device), more: page.cursor.isTruthy)
    }
  }

  @ViewBuilder
  private var content: some View {
    if load.phase == .loading || load.phase == .idle {
      RowSkeleton(rows: min(rows, 3))
    } else if let read = load.data {
      if read.rows.isEmpty {
        EmptyState("No drafts. In the composer, Save draft keeps a post here until you’re ready.")
          .padding(.top, Measure.Dashboard.listBodySpaceAbove)
      } else {
        let now = SyncStatus.now()
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(read.rows.prefix(rows)), id: \.self) { row in
            HubDraftRow(row: row, now: now) { open(row) }
          }
        }
      }
    } else {
      LoadError(message: "Your drafts couldn’t be read from Bluesky.") { load.reload() }
        .padding(.top, Measure.Dashboard.listBodySpaceAbove)
    }
  }

  private func open(_ row: JSONValue) {
    let intent = PostingPages.draftIntent(row["id"], did)
    if let composer { composer.open(intent) } else { navigate("/posting/compose") }
  }
}
#endif
