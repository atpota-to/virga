// Ports src/reports/ReportPage.jsx (the blocks, people and atmosphere reports)
//
// Blocks: the figures (Through lists with the way to the Lists tool), block
// reach (the total, by path stacked, with followers, or new blocks per
// bucket) with its table and the report's actions. People: who engages with
// you and who you engage with, side by side where there is room, each under
// a rule in ink, twelve more at a time ("Show 12 more", "12 of 64" at the
// right), each a person with their counts by kind and Follow (someone
// followed from Not following keeps their row until the filter changes),
// and the caption under the first. Atmosphere: the figures, records written per
// bucket with its table and the report's actions, and by collection (the
// first sixteen, Show all on a line of its own under the bars). Each with
// How this is counted, word for word.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct BlocksReportView: View {
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var mode = "cumulative"

  var body: some View {
    let unitPick = ["cumulative", "stacked", "together"].contains(mode) ? nil : AnalyticsUnit(mode)
    let m = ReportModels.blocksModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick)
    let together = mode == "together"
    let stacked = mode == "stacked"
    let cumulative = mode == "cumulative" || together || stacked
    let series = together ? m.followerCumulative : stacked ? m.directCumulative : cumulative ? m.cumulative : m.counts
    let secondary: ChartSecondary? =
      together
      ? ChartSecondary(label: "Block reach", series: ChartPoint.of(m.cumulative))
      : stacked ? ChartSecondary(label: "Via lists", series: ChartPoint.of(m.listCumulative)) : nil
    let days = period.days.map { $0 != 0 } ?? false
    if archive.meta.blocks == nil {
      SyncEmpty(text: "Blocks haven’t been read yet. Run a sync to build this timeline.")
    } else {
      FiguresView(
        [
          ReportParts.fig("Blocked by", Double(m.total), sub: "People, counted once"),
          ReportParts.fig("Directly", Double(m.directTotal)),
          ReportParts.fig(
            "Through lists", text: ChartFormat.fmtFigure(Double(m.listTotal)), note: AnyView(NoteLink(text: "See the lists", to: "/tools/lists"))),
          ReportParts.fig(
            days ? "New in \(Periods.periodPhrase(period))" : "All time", Double(m.received), delta: days ? .some(m.compare.pct) : nil,
            deltaTitle: days ? "\(Periods.periodBefore(period, true)): \(AppLocale.formatNumber(m.compare.previous))" : nil),
        ], label: "Blocks in figures")
      ReportCard(
        title: together
          ? "Followers and block reach" : stacked ? "Block reach by path" : cumulative ? "Block reach" : "New blocks per \(ChartFormat.unitNoun(m.unit))",
        sub: nil,
        tools: AnyView(
          Segmented(
            label: ReportParts.modeLabel,
            options: [
              SegmentedOption("cumulative", "Total", accessibilityLabel: "Running total over the window"),
              SegmentedOption("stacked", "By path", accessibilityLabel: "Direct blocks and moderation lists, stacked"),
              SegmentedOption("together", "With followers", accessibilityLabel: "Block reach and followers on one chart"),
            ] + ReportParts.unitOptions(m.units, "New blocks"), selection: $mode, size: .small))
      ) {
        SeriesChart(
          series: ChartPoint.of(series), seriesLabel: together ? "Followers" : stacked ? "Direct" : nil, secondary: secondary, stacked: stacked,
          trend: cumulative ? nil : ChartPoint.of(m.trend), mode: cumulative ? .line : .bars, unit: m.unit, zeroBase: !cumulative,
          height: 280, accessibilityLabel: "Blocks over \(Periods.periodPhrase(period))")
        ChartTable(
          series: ChartPoint.of(series), secondary: secondary?.series, trend: cumulative ? nil : ChartPoint.of(m.trend), unit: m.unit,
          valueHead: together ? "Followers" : stacked ? "Direct" : cumulative ? "Block reach" : "New blocks", secondaryHead: secondary?.label,
          trailing: more
        ) {
          if let actions { actions }
        }
      }
      HowCounted(paragraphs: [
        "Reconstructed from current app.bsky.graph.block records and the moderation lists that currently contain you. List reach follows each list’s current app.bsky.graph.listblock subscribers, and a list block begins at the later of the membership and the subscription.",
        "People reached through several lists, or through both a list and a direct block, count once in the total"
          + (m.overlap > 0 ? "; \(AppLocale.formatNumber(m.overlap)) also block you directly" : "")
          + ". Removed blocks, memberships and subscriptions disappear at the next sync, so this is a picture of blocks that still exist, not a permanent history."
          + (m.undated > 0 ? " \(AppLocale.formatNumber(m.undated)) people have no readable date and sit outside the chart." : ""),
      ])
    }
  }
}

struct PeopleReportView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var model: ArchiveModel?
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var kind = "all"
  /// Whom to show: "all", "not" (not followed) or "following".
  var relation = "all"
  @State private var limits = (inbound: PeopleReportView.page, outbound: PeopleReportView.page)
  /// Someone followed from "Not following" keeps their row until the
  /// filter changes, now reading Following, rather than vanishing.
  @State private var kept: (relation: String, dids: Set<JSKey>) = ("all", [])
  static let page = 12

  var body: some View {
    let m = ReportModels.peopleModel(archive, period, archive.nowMs ?? SyncStatus.now(), kind: kind)
    let sets = ReportModels.relationSets(archive)
    let follows = { (did: String) in sets.following.contains { $0.jsEquals(did) } }
    let keptDids: Set<JSKey> = kept.relation == relation ? kept.dids : []
    let keep = { (r: TopActor) in
      keptDids.contains(JSKey(r.did)) || (relation == "not" ? !follows(r.did) : relation == "following" ? follows(r.did) : true)
    }
    let inRanked = m.inbound.filter(keep)
    let outRanked = m.outbound.filter(keep)
    let inTop = Array(inRanked.prefix(limits.inbound))
    let outTop = Array(outRanked.prefix(limits.outbound))
    let notFollowing = m.inbound.filter { r in !sets.following.contains { $0.jsEquals(r.did) } }.count
    let days = period.days.map { $0 != 0 } ?? false
    var caption: [String] = []
    if archive.meta.following != nil, relation != "not", notFollowing > 0 { caption.append("\(AppLocale.formatNumber(notFollowing)) of them you don’t follow.") }
    if let oldest = m.inOldest, days, oldest > m.inT0 {
      caption.append("Notifications reach back to \(Time.formatDateShort(oldest)) so far, so earlier events in this window are outside them.")
    }
    // One stack, so the names are asked for once.
    return VStack(alignment: .leading, spacing: theme.sectionGap) {
      ReportSplit {
        ReportCard(title: "They engage with you", sub: nil, tools: nil, flush: true, caption: caption.isEmpty ? nil : caption.joined(separator: " ")) {
          list(
            inTop, inRanked, side: 0,
            empty: relation == "not" && !m.inbound.isEmpty
              ? "You already follow everyone who engaged with you in this window." : "Nobody has engaged with you in this window yet.")
        }
        ReportCard(title: "You engage with them", sub: nil, tools: nil, flush: true) {
          if kind == "mention" {
            EmptyState("Mentions are counted inbound only.")
          } else {
            list(
              outTop, outRanked, side: 1,
              empty: relation == "not" && !m.outbound.isEmpty
                ? "You already follow everyone you engaged with in this window." : "You haven’t engaged with anyone in this window.")
          }
        }
      }
      HowCounted(paragraphs: [
        "Inbound counts come from your notifications: likes, reposts, replies, quotes and mentions aimed at you. Outbound counts come from your repo’s like and repost history, plus the replies and quotes in your post archive.",
        archive.meta.following != nil
          ? "Following is read from the follow records in your own repo at each sync. Follow writes one there, and pressing Following deletes it."
          : "Who you follow arrives with the next sync; until then there are no Follow buttons, so nobody can be followed twice.",
      ])
    }
    .task(id: (inTop + outTop).map(\.did).joined(separator: "|")) {
      await model?.wantActors((inTop + outTop).map(\.did))
    }
  }

  @ViewBuilder
  private func list(_ rows: [TopActor], _ ranked: [TopActor], side: Int, empty: String) -> some View {
    if rows.isEmpty {
      EmptyState(empty)
    } else {
      PersonList {
        ForEach(rows, id: \.did) { r in
          let detail = InteractionModel.kindsLine(r.byKind, byCount: true)
          PersonRow(
            archive: archive, did: r.did, meta: detail, value: AppLocale.formatNumber(r.total), follow: true,
            onFollowed: { did in
              kept = (relation, (kept.relation == relation ? kept.dids : []).union([JSKey(did)]))
            })
        }
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("people-\(side == 0 ? "in" : "out")")
    }
    // Under each list the same foot: Show 12 more, then "12 of 64" at the right.
    if ranked.count > rows.count {
      SectionFoot(count: "\(AppLocale.formatNumber(rows.count)) of \(AppLocale.formatNumber(ranked.count))") {
        Button("Show \(min(Self.page, ranked.count - rows.count)) more") {
          if side == 0 { limits.inbound += Self.page } else { limits.outbound += Self.page }
        }
        .buttonStyle(.virga(.ghost, size: .small))
      }
    }
  }
}

struct AtmosphereReportView: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ReportArchive
  let period: AnalyticsPeriod
  var actions: AnyView? = nil
  var more: AnyView? = nil
  @State private var unitPick: String?
  @State private var all = false

  var body: some View {
    if let m = ReportModels.atmosphereModel(archive, period, archive.nowMs ?? SyncStatus.now(), unit: unitPick.map { AnalyticsUnit($0) }) {
      let days = period.days.map { $0 != 0 } ?? false
      let shown = all ? m.ranked : Array(m.ranked.prefix(16))
      FiguresView(
        [
          ReportParts.fig(days ? "Records in \(Periods.periodPhrase(period))" : "Records, all time", Double(m.total)),
          ReportParts.fig("Collections", Double(m.collections), sub: "Written to in the window"),
          ReportParts.fig("Per day", m.spanDays != 0 ? Double(m.total) / m.spanDays : nil, decimals: true),
          ReportParts.fig("In the repo", Double(m.allTime), sub: "Every record, all time"),
        ], label: "The repo in figures")
      ReportCard(
        title: "Records written per \(ChartFormat.unitNoun(m.unit))", sub: "Every app, every collection",
        tools: AnyView(
          Segmented(label: ReportParts.modeLabel, options: ReportParts.unitOptions(m.units, "Records"), selection: m.unit.rawValue, size: .small) {
            unitPick = $0
          })
      ) {
        SeriesChart(
          series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), mode: .bars, unit: m.unit, height: 260,
          accessibilityLabel: "Records written to the repo per \(m.unit.rawValue) over \(Periods.periodPhrase(period))")
        ChartTable(series: ChartPoint.of(m.series), trend: ChartPoint.of(m.trend), unit: m.unit, valueHead: "Records", trailing: more) {
          if let actions { actions }
        }
      }
      ReportCard(title: "By collection", sub: "Which apps write to your repo, and how much", tools: nil) {
        if shown.isEmpty {
          EmptyState("No records written in this window.")
        } else {
          BarList(
            rows: shown.map { BarListRow(key: $0.collection, label: $0.collection, value: Double($0.count), title: $0.collection, code: true) },
            accessibilityLabel: "Records by collection")
        }
        // A bar list's line under it, as Content's have: every bar is one
        // more thing to do with the chart, not a list's "Show N more".
        if m.ranked.count > 16 {
          Button {
            all.toggle()
          } label: {
            Label(all ? "Show fewer" : "Show all \(m.ranked.count) collections", systemImage: all ? ReportParts.chevronUp : ReportParts.chevronDown)
          }
          .buttonStyle(.linkAction)
          .modifier(ChartFootAction())
          .padding(.top, theme.points(ThemeKit.chartFootSpaceAbove))
        }
      }
      HowCounted(paragraphs: [
        "From the repo archive: every record in every collection, dated by its record key (falling back to its own createdAt; the rare record with neither is left out). Pulled from your PDS \(archive.meta.repo?.syncedAt.map { Time.relativeTime($0, now: SyncStatus.now()) } ?? ""); syncs top it up from the repo’s revision log."
      ])
    } else {
      SyncEmpty(
        text:
          "A sync downloads your repo’s own archive, every record in every collection back to the very first, and charts what got written when."
      )
    }
  }
}
#endif
