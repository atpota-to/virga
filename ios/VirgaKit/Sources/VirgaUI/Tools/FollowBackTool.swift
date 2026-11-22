// Ports src/tools/FollowBack.jsx
// Ports src/tools/tools.css (.queue-fact, .queue-dismiss)
//
// The follow-back queue: people who follow you and engage with your
// posts, that you don't follow yet, the most engaged first. Each row has
// Follow back; its ✕ (Dismiss) keeps someone out of the queue for good,
// on this device (the kept list, Keep's "followback"). Someone followed
// from the queue stays on it (reading Following) until the page is left,
// so the press can be undone.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct FollowBackTool: View {
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    VirgaPage(header: ToolHeader.header(tool, period: AnyView(PeriodPicker()))) {
      if let archive {
        FollowBackQueue(archive: archive, store: app.stores.keyValue)
          .id(archive.did)
      }
    }
  }
}

struct FollowBackQueue: View {
  static let page = 25

  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences
  let archive: ArchiveModel
  @State private var dismissed: KeepListModel
  @State private var follow = FollowWriter()
  @State private var limit = FollowBackQueue.page
  @State private var followed: [String] = []

  init(archive: ArchiveModel, store: any KeyValueStore) {
    self.archive = archive
    _dismissed = State(initialValue: KeepListModel(did: archive.did, name: "followback", store: store))
  }

  var body: some View {
    let period = preferences.period()
    let report = ReportArchive(archive)
    let sets = ReportModels.relationSets(report)
    let queue = ReportModels.followBackModel(report, period, archive.nowMs)
    let rows = queue.filter { !dismissed.has($0.did) }
    let held = followed.filter { did in !rows.contains { $0.did.jsEquals(did) } }
    let shown = Array(rows.prefix(limit))
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    VirgaSection(
      title: "\(fmt(rows.count)) \(rows.count == 1 ? "person" : "people") waiting",
      sub: "Engaged with you in \(Periods.periodPhrase(period)), follow you, and you don’t follow them.",
      trailing: dismissed.size > 0
        ? AnyView(
          Button {
            dismissed.clear()
          } label: {
            Label("Bring back \(dismissed.size) dismissed", systemImage: ToolGlyph.undo)
          }
          .buttonStyle(.linkAction))
        : nil,
      flush: true,
      caption:
        "Engagement comes from your notifications, which reach back about a year. Follow back writes a follow record to your repo."
    ) {
      if !follow.known(archive) {
        Callout {
          Text("Who you follow arrives with the next sync; until then the queue can’t tell who you already follow.")
        }
        .padding(.vertical, Measure.Tools.flushCalloutSpace)
      }
      if !shown.isEmpty || !held.isEmpty {
        ForEach(held, id: \.self) { did in
          ToolPersonRow(
            archive: archive, sets: sets, did: did, meta: ["followed just now"], follow: follow, followLabel: "Follow back",
            onFollowDone: { ok in if ok { track(did) } }, rel: false)
        }
        ForEach(shown, id: \.did) { row in
          ToolPersonRow(
            archive: archive, sets: sets, did: row.did, meta: detail(row), follow: follow, followLabel: "Follow back",
            onFollowDone: { ok in if ok { track(row.did) } }, rel: false,
            extra: AnyView(dismiss(row.did)))
        }
      } else {
        ToolEmptyLine("Everyone who follows you and engaged in this window, you already follow.")
      }
      ToolMoreFoot(shown: shown.count, total: rows.count, page: Self.page) { limit += Self.page }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("The queue")
    .wantActors(archive, shown.map(\.did))
  }

  /// Why they are here, the count in words first: "36 interactions · 13
  /// likes, 9 reposts"; a phone's row keeps the count alone.
  private func detail(_ row: TopActor) -> [String] {
    let count = "\(AppLocale.formatNumber(row.total)) \(row.total == 1 ? "interaction" : "interactions")"
    let kinds = InteractionModel.kindsLine(row.byKind, byCount: true)
    return theme.isPhone || kinds.isEmpty ? [count] : [count, kinds]
  }

  private func track(_ did: String) {
    if !followed.contains(where: { $0.jsEquals(did) }) { followed.append(did) }
  }

  private func dismiss(_ did: String) -> some View {
    Button {
      dismissed.add([did])
    } label: {
      Image(systemName: Glyph.close).font(.system(size: Measure.Tools.dismissGlyph))
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .accessibilityLabel("Dismiss from the queue")
    .accessibilityHint("Don’t suggest again")
  }
}
#endif
