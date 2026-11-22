// Ports src/tools/Identity.jsx
// Ports src/tools/tools.css (.identity-card, .identity-main, .identity-name, .kv, .timeline)
//
// Who the account is on the protocol: its DID, the server that holds its
// repo, every handle and server it has had, and what is in the repo. The
// PDS comes from the DID's document and the history from the PLC
// directory's log, both read through the session's network (the made-up
// world's, in the demo); the repo's figures are the archive's.

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaArchive
import VirgaCore
import VirgaInsights
import VirgaNetwork

struct IdentityTool: View {
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    VirgaPage(header: ToolHeader.header(tool)) {
      if let archive {
        IdentityBody(archive: archive, profile: app.profile.profile, network: app.archiveEnvironment)
          .id(archive.did)
      }
    }
  }
}

/// One change in a PLC log: when, what kind, and what it was.
struct HistoryEvent: Hashable {
  var at: JSONValue
  var kind: String
  var text: String
}

enum IdentityModel {
  /// `historyEvents(log)`: what each operation changed from the one before,
  /// newest first.
  static func historyEvents(_ log: [PlcHistoryEntry]?) -> [HistoryEvent] {
    var events: [HistoryEvent] = []
    var prev: PlcHistoryEntry?
    for op in log ?? [] {
      if op.nullified { continue }
      let handle = op.handles.first.flatMap { $0.isEmpty ? nil : $0 }
      if let before = prev {
        if let handle, !before.handles.first.jsEquals(handle) {
          events.append(HistoryEvent(at: op.at, kind: "handle", text: "Handle changed to @\(handle)"))
        }
        if op.pds.isTruthy && !same(op.pds, before.pds) {
          events.append(HistoryEvent(at: op.at, kind: "pds", text: "Moved to \(hostOf(op.pds.jsString))"))
        }
        if op.type.stringValue.jsEquals("plc_tombstone") {
          events.append(HistoryEvent(at: op.at, kind: "tombstone", text: "Deactivated at the directory"))
        }
      } else {
        let named = handle.map { " as @\($0)" } ?? ""
        let on = op.pds.isTruthy ? " on \(hostOf(op.pds.jsString))" : ""
        events.append(HistoryEvent(at: op.at, kind: "created", text: "Created\(named)\(on)"))
      }
      prev = op
    }
    return events.reversed()
  }

  /// `a !== b` for two values from the log, strings by code unit.
  static func same(_ a: JSONValue, _ b: JSONValue) -> Bool {
    if let x = a.stringValue, let y = b.stringValue { return x.jsEquals(y) }
    return a == b
  }

  /// `new URL(url).host`, or the text itself when it isn't an address.
  static func hostOf(_ url: String) -> String {
    (try? WebURL(url).hostWithPort) ?? url
  }

  /// A time from the log as the short date.
  static func date(_ at: JSONValue?) -> String {
    switch at {
    case .string(let text)?: return Time.formatDateShort(text)
    case .number(let ms)?: return Time.formatDateShort(ms)
    default: return ""
    }
  }

  /// What the repo holds, as of the last sync.
  struct Repo {
    var records: Int
    var collections: Int
    var apps: Int
    var oldest: Double?
  }

  @MainActor
  static func repo(_ archive: ArchiveModel) -> Repo {
    var collections = Set<JSKey>()
    var apps = Set<JSKey>()
    var oldest = Double.infinity
    for row in archive.data.atmosphere {
      collections.insert(JSKey(row.collection))
      apps.insert(JSKey(row.collection.components(separatedBy: ".").prefix(2).joined(separator: ".")))
      if row.at < oldest { oldest = row.at }
    }
    return Repo(records: archive.data.atmosphere.count, collections: collections.count, apps: apps.count, oldest: oldest.isFinite ? oldest : nil)
  }
}

struct IdentityBody: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let archive: ArchiveModel
  let profile: AccountProfile?
  let network: ArchiveEnvironment

  /// The PDS: nil while it is looked up, "" when it couldn't be.
  @State private var pds: String?
  @State private var history: History = .reading

  enum History {
    case reading
    /// A did:web, or a directory that couldn't be read.
    case unread
    case log([PlcHistoryEntry])
  }

  var body: some View {
    let did = archive.did
    let events: [HistoryEvent] = { if case .log(let log) = history { return IdentityModel.historyEvents(log) } else { return [] } }()
    let first: JSONValue? = { if case .log(let log) = history { return log.first?.at } else { return nil } }()
    let created: JSONValue? = first.truthy ?? profile?.createdAt.map { JSONValue.string($0) }
    accountCard
    FiguresView(
      [
        FigureItem(key: "followers", label: "Followers", value: profile?.followersCount.map { .number(Double($0)) } ?? .text("—")),
        FigureItem(key: "following", label: "Following", value: profile?.followsCount.map { .number(Double($0)) } ?? .text("—")),
        FigureItem(key: "posts", label: "Posts", value: profile?.postsCount.map { .number(Double($0)) } ?? .text("—")),
        FigureItem(
          key: "created", label: "Account created", value: .text(Self.year(created) ?? "—"),
          note: created.map { AnyView(Text(IdentityModel.date($0))) }),
      ], label: "The account in figures")
    identifiers(did)
    ToolSplit(columnGap: theme.gridGapX, rowGap: theme.gridGap) {
      historySection(did, events)
      repoSection
    }
    // The server and the log land on their own, each as it arrives.
    .task(id: did) { await readPds(did) }
    .task(id: did) { await readHistory(did) }
  }

  private func readPds(_ did: String) async {
    let url: String? = try? await Atproto.resolvePds(did, transport: network.transport, clock: network.clock, cache: network.didDocuments)
    if Task.isCancelled { return }
    pds = url ?? ""
  }

  private func readHistory(_ did: String) async {
    let entries = await Atproto.getPlcHistory(did, transport: network.transport)
    if Task.isCancelled { return }
    history = entries.map { History.log($0) } ?? History.unread
  }

  /// `String(new Date(created).getFullYear())`.
  static func year(_ created: JSONValue?) -> String? {
    guard let created else { return nil }
    let zone = AppLocale.activeTimeZone()
    let ms: Double
    switch created {
    case .string(let text): ms = JSDate.parse(text, timeZone: zone)
    case .number(let n): ms = n
    default: return nil
    }
    return JSDate.fields(ms, timeZone: zone).map { "\($0.year)" } ?? "NaN"
  }

  private var accountCard: some View {
    HStack(alignment: .center, spacing: Measure.Tools.identityGap) {
      Avatar(src: profile?.avatar, name: profile?.displayName ?? profile?.handle, size: .large)
      VStack(alignment: .leading, spacing: 0) {
        Text(profile?.displayName ?? profile?.handle.map { "@\($0)" } ?? archive.did)
          .virgaText(
            .textLead, weight: VirgaWeight.semibold, lineHeight: Measure.Tools.identityNameLineHeight,
            tracking: Measure.Tools.identityNameTracking)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
        if let handle = profile?.handle {
          Text("@\(handle)").virgaText(.textBase).foregroundStyle(theme.muted)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("The account")
    .accessibilityValue(profile?.displayName ?? profile?.handle ?? archive.did)
  }

  private func identifiers(_ did: String) -> some View {
    let docUrl = did.utf16.starts(with: "did:plc:".utf16) ? "\(AppConfig.plcDirectory)/\(did)" : Atproto.didWebDocumentUrl(did)
    return VirgaSection(title: "Identifiers", flush: true) {
      KVList {
        KVRow("DID") {
          Text(did)
            .font(theme.codeFont(around: theme.textSm))
            .lineLimit(1)
            .truncationMode(.tail)
            .textSelection(.enabled)
          ToolCopyButton(text: did, label: "the DID")
        }
        KVRow("Handle") {
          if let handle = profile?.handle {
            Text("@\(handle)").lineLimit(1).truncationMode(.tail)
            ToolCopyButton(text: handle, label: "the handle")
          } else {
            Text("Not verified right now").foregroundStyle(theme.muted)
          }
        }
        KVRow("PDS") {
          if let pds, !pds.isEmpty {
            Text(pds).lineLimit(1).truncationMode(.tail)
            ToolCopyButton(text: pds, label: "the PDS address")
          } else {
            Text(pds == nil ? "Looking it up…" : "Couldn’t be resolved").foregroundStyle(theme.muted)
          }
        }
        KVRow("DID document") {
          if let docUrl, let url = URL(string: docUrl) {
            Link(destination: url) {
              HStack(spacing: Measure.Tools.linkGap) {
                Text(IdentityModel.hostOf(docUrl)).virgaText(.textBase, weight: VirgaWeight.medium).foregroundStyle(theme.ink)
                Image(systemName: Glyph.externalLink).font(.system(size: Measure.Tools.linkGlyph)).foregroundStyle(theme.muted)
              }
            }
          } else {
            Text("—")
          }
        }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("identity-identifiers")
  }

  private func historySection(_ did: String, _ events: [HistoryEvent]) -> some View {
    VirgaSection(title: "Handle and server history", sub: "From the PLC directory’s log of this DID", flush: true) {
      switch history {
      case .reading:
        ToolEmptyLine("Reading the log…")
      case .unread:
        ToolEmptyLine(did.utf16.starts(with: "did:web:".utf16) ? "A did:web keeps no history." : "The directory couldn’t be reached.")
      case .log:
        TimelineList(
          steps: events.enumerated().map { i, e in
            TimelineStep(id: i, date: e.at.isTruthy ? IdentityModel.date(e.at) : "—", text: e.text, first: e.kind == "created")
          })
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("identity-history")
  }

  private var repoSection: some View {
    let repo = IdentityModel.repo(archive)
    return VirgaSection(title: "The repo", sub: "As of the last sync", flush: true) {
      KVList {
        KVRow("Records", inline: true) { Text(AppLocale.formatNumber(repo.records)) }
        KVRow("Collections", inline: true) { Text(AppLocale.formatNumber(repo.collections)) }
        KVRow("Apps writing to it", inline: true) { Text(AppLocale.formatNumber(repo.apps)) }
        KVRow("Oldest record", inline: true) { Text(repo.oldest.map { Time.formatDateShort($0) } ?? "—") }
      }
      Button {
        navigate("/reports/atmosphere")
      } label: {
        Text("See every collection in the Atmosphere report")
          .virgaText(.textSm)
          .underline(true)
          .foregroundStyle(theme.ink)
      }
      .buttonStyle(.plain)
      .accessibilityAddTraits(.isLink)
      .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
    }
  }
}

/// `CopyButton`: copies `text`, and says so for a moment.
struct ToolCopyButton: View {
  let text: String
  let label: String
  @State private var done = false

  var body: some View {
    Button {
      UIPasteboard.general.string = text
      done = true
      Task {
        try? await Task.sleep(nanoseconds: UInt64(Measure.Tools.copiedFor * 1_000_000_000))
        done = false
      }
    } label: {
      Image(systemName: done ? Glyph.check : ToolGlyph.copy).font(.system(size: Measure.Tools.copyGlyph))
    }
    .buttonStyle(.virga(.ghost, size: .small, icon: true))
    .accessibilityLabel(done ? "Copied" : "Copy \(label)")
  }
}
#endif
