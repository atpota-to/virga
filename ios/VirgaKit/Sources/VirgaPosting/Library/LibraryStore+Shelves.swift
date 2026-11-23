// Ports src/posting/library/store.js
//
// The shelf items built from what the store holds: where Your posts come
// from, each shelf's items, the Templates shelf in sections, and the query
// remote search runs for. Pure.

import Foundation
import VirgaCore
import VirgaNetwork

extension LibraryStore {
  /// Whether Your posts and Your replies read the archive (`"archive"`),
  /// the public author feed (`"feed"`, the archive being empty), or neither
  /// yet (nil, the archive still loading).
  public nonisolated static func postsSource(_ archiveEntry: LibraryEntry?) -> String? {
    if archiveEntry?.status == "ready" { return archiveEntry?.data?.items.isEmpty == false ? "archive" : "feed" }
    if archiveEntry?.status == "error" { return "feed" }
    return nil
  }

  /// The items on a shelf from its store entries. Your posts and Your
  /// replies take the archive's entry (`archive`) and their author-feed
  /// entry (`entry`); the rest their own entry. `sort` ('date' or
  /// 'engagement') is for posts and replies, `query` searches the
  /// archive's rows, `limit` is how many archive rows to show.
  public nonisolated static func buildShelfItems(
    _ shelfId: String, entry: LibraryEntry?, archive: LibraryEntry? = nil, did: String? = nil,
    sort: String = "date", query: String = "", limit: Double = 50, clock: LibraryClock = LibraryClock()
  ) -> ShelfItems {
    if shelfId == "posts" || shelfId == "replies" {
      let replies = shelfId == "replies"
      if postsSource(archive) == "archive" {
        return LibrarySources.archiveShelf(
          archive?.data?.items, did: did, replies: replies, sort: sort, query: query, limit: limit, clock: clock)
      }
      let views = entry?.data?.items ?? []
      let items = views.map { Library.itemFromPost($0, shelf: shelfId, selfDid: did, clock: clock) }
      return ShelfItems(
        items: sort == "engagement" ? Library.sortItems(items, by: "engagement", timeZone: clock.timeZone) : items,
        total: nil)
    }
    guard let data = entry?.data else { return ShelfItems(items: [], total: nil) }
    let views = data.items
    switch shelfId {
    case "saved":
      return ShelfItems(items: views.map { Library.itemFromPost($0, shelf: "saved", selfDid: did, clock: clock) }, total: nil)
    case "links":
      return ShelfItems(items: views.map { Library.itemFromLink($0) }, total: nil)
    case "feeds":
      let own = Library.dedupeById(views.map { Library.itemFromFeed($0, group: "yours") })
      let saved = Library.dedupeById(
        (data.saved ?? []).map { Library.itemFromFeed($0, group: "saved") }, Set(own.map { JSKey($0.id) }))
      return ShelfItems(items: own + saved, total: nil)
    case "lists":
      return ShelfItems(items: views.map { Library.itemFromList($0) }, total: nil)
    default:
      return ShelfItems(items: [], total: nil)
    }
  }

  /// The Templates shelf: every template as an item (offered here first,
  /// then the rest), and the same items in sections under their group
  /// headings, with the templates not offered here in a muted section of
  /// their own.
  public struct TemplateShelf: Hashable, Sendable {
    public var items: [LibraryItem]
    public var sections: [LibrarySection]
  }

  /// templateShelf over the account's templates and readTemplateUsage's counts.
  public nonisolated static func templateShelf(
    _ templates: [PostTemplate]?, usage: TemplateUsageCounts? = nil, context: TemplateContext? = nil,
    embeds: LibraryEmbedViews? = nil, replying: Bool = false
  ) -> TemplateShelf {
    shelf(
      TemplateUsage.sortTemplatesForShelf(templates, usage), json: { $0.json }, context: context, embeds: embeds,
      replying: replying)
  }

  /// templateShelf over templates and usage as the web's objects.
  @_disfavoredOverload
  public nonisolated static func templateShelf(
    _ templates: [JSONValue]?, usage: JSONValue? = nil, context: TemplateContext? = nil,
    embeds: LibraryEmbedViews? = nil, replying: Bool = false
  ) -> TemplateShelf {
    shelf(
      TemplateUsage.sortTemplatesForShelf(templates, usage), json: { $0 }, context: context, embeds: embeds,
      replying: replying)
  }

  /// `String(template?.group || '').trim()`.
  nonisolated static func groupOf(_ template: JSONValue?) -> String {
    TemplateJS.orEmpty(template?["group"]).jsTrimmed()
  }

  nonisolated static func templateEmbedUri(_ template: JSONValue) -> String? {
    let embed = template["embed"]
    guard Library.isString(embed?["$type"], recordEmbed) else { return nil }
    return embed?["record"]?["uri"]?.stringValue
  }

  nonisolated static func shelf<T: TemplateFields>(
    _ sorted: [T], json: (T) -> JSONValue, context: TemplateContext?, embeds: LibraryEmbedViews?, replying: Bool
  ) -> TemplateShelf {
    var offered: [LibraryItem] = []
    var rest: [LibraryItem] = []
    for t in sorted {
      let value = json(t)
      let embedView = templateEmbedUri(value).flatMap { embeds?[$0] }
      let item = Library.itemFromTemplate(value, context, embedView: embedView)
      if PostTemplates.templateOffered(t, replying: replying) { offered.append(item) } else { rest.append(item) }
    }

    var sections: [LibrarySection] = []
    let anyGroup = offered.contains { !groupOf($0.source).isEmpty }
    var lastGroup: String?
    for item in offered {
      let group = groupOf(item.source)
      if !sections.isEmpty, let last = lastGroup, group.jsEquals(last) {
        sections[sections.count - 1].items.append(item)
        continue
      }
      lastGroup = group
      // Ungrouped templates sort last; with groups above them they need a
      // heading of their own, or they read as part of the last group. With
      // the other kind's templates set apart under theirs, these say what
      // they are for, so both lists are named alike.
      let heading: String? =
        !group.isEmpty
        ? group
        : anyGroup ? "Other templates" : !rest.isEmpty ? (replying ? "For replies" : "For new posts") : nil
      sections.append(
        LibrarySection(id: group.isEmpty ? "ungrouped" : "group:\(group)", heading: heading, muted: false, items: [item]))
    }
    if !rest.isEmpty {
      sections.append(
        LibrarySection(id: "elsewhere", heading: replying ? "For new posts" : "For replies", muted: true, items: rest))
    }
    return TemplateShelf(items: offered + rest, sections: sections)
  }

  /// The query remote search runs for, or '' when it shouldn't run (too
  /// short, or a "/shortcut").
  public nonisolated static func remoteQueryFor(_ query: String?, minChars: Int = 2) -> String {
    let q = (query ?? "").jsTrimmed()
    return q.utf16.count >= minChars && q.utf16.first != 0x2F ? q : ""
  }
}
