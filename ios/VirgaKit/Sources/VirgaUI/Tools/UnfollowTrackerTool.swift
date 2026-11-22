// Ports src/tools/UnfollowTracker.jsx
// Ports src/tools/tools.css (.change-head, .change-group, .change-group-head, .change-date)
//
// Who left, and who arrived, between syncs. An unfollow takes its follow
// record with it, so the only way to see one is to compare the follower
// list at two syncs; every sync with a complete list on both sides adds
// its differences to the log the archive keeps. The figures first; then
// the two lists as a pair of keys where the heading's title would be,
// with Sync now and Export at the right, each change under the sync that
// noticed it.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct UnfollowTrackerTool: View {
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    VirgaPage(header: ToolHeader.header(tool)) {
      if let archive {
        UnfollowLog(archive: archive)
          .id(archive.did)
      }
    }
  }
}

struct UnfollowLog: View {
  static let page = 40

  @Environment(\.virgaTheme) private var theme
  let archive: ArchiveModel
  @State private var follow = FollowWriter()
  @State private var side = "lost"
  @State private var limit = UnfollowLog.page
  @State private var exporting: ExportFile?

  /// A sync's changes: when it noticed them, the sync before, and who.
  struct ChangeGroup: Identifiable {
    var at: Double?
    var since: Double?
    var entries: [FollowerLogEntry]
    var id: String { "\(at ?? .nan)" }
  }

  var body: some View {
    let m = ReportModels.followerLogModel(ReportArchive(archive))
    if !m.tracking {
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
        EmptyState(
          "Virga compares your follower list at each sync with the one before. Your archive has one list so far; the next sync will have a second to compare it with, and from then on every unfollow lands here."
        )
        Button {
          syncNow()
        } label: {
          Label(archive.sync != nil ? "Syncing…" : "Sync now", systemImage: Glyph.refresh)
        }
        .buttonStyle(.virga)
        .disabled(archive.sync != nil)
      }
    } else {
      figures(m)
      changes(m)
    }
  }

  private func syncNow() {
    let mode: SyncMode = archive.data.meta.posts?.complete == true ? .incremental : .resume
    Task { await archive.runSync(mode) }
  }

  private func figures(_ m: FollowerLogReport) -> some View {
    let since = "Since \(m.since.map { Time.formatDateShort($0) } ?? "")"
    let last = m.lastSyncAt.map { Time.relativeTime($0, now: SyncStatus.now()) } ?? ""
    func note(_ text: String) -> AnyView? { text.isEmpty ? nil : AnyView(Text(text)) }
    return FiguresView(
      [
        FigureItem(key: "left", label: "Left at the last sync", value: .number(Double(m.latestLost.count)), note: note(last)),
        FigureItem(key: "arrived", label: "Arrived at the last sync", value: .number(Double(m.latestGained.count))),
        FigureItem(key: "left-all", label: "Left in all", value: .number(Double(m.lost.count)), note: note(since)),
        FigureItem(key: "arrived-all", label: "Arrived in all", value: .number(Double(m.gained.count)), note: note(since)),
      ], label: "Changes in figures")
  }

  private func changes(_ m: FollowerLogReport) -> some View {
    let entries = side == "lost" ? m.lost : m.gained
    let shown = Array(entries.prefix(limit))
    let sets = ReportModels.relationSets(ReportArchive(archive))
    let since = m.since.map { Time.formatDateShort($0) } ?? ""
    return VStack(alignment: .leading, spacing: 0) {
      head(m)
        .padding(.bottom, theme.points(ThemeKit.flushHeadSpaceBelow))
      Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
      if entries.isEmpty {
        EmptyState(side == "lost" ? "Nobody has unfollowed you since \(since)." : "Nobody new since \(since).")
          .padding(.top, theme.rowPad)
      }
      ForEach(Self.groups(shown)) { group in
        groupView(group, sets: sets)
      }
      ToolMoreFoot(shown: shown.count, total: entries.count, page: Self.page) { limit += Self.page }
      ToolCaption(
        "A change is noticed at the sync after it happened, so “noticed” is a window, not a moment. Someone who unfollowed and followed again between two syncs never shows. The log is kept in this browser, up to 5,000 changes."
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(side == "lost" ? "Who left" : "Who arrived")
    .toolExporter($exporting)
  }

  /// The two lists as the heading's words, then what to do with the log.
  private func head(_ m: FollowerLogReport) -> some View {
    HStack(alignment: .center, spacing: theme.space4) {
      Segmented(
        label: "Show", options: [SegmentedOption("lost", "Left"), SegmentedOption("gained", "Arrived")], selection: side, size: .small
      ) { value in
        side = value
        limit = Self.page
      }
      Spacer(minLength: 0)
      HStack(spacing: theme.space4) {
        Button {
          syncNow()
        } label: {
          Label(archive.sync != nil ? "Syncing…" : "Sync now", systemImage: Glyph.refresh)
        }
        .buttonStyle(.linkAction)
        .disabled(archive.sync != nil)
        Button {
          exporting = archive.exportRows("follower-changes", Self.exportRows(m))
        } label: {
          Label("Export", systemImage: Glyph.download)
        }
        .buttonStyle(.linkAction)
      }
    }
  }

  private func groupView(_ group: ChangeGroup, sets: RelationSets) -> some View {
    let noticed = group.at.map { Time.formatDateShort($0) } ?? ""
    let after = group.since.map { ", since the sync on \(Time.formatDateShort($0))" } ?? ""
    return VStack(alignment: .leading, spacing: 0) {
      Text("Noticed \(noticed)\(after) · \(AppLocale.formatNumber(group.entries.count))")
        .virgaText(.textSm, weight: VirgaWeight.medium)
        .foregroundStyle(theme.muted)
        .padding(.top, Measure.Tools.changeHeadSpaceAbove)
        .padding(.bottom, Measure.Tools.changeHeadSpaceBelow)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        .accessibilityAddTraits(.isHeader)
      ForEach(Array(group.entries.enumerated()), id: \.offset) { _, entry in
        ToolPersonRow(archive: archive, sets: sets, did: entry.did, card: ToolPersonCard(entry), meta: meta(entry), follow: follow)
      }
    }
  }

  private func meta(_ entry: FollowerLogEntry) -> [String] {
    guard let followedAt = entry.followedAt, !followedAt.isEmpty else { return [] }
    if side == "lost" { return ["had followed you since \(Time.formatDateShort(followedAt))"] }
    return ["followed \(Time.relativeTime(followedAt, now: SyncStatus.now()))"]
  }

  /// Grouped by the sync that noticed them.
  static func groups(_ entries: [FollowerLogEntry]) -> [ChangeGroup] {
    var out: [ChangeGroup] = []
    for entry in entries {
      if let last = out.last, last.at == entry.at {
        out[out.count - 1].entries.append(entry)
      } else {
        out.append(ChangeGroup(at: entry.at, since: entry.since, entries: [entry]))
      }
    }
    return out
  }

  static func exportRows(_ m: FollowerLogReport) -> [[JSONValue?]] {
    func iso(_ ms: Double?) -> JSONValue? { ms.flatMap { JSDate.toISOString($0) }.map(JSONValue.string) }
    func text(_ s: String?) -> JSONValue? { s.map(JSONValue.string) }
    var rows: [[JSONValue?]] = [ToolExport.row(["change", "did", "handle", "display_name", "noticed_at", "since", "followed_at"])]
    for e in m.lost + m.gained {
      rows.append([
        .string(e.kind), .string(e.did), text(e.handle), text(e.displayName), iso(e.at), iso(e.since) ?? .string(""),
        text(e.followedAt.flatMap { $0.isEmpty ? nil : $0 }) ?? .string(""),
      ])
    }
    return rows
  }
}
#endif
