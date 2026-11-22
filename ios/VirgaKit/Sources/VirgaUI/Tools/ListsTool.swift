// Ports src/tools/ListsYoureOn.jsx
// Ports src/tools/tools.css (.lists-table, .lists-kind, .table--stack)
//
// Every list that includes you: moderation lists (whose subscribers block
// or mute everyone on them) flagged, with how many subscribe, and the
// curation lists that are simply someone's reading list. Three counts that
// are also the filter, as on Follow cleanup; then the lists, each set as
// the web's phone sets its table at every width: the list's name (the way
// to it on Bluesky) with its kind at the right, and the rest as a meta
// line under it, a cell with nothing to say left out.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

struct ListsTool: View {
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  let tool: ToolEntry

  var body: some View {
    VirgaPage(header: ToolHeader.header(tool)) {
      if let archive {
        ListsYoureOnBody(archive: archive)
          .id(archive.did)
      }
    }
  }
}

struct ListsYoureOnBody: View {
  @Environment(\.virgaTheme) private var theme
  let archive: ArchiveModel
  @State private var filter = "all"
  @State private var exporting: ExportFile?

  /// `KIND_WORD`: a list's kind, as a word.
  static let kindWord = ["moderation": "Moderation", "curation": "Curation", "reference": "Reference"]

  /// `listUrl(list, ownerHandle)`.
  static func listUrl(_ list: ListInfo, _ ownerHandle: String?) -> URL? {
    let rkey = list.uri.components(separatedBy: "/").last ?? ""
    let owner = ownerHandle.flatMap { $0.isEmpty ? nil : $0 } ?? list.owner
    return URL(string: "https://bsky.app/profile/\(JSURI.encodeURIComponent(owner))/lists/\(JSURI.encodeURIComponent(rkey))")
  }

  var body: some View {
    let report = ReportArchive(archive)
    let read = archive.data.meta.lists != nil
    let lists = read ? ReportModels.listsModel(report) : []
    if !read {
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.emptyBlockGap)) {
        EmptyState("Lists are read at the next sync, along with blocks.")
        Button {
          let mode: SyncMode = archive.data.meta.posts?.complete == true ? .incremental : .resume
          Task { await archive.runSync(mode) }
        } label: {
          Label(archive.sync != nil ? "Syncing…" : "Sync now", systemImage: Glyph.refresh)
        }
        .buttonStyle(.virga)
        .disabled(archive.sync != nil)
      }
    } else if lists.isEmpty {
      EmptyState("No lists here.")
    } else {
      content(lists, sets: ReportModels.relationSets(report))
        .wantActors(archive, lists.map(\.owner))
        .exportSheet($exporting)
    }
  }

  @ViewBuilder
  private func content(_ lists: [ListInfo], sets: RelationSets) -> some View {
    let mod = lists.filter { $0.purpose == "moderation" }
    let shown =
      filter == "all" ? lists : lists.filter { filter == "moderation" ? $0.purpose == "moderation" : $0.purpose != "moderation" }
    let subs = mod.reduce(0) { $0 + ($1.subscribers ?? 0) }
    let fmt = { (n: Int) in AppLocale.formatNumber(n) }
    FilterCards(
      label: "Which lists",
      choices: [
        FilterChoice(key: "all", label: "Every list", count: lists.count, hint: nil),
        FilterChoice(
          key: "moderation", label: "Moderation lists", count: mod.count,
          hint: mod.isEmpty
            ? "Their subscribers block or mute you"
            : "Their \(fmt(subs)) \(subs == 1 ? "subscriber blocks or mutes" : "subscribers block or mute") you"),
        FilterChoice(key: "curation", label: "Curation lists", count: lists.count - mod.count, hint: "Reading lists, feeds and starter packs"),
      ],
      selection: filter
    ) { filter = $0 }
    VirgaSection(
      title: "\(fmt(shown.count)) \(shown.count == 1 ? "list" : "lists")",
      trailing: AnyView(
        Button {
          exporting = archive.exportRows("lists", exportRows(lists, sets: sets))
        } label: {
          Label("Export", systemImage: Glyph.download)
        }
        .buttonStyle(.linkAction)),
      flush: true,
      caption:
        "Found through Constellation, which indexes who links to whom across the network, then each list read from Bluesky’s public API. Subscribers are counted for moderation lists only, where they decide who blocks you. A list removed since the last sync is gone from here at the next one."
    ) {
      ForEach(shown, id: \.uri) { list in
        ListRowView(list: list, owner: ToolPeople.cardFor(archive, list.owner, sets: sets))
      }
      if shown.isEmpty {
        EmptyState("No lists here.").padding(.top, theme.rowPad)
      }
    }
  }

  private func exportRows(_ lists: [ListInfo], sets: RelationSets) -> [[JSONValue?]] {
    var rows: [[JSONValue?]] = [ToolExport.row(["uri", "name", "purpose", "owner", "owner_handle", "subscribers", "added_at"])]
    for l in lists {
      rows.append([
        .string(l.uri), .string(l.name), .string(l.purpose), .string(l.owner),
        .string(ToolPeople.cardFor(archive, l.owner, sets: sets)?.handle ?? ""),
        l.subscribers.map { .number(Double($0)) } ?? .string(""), .string(l.memberAt ?? ""),
      ])
    }
    return rows
  }
}

/// One list, as the web's phone sets a row of its table.
struct ListRowView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let list: ListInfo
  let owner: PersonCard?

  var body: some View {
    let counted = list.purpose == "moderation" && list.subscribers != nil
    var facts: [String] = []
    if let handle = owner?.handle { facts.append("by @\(handle)") }
    if counted, let n = list.subscribers { facts.append("\(AppLocale.formatNumber(n)) \(n == 1 ? "subscriber" : "subscribers")") }
    if let at = list.memberAt, !at.isEmpty { facts.append("added \(Time.formatDateShort(at))") }
    let moderation = list.purpose == "moderation"
    return VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: theme.space3) {
        Button {
          if let url = ListsYoureOnBody.listUrl(list, owner?.handle) { openURL(url) }
        } label: {
          HStack(alignment: .firstTextBaseline, spacing: Measure.Tools.linkGap) {
            Text(list.name.isEmpty ? "Untitled list" : list.name)
              .virgaText(.textBase, weight: VirgaWeight.medium)
              .foregroundStyle(theme.ink)
              .multilineTextAlignment(.leading)
            Image(systemName: Glyph.externalLink)
              .font(.system(size: Measure.Tools.linkGlyph))
              .foregroundStyle(theme.muted)
              .accessibilityHidden(true)
          }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
        .frame(maxWidth: .infinity, alignment: .leading)
        Text(ListsYoureOnBody.kindWord[list.purpose] ?? list.purpose)
          .virgaText(.textSm, weight: moderation ? VirgaWeight.medium : VirgaWeight.regular)
          .foregroundStyle(moderation ? theme.ink2 : theme.muted)
      }
      if !facts.isEmpty {
        MetaLine(facts)
      }
    }
    .padding(.vertical, theme.rowPad)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }
}
#endif
