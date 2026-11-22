// Ports src/tools/ListsYoureOn.jsx
// Ports src/tools/tools.css (.lists-table, .lists-kind, .table--stack)
//
// Every list that includes you: moderation lists (whose subscribers block
// or mute everyone on them) flagged, with how many subscribe, and the
// curation lists that are simply someone's reading list. Three counts that
// are also the filter, as on Follow cleanup; then the lists as a table
// from 641 wide (the list, who made it, its kind, its subscribers, when
// you were added), and narrower as the web's phone sets it: the list's
// name (the way to it on Bluesky) with its kind at the right, and the rest
// as a meta line under it, a cell with nothing to say left out.

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
        .toolExporter($exporting)
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
      if theme.windowWidth > Measure.Tools.stackedTableMax {
        ListsTable(lists: shown, owner: { ToolPeople.cardFor(archive, $0.owner, sets: sets) })
      } else {
        ForEach(shown, id: \.uri) { list in
          ListsToolRow(list: list, owner: ToolPeople.cardFor(archive, list.owner, sets: sets))
        }
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
struct ListsToolRow: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let list: ListInfo
  let owner: ToolPersonCard?

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
/// The lists as a table, from 641 wide: the list (the way to it on
/// Bluesky), who made it (Unknown account, the DID to hand, where their
/// name hasn't been read), its kind, its subscribers (moderation lists
/// only), and when you were added.
struct ListsTable: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.openURL) private var openURL
  let lists: [ListInfo]
  let owner: (ListInfo) -> ToolPersonCard?

  var body: some View {
    let pad = theme.points(ThemeKit.tableCellPadding.left)
    Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
      GridRow {
        head("List", leading: 0, flexible: true)
        head("Made by", leading: pad)
        head("Kind", leading: pad)
        head("Subscribers", leading: pad, numeric: true)
        head("You were added", leading: pad, trailing: 0)
      }
      Rectangle().fill(theme.color(ThemeKit.tableHeadRule)).frame(height: 1).gridCellUnsizedAxes(.horizontal)
      ForEach(lists, id: \.uri) { list in
        line(list, pad: pad)
        Rectangle().fill(theme.color(ThemeKit.tableRowRule)).frame(height: 1).gridCellUnsizedAxes(.horizontal)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("lists-table")
  }

  private func head(_ text: String, leading: CGFloat, trailing: CGFloat? = nil, numeric: Bool = false, flexible: Bool = false) -> some View {
    let pad = theme.points(ThemeKit.tableCellPadding.left)
    return Text(text)
      .virgaText(.textSm, weight: ThemeKit.tableHeadWeight)
      .foregroundStyle(theme.muted)
      .lineLimit(1)
      .padding(.leading, leading)
      .padding(.trailing, trailing ?? pad)
      .padding(.bottom, theme.points(ThemeKit.tableHeadSpaceBelow))
      .frame(maxWidth: flexible ? .infinity : nil, alignment: numeric ? .trailing : .leading)
      .gridColumnAlignment(numeric ? .trailing : .leading)
  }

  @ViewBuilder
  private func line(_ list: ListInfo, pad: CGFloat) -> some View {
    let card = owner(list)
    let counted = list.purpose == "moderation" && list.subscribers != nil
    let moderation = list.purpose == "moderation"
    GridRow {
      Button {
        if let url = ListsYoureOnBody.listUrl(list, card?.handle) { openURL(url) }
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
      .padding(.trailing, pad)
      .padding(.vertical, theme.rowPad)
      .frame(maxWidth: .infinity, alignment: .leading)
      Group {
        if let handle = card?.handle, !handle.isEmpty {
          Text("@\(handle)").foregroundStyle(theme.ink)
        } else {
          Text("Unknown account").foregroundStyle(theme.muted)
            .help(list.owner)
            .accessibilityHint(list.owner)
        }
      }
      .virgaText(.textBase)
      .lineLimit(1)
      .padding(.horizontal, pad)
      Text(ListsYoureOnBody.kindWord[list.purpose] ?? list.purpose)
        .virgaText(.textBase, weight: moderation ? VirgaWeight.medium : VirgaWeight.regular)
        .foregroundStyle(moderation ? theme.ink2 : theme.muted)
        .padding(.horizontal, pad)
      Text(counted ? AppLocale.formatNumber(list.subscribers ?? 0) : "—")
        .virgaText(.textBase)
        .foregroundStyle(theme.ink)
        .padding(.horizontal, pad)
      Text(list.memberAt.flatMap { $0.isEmpty ? nil : Time.formatDateShort($0) } ?? "—")
        .virgaText(.textBase)
        .foregroundStyle(theme.ink)
        .lineLimit(1)
        .padding(.leading, pad)
    }
  }
}
#endif
