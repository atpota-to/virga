// Ports src/tools/FollowCleanup.jsx
// Ports src/tools/tools.css (.check-card, .filter-cards, .table-bar, .cleanup-table, .table--stack, .activity)
//
// Follow cleanup: the accounts you follow that have gone quiet, are gone,
// or don't follow you back, with a bulk Unfollow. Nothing is unfollowed
// until it is asked for, every unfollow can be undone from the same row,
// and an account marked Keep is never suggested again. The activity check
// reads each account's newest post or repost from the public AppView (the
// archive's checkActivity, through the session's network: the made-up
// world's in the demo). The table is set as the web's phone sets it, at
// every width: the tick box at the left, the face and name with the button
// at the right, and the rest as a meta line under the name, the activity
// first.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork

struct FollowCleanupTool: View {
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    if let archive {
      FollowCleanupPage(tool: tool, archive: archive, store: app.stores.keyValue)
        .id(archive.did)
    } else {
      VirgaPage(header: ToolHeader.header(tool)) { EmptyView() }
    }
  }
}

/// One account followed, once, with what is known about it.
struct CleanupRow: Hashable {
  var did: String
  var followedAt: String?
  var followsYou: Bool
  var interactions: Int
  var recent: Int
  var checked: Bool
  var gone: Bool
  var lastActiveMs: Double?
}

/// The check's and the bulk unfollow's progress, read and written from the
/// archive's callbacks.
@MainActor
@Observable
final class CleanupProgress {
  /// `{ done, total }`.
  struct Tally: Hashable {
    var done: Int
    var total: Int
  }

  var checking: Tally?
  var working: Tally?
  @ObservationIgnored var task: Task<Void, Never>?
}

enum FollowCleanup {
  static let dayMs: Double = 86_400_000
  static let page = 50
  static let quietChoices = [30, 90, 180, 365]

  /// Every account followed, once, with what is known about it.
  @MainActor
  static func rows(_ archive: ArchiveModel, sets: RelationSets) -> [CleanupRow] {
    let nowMs = archive.nowMs
    let zone = AppLocale.activeTimeZone()
    let yearAgo = nowMs - 365 * dayMs
    var interactions: [JSKey: (all: Int, recent: Int)] = [:]
    func bump(_ did: String, _ at: String?) {
      if did.isEmpty { return }
      let t = JSDate.parse(at ?? "", timeZone: zone)
      var e = interactions[JSKey(did)] ?? (0, 0)
      e.all += 1
      if t.isFinite && t >= yearAgo { e.recent += 1 }
      interactions[JSKey(did)] = e
    }
    for ev in archive.data.inbound { bump(ev.did, ev.atText) }
    for ev in archive.data.outbound { bump(ev.did, ev.atText) }
    var order: [JSKey] = []
    var seen: [JSKey: FollowingRow] = [:]
    for f in archive.data.following {
      let key = JSKey(f.did)
      if let prev = seen[key] {
        if JSDate.parse(f.followedAt ?? "", timeZone: zone) < JSDate.parse(prev.followedAt ?? "", timeZone: zone) { seen[key] = f }
      } else {
        order.append(key)
        seen[key] = f
      }
    }
    return order.compactMap { seen[$0] }.map { f in
      let card = archive.actors[f.did]
      let last = JSDate.parse(card?.lastActiveAt ?? "", timeZone: zone)
      let counted = interactions[JSKey(f.did)]
      return CleanupRow(
        did: f.did, followedAt: f.followedAt, followsYou: sets.isFollower(f.did), interactions: counted?.all ?? 0,
        recent: counted?.recent ?? 0, checked: (card?.activityAt ?? 0) != 0, gone: card?.gone ?? false,
        lastActiveMs: last.isFinite ? last : nil)
    }
  }

  static func ms(_ text: String?) -> Double { JSDate.parse(text ?? "", timeZone: AppLocale.activeTimeZone()) }

  static func sorted(_ rows: [CleanupRow], by sort: String) -> [CleanupRow] {
    JSSort.sort(rows) { a, b in
      if sort == "quiet" {
        let gone = (a.gone ? -1.0 : 0) - (b.gone ? -1.0 : 0)
        if gone != 0 { return gone }
        let x = a.lastActiveMs ?? (a.checked ? -1 : .infinity)
        let y = b.lastActiveMs ?? (b.checked ? -1 : .infinity)
        return x - y
      }
      if sort == "interactions" { return Double(a.interactions - b.interactions) }
      return ms(a.followedAt) - ms(b.followedAt)
    }
  }
}

struct FollowCleanupPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ToastCenter.self) private var toasts: ToastCenter?
  let tool: ToolEntry
  let archive: ArchiveModel
  @State private var keep: KeepListModel
  @State private var follow = FollowWriter()
  @State private var progress = CleanupProgress()
  @State private var filter = "quiet"
  @State private var quietDays = 90
  @State private var sort = "quiet"
  @State private var selected: [String] = []
  @State private var undo: [String] = []
  @State private var known: [JSKey: CleanupRow] = [:]
  @State private var limit = FollowCleanup.page
  @State private var showKept = false
  @State private var confirming = false
  @State private var exporting: ExportFile?

  init(tool: ToolEntry, archive: ArchiveModel, store: any KeyValueStore) {
    self.tool = tool
    self.archive = archive
    _keep = State(initialValue: KeepListModel(did: archive.did, name: "cleanup", store: store))
  }

  private func has(_ list: [String], _ did: String) -> Bool { list.contains { $0.jsEquals(did) } }

  var body: some View {
    let sets = ReportModels.relationSets(ReportArchive(archive))
    let rows = FollowCleanup.rows(archive, sets: sets)
    let current = Set(rows.map { JSKey($0.did) })
    // A row unfollowed on this page leaves the archive's follows, but stays
    // on the page with its Undo until the page is left.
    let allRows = rows + undo.filter { !current.contains(JSKey($0)) }.compactMap { known[JSKey($0)] }
    let quietCut = archive.nowMs - Double(quietDays) * FollowCleanup.dayMs
    let isQuiet = { (r: CleanupRow) in r.checked && (r.gone || r.lastActiveMs == nil || (r.lastActiveMs ?? 0) < quietCut) }
    let unkept = rows.filter { !keep.has($0.did) }
    let counts = [
      "quiet": unkept.filter(isQuiet).count, "oneway": unkept.filter { !$0.followsYou }.count,
      "silent": unkept.filter { $0.recent == 0 }.count, "all": rows.count,
    ]
    let checkedCount = rows.filter(\.checked).count
    let filtered = FollowCleanup.sorted(
      allRows
        .filter { showKept || !keep.has($0.did) || has(undo, $0.did) }
        .filter { r in
          switch filter {
          case "quiet": return isQuiet(r)
          case "oneway": return !r.followsYou
          case "silent": return r.recent == 0
          default: return true
          }
        }, by: sort)
    let shown = Array(filtered.prefix(limit))
    let live = shown.filter { follow.isFollowing(archive, $0.did, sets: sets) }
    let selectedLive = selected.filter { follow.isFollowing(archive, $0, sets: sets) }
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    return VirgaPage(
      header: ToolHeader.header(tool, sub: "You follow \(fmt(rows.count)) accounts. Nothing happens until you press Unfollow.")
    ) {
      if !follow.known(archive) {
        Callout { Text("Who you follow arrives with the next sync. Until then there’s nothing to tidy.") }
      }
      checkCard(rows: rows, checkedCount: checkedCount)
      FilterCards(label: "Which accounts", choices: filterChoices(counts, checkedCount: checkedCount), selection: filter) { key in
        filter = key
        selected = []
        limit = FollowCleanup.page
      }
      VStack(alignment: .leading, spacing: 0) {
        if !shown.isEmpty || progress.working != nil || keep.size > 0 {
          tableBar(selectedLive: selectedLive, filtered: filtered, sets: sets)
        }
        if !shown.isEmpty {
          selectAll(live: live)
        }
        ForEach(shown, id: \.did) { row in
          CleanupRowView(
            row: row, archive: archive, sets: sets, follow: follow, quietCut: quietCut, kept: keep.has(row.did),
            undone: has(undo, row.did) && !follow.isFollowing(archive, row.did, sets: sets),
            selected: Binding(get: { has(selected, row.did) }, set: { on in toggleRow(row.did, on) }),
            onUnfollowed: { undo.append(row.did) })
        }
        if shown.isEmpty {
          EmptyState(
            filter == "quiet" && checkedCount == 0
              ? "Check activity to find the accounts that went quiet." : "Nobody here. Your follows are in good shape.")
        }
        ShowMoreFoot(shown: shown.count, total: filtered.count, page: FollowCleanup.page) { limit += FollowCleanup.page }
        CardCaption(
          "Unfollowing deletes the follow record from your repo, the same as unfollowing in any app. Undo writes a new one. Marking an account Keep only changes what this page suggests, in this browser."
        )
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Accounts")
    }
    .wantActors(archive, shown.map(\.did))
    .onChange(of: rows) { _, next in
      for r in next { known[JSKey(r.did)] = r }
    }
    .onAppear {
      for r in rows { known[JSKey(r.did)] = r }
    }
    .exportSheet($exporting)
    .virgaDialog(
      isPresented: $confirming,
      title: "Unfollow \(fmt(selectedLive.count)) \(selectedLive.count == 1 ? "account" : "accounts")?"
    ) {
      Text(
        "Their follow records are deleted from your repo, one by one. They aren’t told. Each row keeps an Undo for as long as this page is open."
      )
      .fixedSize(horizontal: false, vertical: true)
    } actions: {
      Button("Cancel") { confirming = false }
        .buttonStyle(.virga)
      Button("Unfollow") { unfollow(selectedLive) }
        .buttonStyle(.virga(.danger))
        .accessibilityIdentifier("cleanup-confirm")
    }
  }

  private func filterChoices(_ counts: [String: Int], checkedCount: Int) -> [FilterChoice] {
    [
      FilterChoice(
        key: "quiet", label: "Quiet for \(quietDays) days", count: counts["quiet"] ?? 0,
        hint: checkedCount != 0 ? "Or gone: deleted or deactivated" : "Check activity to find them"),
      FilterChoice(key: "oneway", label: "Don’t follow you back", count: counts["oneway"] ?? 0, hint: "One-way follows"),
      FilterChoice(
        key: "silent", label: "No interaction in a year", count: counts["silent"] ?? 0, hint: "Neither of you liked, replied or reposted"),
      FilterChoice(key: "all", label: "Everyone you follow", count: counts["all"] ?? 0, hint: "Unfiltered"),
    ]
  }

  private func toggleRow(_ did: String, _ on: Bool) {
    if on {
      if !has(selected, did) { selected.append(did) }
    } else {
      selected.removeAll { $0.jsEquals(did) }
    }
  }

  // MARK: The activity check

  private func checkCard(rows: [CleanupRow], checkedCount: Int) -> some View {
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    return FlowLayout(spacing: Measure.Tools.checkColumnGap, lineSpacing: Measure.Tools.checkRowGap, alignment: .top) {
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.cardSubSpaceAbove)) {
        Text(checkedCount != 0 ? "Activity checked for \(fmt(checkedCount)) of \(fmt(rows.count)) accounts" : "When did they last post?")
          .virgaText(
            size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, tracking: ThemeKit.cardTitleTracking)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text(
          "Reads the newest post or repost of each account you follow from Bluesky’s public API, one request each. About a minute for 800 accounts. Kept in this browser."
        )
        .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
        .foregroundStyle(theme.color(ThemeKit.cardSubInk))
        .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: theme.characters(Measure.Tools.checkTextMeasure), alignment: .leading)
      checkActions(rows: rows, checkedCount: checkedCount)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("cleanup-check")
  }

  @ViewBuilder
  private func checkActions(rows: [CleanupRow], checkedCount: Int) -> some View {
    if let checking = progress.checking {
      HStack(spacing: Measure.Tools.checkActionsGap) {
        Text("\(AppLocale.formatNumber(checking.done)) of \(AppLocale.formatNumber(checking.total))")
          .virgaText(.textBase)
          .foregroundStyle(theme.muted)
        ProgressLine(value: checking.total != 0 ? Double(checking.done) / Double(checking.total) : 0)
          .frame(width: Measure.Tools.checkProgressWidth)
          .accessibilityHidden(true)
        Button("Stop") { progress.task?.cancel() }
          .buttonStyle(.virga(size: .small))
      }
      .frame(minHeight: theme.points(ThemeKit.touchButtonHeight))
    } else {
      HStack(spacing: Measure.Tools.checkActionsGap) {
        InlineSelect(label: "Quiet after", options: FollowCleanup.quietChoices.map { ($0, "\($0) days") }, selection: $quietDays, large: true)
        Button {
          runCheck(rows.map(\.did))
        } label: {
          Label(checkedCount != 0 ? "Check again" : "Check activity", systemImage: Glyph.refresh)
        }
        .buttonStyle(.virga)
        .disabled(rows.isEmpty)
        .accessibilityIdentifier("cleanup-run-check")
      }
    }
  }

  private func runCheck(_ dids: [String]) {
    let progress = self.progress
    let archive = self.archive
    let toasts = self.toasts
    progress.checking = CleanupProgress.Tally(done: 0, total: dids.count)
    progress.task = Task { @MainActor in
      let n = await archive.checkActivity(dids) { p in
        Task { @MainActor in
          if progress.checking != nil { progress.checking = CleanupProgress.Tally(done: p.done, total: p.total) }
        }
      }
      toasts?.push("Checked \(AppLocale.formatNumber(n)) accounts.")
      progress.task = nil
      progress.checking = nil
    }
  }

  // MARK: The line over the table

  @ViewBuilder
  private func tableBar(selectedLive: [String], filtered: [CleanupRow], sets: RelationSets) -> some View {
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    FlowLayout(spacing: Measure.Tools.tableBarColumnGap, lineSpacing: Measure.Tools.tableBarRowGap, alignment: .center) {
      if let working = progress.working {
        Text("Unfollowing \(fmt(working.done)) of \(fmt(working.total))…")
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
      } else if !selectedLive.isEmpty {
        Text("\(fmt(selectedLive.count)) selected")
          .virgaText(.textBase, weight: VirgaWeight.semibold)
          .foregroundStyle(theme.ink)
        FlowLayout(spacing: Measure.Tools.tableBarActionsGap, lineSpacing: Measure.Tools.tableBarActionsLineGap, alignment: .center) {
          Button("Clear") { selected = [] }
            .buttonStyle(.virga(size: .small))
          Button("Keep, don’t suggest") {
            keep.add(selectedLive)
            toasts?.push("Kept \(selectedLive.count). They won’t be suggested again.")
            selected = []
          }
          .buttonStyle(.virga(size: .small))
          Button("Unfollow \(fmt(selectedLive.count))") { confirming = true }
            .buttonStyle(.virga(size: .small, destructive: true))
            .disabled(follow.locked(archive))
            .accessibilityIdentifier("cleanup-unfollow")
        }
      } else {
        InlineSelect(
          label: "Sort", options: [("quiet", "Quiet longest"), ("interactions", "Fewest interactions"), ("oldest", "Followed longest ago")],
          selection: $sort)
        HStack(spacing: theme.space4) {
          if keep.size > 0 {
            Button {
              showKept.toggle()
            } label: {
              Label(showKept ? "Hide kept" : "Show \(fmt(keep.size)) kept", systemImage: showKept ? ToolGlyph.hide : ToolGlyph.show)
            }
            .buttonStyle(.linkAction)
          }
          Button {
            exporting = archive.exportRows("follows", exportRows(filtered, sets: sets))
          } label: {
            Label("Export", systemImage: Glyph.download)
          }
          .buttonStyle(.linkAction)
        }
      }
    }
    .frame(maxWidth: .infinity, minHeight: Measure.Tools.tableBarMinHeight, alignment: .leading)
    .padding(.bottom, Measure.Tools.tableBarSpaceBelow)
  }

  /// "Select all shown", over the rows, on the rule in ink.
  private func selectAll(live: [CleanupRow]) -> some View {
    let all = !live.isEmpty && live.allSatisfy { has(selected, $0.did) }
    return HStack(spacing: Measure.Tools.rowGap) {
      RowCheck(
        isOn: Binding(get: { all }, set: { on in selected = on ? live.map(\.did) : [] }), label: "Select every account shown",
        disabled: live.isEmpty)
      Text("Select all shown")
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .foregroundStyle(theme.muted)
        .accessibilityHidden(true)
    }
    .frame(maxWidth: .infinity, minHeight: Measure.Touch.target, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.rule).frame(height: 1) }
  }

  private func exportRows(_ rows: [CleanupRow], sets: RelationSets) -> [[JSONValue?]] {
    var out: [[JSONValue?]] = [ToolExport.row(["did", "handle", "follows_you", "last_active", "interactions", "followed_at"])]
    for r in rows {
      let last: String = r.gone ? "gone" : (r.lastActiveMs.flatMap { $0 != 0 ? JSDate.toISOString($0) : nil } ?? "")
      out.append([
        .string(r.did), .string(ToolPeople.cardFor(archive, r.did, sets: sets)?.handle ?? ""), .string(r.followsYou ? "yes" : "no"),
        .string(last), .number(Double(r.interactions)), .string(r.followedAt ?? ""),
      ])
    }
    return out
  }

  // MARK: Unfollowing

  private func unfollow(_ dids: [String]) {
    confirming = false
    let progress = self.progress
    progress.working = CleanupProgress.Tally(done: 0, total: dids.count)
    Task { @MainActor in
      var ok = 0
      for did in dids {
        if await follow.toggle(archive, did, false) {
          ok += 1
          if !has(undo, did) { undo.append(did) }
        }
        if let w = progress.working { progress.working = CleanupProgress.Tally(done: w.done + 1, total: w.total) }
      }
      progress.working = nil
      selected = []
      toasts?.push("Unfollowed \(AppLocale.formatNumber(ok)) \(ok == 1 ? "account" : "accounts"). Each row can undo it.")
    }
  }
}

/// A row's tick box: a box rather than a word on a line, a finger's size
/// to press.
struct RowCheck: View {
  @Environment(\.virgaTheme) private var theme
  @Binding var isOn: Bool
  let label: String
  var disabled = false

  var body: some View {
    let box = Measure.Legal.checkBox
    Button {
      isOn.toggle()
    } label: {
      ZStack {
        RoundedRectangle(cornerRadius: theme.radiusSm / 2)
          .fill(isOn ? theme.accent : theme.surface)
        RoundedRectangle(cornerRadius: theme.radiusSm / 2)
          .strokeBorder(isOn ? theme.accent : theme.line2, lineWidth: 1)
        if isOn {
          Image(systemName: Glyph.check)
            .font(.system(size: box * 0.6, weight: .bold))
            .foregroundStyle(theme.onAccent)
        }
      }
      .frame(width: box, height: box)
      .frame(width: Measure.Touch.target, height: Measure.Touch.target)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(disabled)
    .opacity(disabled ? ThemeKit.disabledOpacity : 1)
    .padding(.horizontal, -(Measure.Touch.target - box) / 2)
    .accessibilityLabel(label)
    .accessibilityValue(isOn ? "Checked" : "Unchecked")
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// One account in the table, as the web's phone sets the row.
struct CleanupRowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let row: CleanupRow
  let archive: ArchiveModel
  let sets: RelationSets
  let follow: FollowWriter
  let quietCut: Double
  let kept: Bool
  let undone: Bool
  @Binding var selected: Bool
  let onUnfollowed: () -> Void

  var body: some View {
    let card = ToolPeople.cardFor(archive, row.did, sets: sets)
    let name = ToolPeople.displayName(card, row.did)
    let following = follow.isFollowing(archive, row.did, sets: sets)
    let bleed = Measure.Tools.selectedBleed
    return HStack(alignment: .top, spacing: Measure.Tools.rowGap) {
      RowCheck(isOn: $selected, label: "Select \(name)", disabled: !following)
      VStack(alignment: .leading, spacing: theme.space1) {
        HStack(alignment: .center, spacing: Measure.Tools.personGap) {
          Avatar(src: card?.avatar, name: card?.displayName ?? card?.handle)
          person(card, name)
            .frame(maxWidth: .infinity, alignment: .leading)
          action(name, following: following)
        }
        facts
        if let error = follow.error(row.did) {
          Text(error).virgaText(.textSm).foregroundStyle(theme.danger).fixedSize(horizontal: false, vertical: true)
        }
      }
    }
    .padding(.vertical, theme.rowPad)
    .background {
      if selected { theme.tint.padding(.horizontal, -bleed) }
    }
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
  }

  private func person(_ card: PersonCard?, _ name: String) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        if let url = ToolPeople.profileUrl(card, row.did) { openURL(url) }
      } label: {
        Text(name)
          .virgaText(.textMd, weight: VirgaWeight.medium, lineHeight: Measure.Tools.personLineHeight)
          .strikethrough(undone)
          .foregroundStyle(undone ? theme.muted : theme.ink)
          .lineLimit(1)
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isLink)
      let handle = card?.displayName != nil ? card?.handle : nil
      if handle != nil || kept {
        MetaLine([handle.map { MetaItem("@\($0)", id: "handle") }, kept ? MetaItem("Kept", id: "kept") : nil].compactMap { $0 })
          .lineLimit(1)
      }
    }
  }

  @ViewBuilder
  private func action(_ name: String, following: Bool) -> some View {
    if following {
      Button("Unfollow") {
        Task { if await follow.toggle(archive, row.did, false) { onUnfollowed() } }
      }
      .buttonStyle(.virga(size: .small))
      .disabled(follow.busy(archive, row.did))
      .accessibilityLabel("Unfollow \(name)")
    } else {
      Button("Undo") {
        Task { await follow.toggle(archive, row.did, true) }
      }
      .buttonStyle(.virga(size: .small))
      .disabled(follow.busy(archive, row.did))
      .accessibilityLabel("Undo unfollowing \(name)")
    }
  }

  /// When they were last active first, then when you followed them,
  /// whether they follow you, and how much you have had to do with each
  /// other; a "No" and a nought say nothing here, so they go.
  private var facts: some View {
    let dot: DotState = row.gone ? .danger : !row.checked ? .idle : ((row.lastActiveMs ?? 0) != 0 && (row.lastActiveMs ?? 0) >= quietCut ? .ok : .warn)
    let activity: String
    if row.gone {
      activity = "Gone"
    } else if !row.checked {
      activity = "Not checked"
    } else if let last = row.lastActiveMs, last != 0 {
      activity = Time.relativeTime(last, now: SyncStatus.now())
    } else {
      activity = "Never posted"
    }
    var rest: [String] = []
    if let at = row.followedAt, !at.isEmpty { rest.append("followed \(Time.formatDateShort(at))") }
    if row.followsYou { rest.append("follows you") }
    if row.interactions != 0 {
      rest.append("\(AppLocale.formatNumber(row.interactions)) \(row.interactions == 1 ? "interaction" : "interactions")")
    }
    return FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
      MetaPiece(isLast: rest.isEmpty) {
        HStack(spacing: Measure.Tools.activityGap) {
          StateDot(dot)
          Text(activity)
        }
      }
      ForEach(Array(rest.enumerated()), id: \.offset) { index, fact in
        MetaPiece(isLast: index == rest.count - 1) { Text(fact) }
      }
    }
    .padding(.leading, theme.points(ThemeKit.avatarSize) + Measure.Tools.personGap)
  }
}
#endif
