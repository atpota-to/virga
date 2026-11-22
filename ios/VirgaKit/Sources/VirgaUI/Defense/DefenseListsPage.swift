// Ports src/defense/DefenseLists.jsx
// Ports src/defense/defense.css (.defense-list-rows, .defense-list-row, .defense-list-main, .defense-list-name, .defense-list-held, .defense-keep-form, .defense-new-list--page)
//
// Defense › Lists: the block and mute lists Defense keeps for the account,
// what each holds by Virga's hand and what is still being written, a new
// one, the moderator linked for DMs (ModeratorCard.swift, when the build
// turns it on), and the people kept off every list by hand.
//
// The lists are records in the account's own repo: anyone can see them on
// its profile, and the account blocks or mutes one in Bluesky to have it
// take effect. The writing is done by Virga's server, so the page reads it
// back every few seconds while anything waits (DefenseListsModel).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaDefense
import VirgaInsights
import VirgaNetwork
import VirgaPosting
import VirgaSession

/// An error a page raises with words of its own (`new Error(…)`).
struct DefensePageError: LocalizedError {
  var message: String
  var errorDescription: String? { message }
}

struct DefenseListsPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(AppModel.self) private var app
  @State private var defense: DefenseAccountModel
  @State private var lists: DefenseListsModel

  init(session: SessionModel) {
    _defense = State(initialValue: DefenseAccountModel(session: session))
    _lists = State(initialValue: DefenseListsModel(did: session.did, session: session))
  }

  var body: some View {
    let page = DefenseRoutes.defensePageByKey["lists"]
    // The scan's conditions, without a scan: a list is made and written the same way.
    let why = DefenseWhy.whyNot(vouchCheck: .canary, caps: defense.caps, authMode: defense.session.authMode, lists: lists)
    VirgaPage(
      PageHeaderModel(
        title: page?.title ?? "Lists", sub: page?.desc, access: ["lists"], crumbs: [Crumb("Defense", to: DefenseRoutes.defenseBase)])
    ) {
      if let why {
        DefenseWhyNotView(why: why, asking: defense.asking) { Task { await defense.askFor(.lists) } }
      } else {
        YourListsCard(lists: lists)
        if app.flags.defenseModeratorEnabled {
          ModeratorCard(lists: lists)
        }
        KeptByHandCard(lists: lists, transport: app.archiveEnvironment.transport)
      }
    }
    .task { await lists.start() }
    .task(id: defense.did ?? "") { await lists.update(did: defense.did) }
    .onDisappear { lists.stop() }
  }
}

/// `heldLine(list)`: "Waiting until 14:20: the PDS's write limit was reached", or nil.
enum DefenseHeld {
  static func line(_ list: JSONValue, now: Double = SyncStatus.now()) -> String? {
    let heldUntil = list["heldUntil"].truthy
    let lastError = list["lastError"].truthy
    if !heldUntil.isPresent && !lastError.isPresent { return nil }
    var when: String?
    if let heldUntil {
      let until: Double
      if case .number(let n) = heldUntil { until = n } else { until = JSDate.parse(heldUntil.jsString, timeZone: AppLocale.activeTimeZone()) }
      if until.isFinite && until > now {
        when = "Waiting until \(AppLocale.toLocaleTimeString(until, DateFormatOptions(hour: "numeric", minute: "2-digit")))"
      }
    }
    let parts = [when, lastError.map(\.jsString)].compactMap { $0 }.filter { !$0.isEmpty }
    return parts.isEmpty ? nil : parts.joined(separator: ": ")
  }
}

/// `YourLists`: the lists, with New list and its form.
struct YourListsCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let lists: DefenseListsModel
  @State private var making = false
  @State private var name = ""
  @State private var purpose = "block"
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    let all = DefenseListRows.lists(lists.data)
    let fmt = { (n: Int) in AppLocale.fmtInt(Double(n)) }
    VirgaSection(
      title: all.isEmpty ? "Your lists" : "\(fmt(all.count)) \(all.count == 1 ? "list" : "lists")",
      sub: "In your own repo, on your profile. Block or mute one in Bluesky for it to take effect for you.",
      trailing: making
        ? nil
        : AnyView(
          Button {
            making = true
          } label: {
            Label("New list", systemImage: Glyph.plus)
          }
          .buttonStyle(.linkAction))
    ) {
      if making { form }
      if all.isEmpty {
        if !making { ToolEmptyLine("No lists yet. Make one here, or from a scan’s Add to a list.") }
      } else {
        VStack(alignment: .leading, spacing: 0) {
          Rectangle().fill(theme.rule).frame(height: 1)
          ForEach(Array(all.enumerated()), id: \.offset) { _, list in
            row(list)
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-lists")
  }

  private var form: some View {
    VStack(alignment: .leading, spacing: theme.space4) {
      DefenseNewListFields(name: $name, purpose: $purpose, nameLabel: "Name") {
        if !busy && !name.jsTrimmed().isEmpty { Task { await make() } }
      }
      HStack(spacing: theme.space3) {
        Button(busy ? "Making it…" : "Make the list") { Task { await make() } }
          .buttonStyle(.virga)
          .disabled(busy || name.jsTrimmed().isEmpty)
        Button("Cancel") { making = false }
          .buttonStyle(.virga(.ghost))
          .disabled(busy)
      }
      if let error {
        Callout(tone: .danger, error)
      }
    }
    .frame(maxWidth: Measure.Defense.columnMax, alignment: .leading)
    .padding(.bottom, theme.space5)
  }

  private func make() async {
    let typed = name.jsTrimmed()
    guard !typed.isEmpty else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      _ = try await DefenseService.createList(lists.requester, name: typed, purpose: purpose)
      making = false
      name = ""
      await lists.refresh()
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }

  private func row(_ list: JSONValue) -> some View {
    let held = DefenseHeld.line(list)
    let link = PostLink.bskyUrlFor(list["uri"]?.stringValue)
    let listed = list["listed"].jsNumber
    let waiting = list["waiting"].jsNumber
    var facts = [DefenseListRows.purpose(list) == "mute" ? "To mute" : "To block", "\(AppLocale.fmtInt(listed)) on it by Virga"]
    if waiting > 0 { facts.append("\(AppLocale.fmtInt(waiting)) being written") }
    facts.append("Made \(Time.formatDateShort(list["createdAt"]?.stringValue ?? ""))")
    return VStack(alignment: .leading, spacing: Measure.Defense.listMainGap) {
      if let link, let url = URL(string: link) {
        Button {
          openURL(url)
        } label: {
          HStack(spacing: Measure.Defense.listNameGap) {
            Text(DefenseListRows.name(list)).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
            Image(systemName: Glyph.externalLink).font(.system(size: Measure.Tools.linkGlyph)).foregroundStyle(theme.muted)
          }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
      } else {
        Text(DefenseListRows.name(list)).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
      }
      MetaLine(facts)
      if let held {
        Text(held).virgaText(.textSm).foregroundStyle(theme.warn).fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, theme.rowPadLg)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("defense-list-row")
  }
}

/// `KeptByHand`: the people never added to any list, and the form that
/// keeps one more.
struct KeptByHandCard: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let lists: DefenseListsModel
  let transport: any HTTPTransport
  @State private var handle = ""
  @State private var reason = ""
  /// "add" while keeping someone, or the DID being let go.
  @State private var busy: String?
  @State private var error: String?

  var body: some View {
    let kept = lists.data?["kept"]?.arrayValue ?? []
    let dids = kept.compactMap { $0["did"]?.stringValue }
    VirgaSection(
      title: kept.isEmpty ? "Kept by hand" : "\(AppLocale.fmtInt(Double(kept.count))) kept by hand",
      sub: "Never added to any of your lists, whatever a scan says. Everyone you follow is kept already."
    ) {
      form
      if let error {
        Callout(tone: .danger, error)
          .padding(.bottom, theme.space4)
      }
      if let archive, !kept.isEmpty {
        let sets = ReportModels.relationSets(ReportArchive(archive))
        ForEach(Array(kept.enumerated()), id: \.offset) { _, k in
          let did = k["did"]?.stringValue ?? ""
          ToolPersonRow(
            archive: archive, sets: sets, did: did, meta: k["reason"]?.stringValue.map { [$0] } ?? [],
            extra: AnyView(
              Button("Stop keeping") { Task { await unkeep(did) } }
                .buttonStyle(.virga(.ghost, size: .small))
                .disabled(busy.jsEquals(did))))
        }
      }
    }
    .modifier(WantActorsIfArchive(archive: archive, dids: dids))
  }

  private var form: some View {
    let canKeep = busy != "add" && !handle.jsTrimmed().isEmpty
    // Return in either field keeps, as the form's submit does.
    let keepField = FieldStack("Keep") {
      VirgaTextField("@handle", text: $handle)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .virgaField()
        .submitLabel(.go)
        .onSubmit { if canKeep { Task { await keep() } } }
        .accessibilityLabel("Keep")
    }
    let whyField = FieldStack("Why (optional)") {
      VirgaTextField("My sister’s other account", text: $reason)
        .virgaField()
        .submitLabel(.go)
        .onSubmit { if canKeep { Task { await keep() } } }
        .onChange(of: reason) { _, next in if next.utf16.count > 200 { reason = next.jsSlice(0, 200) } }
        .accessibilityLabel("Why (optional)")
    }
    // On a phone Keep spans the column (`.defense-keep-form { grid-template-columns: 1fr }`).
    let go = Button("Keep") { Task { await keep() } }
      .buttonStyle(.virga)
      .environment(\.virgaFillsWidth, theme.isPhone)
      .disabled(!canKeep)
    return Group {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: theme.space3) {
          keepField
          whyField
          go
        }
      } else {
        HStack(alignment: .bottom, spacing: theme.space3) {
          keepField.frame(width: Measure.Defense.keepColumn)
          whyField
          go
        }
      }
    }
    .frame(maxWidth: Measure.Defense.columnMax, alignment: .leading)
    .padding(.bottom, theme.space4)
  }

  private func keep() async {
    var text = handle.jsTrimmed()
    if text.utf16.first == 0x40 { text = text.jsSlice(1) }
    guard !text.isEmpty else { return }
    busy = "add"
    error = nil
    defer { busy = nil }
    do {
      let did: String?
      if text.utf16.starts(with: "did:".utf16) {
        did = text
      } else {
        did = await PublicAppView.resolveHandle(text, transport: transport)
      }
      guard let did else { throw DefensePageError(message: "Couldn’t find @\(text).") }
      let why = reason.jsTrimmed()
      _ = try await DefenseService.keepAccount(lists.requester, did, why.isEmpty ? nil : why)
      handle = ""
      reason = ""
      await lists.refresh()
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }

  private func unkeep(_ did: String) async {
    busy = did
    defer { busy = nil }
    do {
      _ = try await DefenseService.unkeepAccount(lists.requester, did)
      await lists.refresh()
    } catch {
      self.error = DefenseService.defenseErrorMessage(error)
    }
  }
}

/// `useWantActors(archive, dids)` where the page has an archive.
struct WantActorsIfArchive: ViewModifier {
  let archive: ArchiveModel?
  let dids: [String]

  @ViewBuilder
  func body(content: Content) -> some View {
    if let archive {
      content.wantActors(archive, dids)
    } else {
      content
    }
  }
}
#endif
