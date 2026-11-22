// Ports src/defense/DefenseHistory.jsx
// Ports src/defense/defense.css (.defense-plan-rows, .defense-plan-row)
//
// Defense › History: every approval and what came of it, and everyone
// added to or taken off a list, newest first, with the owner's own words.
// It's what "why is this person on my list" reads, and where an approval,
// or one person, is taken back (undo removes by the very record its add
// wrote). While anything is being written the history is read again every
// 15 seconds.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaDefense
import VirgaNetwork
import VirgaInsights
import VirgaPosting
import VirgaSession

struct DefenseHistoryPage: View {
  /// How often the history is read again while anything waits.
  static let pollMs: Double = 15_000

  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @State private var defense: DefenseAccountModel
  @State private var lists: DefenseListsModel
  @State private var decisions: [DefenseDecision] = []
  @State private var plans: [DefensePlan] = []
  @State private var loading = true
  @State private var error: String?
  @State private var more = false
  @State private var undoing: Undoing?
  @State private var busy = false

  /// What Undo would take back: an approval's adds, or some decisions.
  struct Undoing: Hashable {
    var planId: String?
    var ids: [Int]?
    var label: String
  }

  init(session: SessionModel) {
    _defense = State(initialValue: DefenseAccountModel(session: session))
    _lists = State(initialValue: DefenseListsModel(did: session.did, session: session))
  }

  var body: some View {
    let page = DefenseRoutes.defensePageByKey["history"]
    let waiting = decisions.contains { $0.state == "queued" || $0.state == "sent" }
    VirgaPage(
      PageHeaderModel(
        title: page?.title ?? "History", sub: page?.desc, access: ["lists"], crumbs: [Crumb("Defense", to: DefenseRoutes.defenseBase)])
    ) {
      if lists.requester == nil {
        Callout(tone: .warn) {
          Text(
            "The history is kept by Virga’s server, so it needs a long session. Reconnect for a longer session from the account menu.")
        }
        .accessibilityIdentifier("defense-history-needs")
      } else if loading {
        EmptyState("Reading the history…")
      } else {
        if let error {
          Callout(tone: .danger) { Text(error) }
            .accessibilityIdentifier("defense-history-error")
        }
        approvals
        everyone
      }
    }
    .task { await lists.start() }
    .task(id: defense.did ?? "") {
      await lists.update(did: defense.did)
      await load()
    }
    .task(id: waiting) {
      guard waiting else { return }
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: UInt64(Self.pollMs * 1_000_000))
        if Task.isCancelled { return }
        await load()
      }
    }
    .onDisappear { lists.stop() }
    .wantActorsIf(archive, Array(decisions.prefix(200)).compactMap(\.did))
    .virgaDialog(isPresented: Binding(get: { undoing != nil }, set: { if !$0 && !busy { undoing = nil } }), title: "Take \(undoing?.label ?? "them") off the list?") {
      Text(
        "Those not written yet are cancelled now. Those on the list are taken off a batch at a time, by the very record each add wrote. Anyone added another way stays."
      )
      .fixedSize(horizontal: false, vertical: true)
      // Nor can a swipe close it while it works (`onClose={() => !busy && …}`).
      .interactiveDismissDisabled(busy)
    } actions: {
      Button("Cancel") { undoing = nil }
        .buttonStyle(.virga(.ghost))
        .disabled(busy)
      Button(busy ? "Taking off…" : "Take off") { Task { await confirmUndo() } }
        .buttonStyle(.virga(.primary))
        .disabled(busy)
        .accessibilityIdentifier("defense-undo-confirm")
    }
  }

  private var listName: [String: String] {
    var out: [String: String] = [:]
    for l in DefenseListRows.lists(lists.data) { out[DefenseListRows.id(l)] = DefenseListRows.name(l) }
    return out
  }

  // MARK: Approvals

  private var approvals: some View {
    let names = listName
    return VirgaSection(title: "Approvals", sub: "Each time you added people from a scan, and what came of it.") {
      if plans.isEmpty {
        EmptyState("Nothing approved yet. Scan a post, and Add to a list under its result.")
      } else {
        VStack(alignment: .leading, spacing: 0) {
          Rectangle().fill(theme.rule).frame(height: 1)
          ForEach(Array(plans.enumerated()), id: \.offset) { _, plan in
            planRow(plan, names: names)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-approvals")
  }

  private func planRow(_ p: DefensePlan, names: [String: String]) -> some View {
    let out = HistoryModel.planOutcome(p)
    let post = p.postUri.flatMap { PostLink.bskyUrlFor($0) }
    let approved = Time.formatDateShort(p.approvedAt ?? "")
    let list = p.listId.flatMap { names[$0] } ?? "a list no longer kept"
    let bands = (p.bands ?? []).map { (BandWords.bandWord[$0] ?? "").jsLowercased() }.joined(separator: ", ")
    let words = VStack(alignment: .leading, spacing: Measure.Defense.listMainGap) {
      Text(p.note.flatMap { $0.isEmpty ? nil : $0 } ?? "From a scan, \(approved)")
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      FlowLayout(spacing: 0, lineSpacing: 0, alignment: .center) {
        MetaPiece(isLast: false) { Text(approved) }
        MetaPiece(isLast: false) { Text("to “\(list)”") }
        MetaPiece(isLast: post == nil) { Text(bands) }
        if let post, let url = URL(string: post) {
          MetaPiece(isLast: true) {
            Button {
              openURL(url)
            } label: {
              // `.meta > * { gap: 5px }`, `.meta svg { width: 13px }`; a link is ink.
              HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
                Text("the post").underline(true)
                Image(systemName: Glyph.externalLink).font(.system(size: theme.points(ThemeKit.metaIconSize)))
              }
              .foregroundStyle(theme.ink)
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
          }
        }
      }
      MetaLine([out.line])
    }
    let undo = Button {
      if let id = p.id { undoing = Undoing(planId: id, ids: nil, label: "\(AppLocale.fmtInt(Double(out.live))) from this approval") }
    } label: {
      Label("Undo", systemImage: ToolGlyph.undo)
    }
    .buttonStyle(.linkAction)
    .accessibilityIdentifier("defense-plan-undo")
    return Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: theme.space2) {
          words
          if out.live > 0 { undo }
        }
      } else {
        HStack(alignment: .firstTextBaseline, spacing: theme.space4) {
          words.frame(maxWidth: .infinity, alignment: .leading)
          if out.live > 0 { undo }
        }
      }
    }
    .padding(.vertical, theme.rowPadLg)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
  }

  // MARK: Everyone

  private var everyone: some View {
    let names = listName
    return VirgaSection(
      title: "Everyone", sub: "Newest first. A vetoed add is someone the veto kept off at the moment they would have been written."
    ) {
      if decisions.isEmpty {
        EmptyState("Nobody added or taken off yet.")
      } else if let archive {
        let sets = ReportModels.relationSets(ReportArchive(archive))
        VStack(alignment: .leading, spacing: 0) {
          ForEach(decisions, id: \.id) { d in
            decisionRow(d, archive: archive, sets: sets, names: names)
          }
        }
      }
      if more {
        Button("Show older") { Task { await load(before: decisions.last.map { JSONValue.number(Double($0.id)) }) } }
          .buttonStyle(.linkAction)
          .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-everyone")
  }

  private func decisionRow(_ d: DefenseDecision, archive: ArchiveModel, sets: RelationSets, names: [String: String]) -> some View {
    let list = d.listId.flatMap { names[$0] }
    let when = Time.formatDateShort((d.actedAt.flatMap { $0.isEmpty ? nil : $0 } ?? d.createdAt) ?? "")
    let meta = [HistoryModel.decisionPhrase(d), list.map { "“\($0)”" }, when, d.note].compactMap { $0 }.filter { !$0.isEmpty }
    let undoable = d.action == "add" && (d.undoneAt ?? "").isEmpty && ["done", "queued", "sent"].contains(d.state)
    return ToolPersonRow(
      archive: archive, sets: sets, did: d.did ?? "", meta: meta,
      extra: undoable
        ? AnyView(
          Button("Take off") { undoing = Undoing(planId: nil, ids: [d.id], label: "this person") }
            .buttonStyle(.virga(.ghost, size: .small)))
        : nil)
  }

  // MARK: Reading and undoing

  /// `load(before)`: the newest 200 decisions and the plans, or the next
  /// 200 older ones after `before`.
  private func load(before: JSONValue? = nil) async {
    guard let req = lists.requester else {
      loading = false
      return
    }
    do {
      let data = try await DefenseService.fetchHistory(req, before: before)
      let read = (try? data["decisions"]?.decode([DefenseDecision].self)) ?? []
      let readPlans = (try? data["plans"]?.decode([DefensePlan].self)) ?? []
      if before.isPresent {
        decisions += read
      } else {
        decisions = read
        plans = readPlans
      }
      loading = false
      error = nil
      more = read.count >= 200
    } catch {
      loading = false
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }

  private func confirmUndo() async {
    guard let undoing else { return }
    busy = true
    defer { busy = false }
    do {
      _ = try await DefenseService.undoAdds(
        lists.requester, planId: undoing.planId.map { JSONValue.string($0) }, ids: undoing.ids.map { $0.map { JSONValue.number(Double($0)) } })
      self.undoing = nil
      await load()
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
      self.undoing = nil
    }
  }
}

extension View {
  /// `useWantActors(archive, dids)` where the page may have no archive.
  func wantActorsIf(_ archive: ArchiveModel?, _ dids: [String]) -> some View {
    modifier(WantActorsIfArchive(archive: archive, dids: dids))
  }
}
#endif
