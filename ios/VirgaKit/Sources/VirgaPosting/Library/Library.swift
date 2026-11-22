// Ports src/posting/library/model.js
//
// The embed library's model: the items on each shelf, suggestions for a
// reply, local search, what using an item would do to the post (preview) and
// what the composer should then do (plan), "/shortcut" detection, and
// inserting text at the caret.
//
// Pure: no network, no storage. The reads behind the shelves are
// LibrarySources; the template rules PostTemplates, and the template
// editor's drafts EditorDrafts (which the web re-exports from here).
//
// This file: the shelves, posts' titles and pictures, and making items.
// Library+Suggest.swift has suggestions and search, Library+Preview.swift
// verbs, effects, the preview, plans, insertion and slash shortcuts.
//
// Where the web reads a member that should be a string but is another type,
// the port reads its String form (a number `uri` becomes "5"); where the web
// would throw a TypeError on such a shape, the port reads it the same way.
// Lexicon-valid views never hit either.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

public enum Library {
  /// The library's name in the UI, kept in one place because the word may change.
  public static let libraryName = "Library"

  public static let libraryShelves: [LibraryShelf] = [
    LibraryShelf(id: "suggested", label: "For this reply"),
    LibraryShelf(id: "templates", label: "Templates"),
    LibraryShelf(id: "posts", label: "Your posts"),
    LibraryShelf(id: "replies", label: "Your replies"),
    LibraryShelf(id: "saved", label: "Saved"),
    LibraryShelf(id: "links", label: "Links"),
    LibraryShelf(id: "feeds", label: "Feeds"),
    LibraryShelf(id: "lists", label: "Lists"),
    LibraryShelf(id: "search", label: "Search"),
  ]

  /// The shelves to show: "For this reply" only while replying.
  public static func shelvesFor(replying: Bool = false) -> [LibraryShelf] {
    replying ? libraryShelves : libraryShelves.filter { $0.id != "suggested" }
  }

  /// The shelf the library opens on.
  public static func openingShelf(replying: Bool = false) -> String {
    replying ? "suggested" : "templates"
  }

  static let feedCollection = "app.bsky.feed.generator"
  static let listCollection = "app.bsky.graph.list"
  static let recordEmbed = "app.bsky.embed.record"
  static let externalEmbed = "app.bsky.embed.external"
  static let imagesEmbed = "app.bsky.embed.images"
  static let videoEmbed = "app.bsky.embed.video"
  static let recordWithMedia = "app.bsky.embed.recordWithMedia"
  static let curateList = "app.bsky.graph.defs#curatelist"
  static let modList = "app.bsky.graph.defs#modlist"

  /// What a template's hydrated quote is when the AppView says it's gone.
  public static let missing = "missing"
  static var missingValue: JSONValue { .string(missing) }

  // MARK: - Small pieces of the web's

  /// `typeof v === 'string' ? v : ''`.
  static func str(_ value: JSONValue?) -> String { TemplateJS.str(value) }

  /// `str(v).replace(/\s+/g, ' ').trim()`.
  static func oneLine(_ value: JSONValue?) -> String { oneLine(str(value)) }

  static func oneLine(_ text: String) -> String {
    var out: [UInt16] = []
    var inSpace = false
    for unit in text.utf16 {
      if PostingJS.isSpace(unit) {
        if !inSpace { out.append(0x20) }
        inSpace = true
      } else {
        out.append(unit)
        inSpace = false
      }
    }
    return String(jsUnits: out).jsTrimmed()
  }

  /// `“word”`.
  static func quoted(_ word: String) -> String { "\u{201C}\(word)\u{201D}" }

  /// `s.charAt(0).toUpperCase() + s.slice(1)`.
  static func capitalise(_ s: String) -> String { PostTemplates.capitalise(s) }

  /// A truthy value's text (itself, or its String form), else nil: `v || null`.
  static func text(_ value: JSONValue?) -> String? { TemplateJS.text(value) }

  /// `v === literal` for a member read from JSON.
  static func isString(_ value: JSONValue?, _ literal: String) -> Bool {
    value?.stringValue?.jsEquals(literal) ?? false
  }

  /// `v === s` for two strings that may be absent (undefined).
  static func same(_ value: JSONValue?, _ other: String?) -> Bool {
    guard let other else { return value == nil }
    return isString(value, other)
  }

  /// The collection of an at:// URI: `/^at:\/\/[^/]+\/([^/]+)\/[^/?#]+$/`.
  static func collectionOf(_ uri: JSONValue?) -> String? {
    AtUri.collection(of: str(uri))
  }

  /// `/^at:\/\/([^/]+)\//.exec(str(uri))?.[1] || null`.
  static func didOf(_ uri: JSONValue?) -> String? {
    AtUri.authority(of: str(uri))
  }

  /// `"and"`-joined: “a”, “b” and “c”.
  static func joinAnd(_ words: [String]) -> String {
    if words.count <= 1 { return words.joined() }
    return "\(words.dropLast().joined(separator: ", ")) and \(words[words.count - 1])"
  }

  /// `new URL(url)`'s hostname without a leading "www.", or '' when it
  /// isn't a URL.
  static func hostOf(_ url: JSONValue?) -> String {
    guard let parsed = parseURL(url) else { return "" }
    return withoutWWW(parsed.hostname)
  }

  /// "host/path" without the scheme, the query or a trailing slash; the
  /// text itself when it isn't a URL.
  static func hostAndPath(_ url: JSONValue?) -> String {
    guard let parsed = parseURL(url) else { return str(url) }
    var path = Array(parsed.pathname.utf16)
    while path.last == 0x2F { path.removeLast() }
    return withoutWWW(parsed.hostname) + String(jsUnits: path)
  }

  /// `new URL(value)`, with `String(value)` as JavaScript reads a non-string.
  static func parseURL(_ value: JSONValue?) -> WHATWGURL? {
    let input = value.map { $0.stringValue ?? $0.jsString } ?? "undefined"
    return WHATWGURL.parse(input)
  }

  static func withoutWWW(_ host: String) -> String {
    host.utf16.starts(with: "www.".utf16) ? String(jsUnits: Array(host.utf16.dropFirst(4))) : host
  }

  /// "Sep 2", or "Sep 2, 2020" for a year other than now's; '' for no date.
  static func shortDate(_ iso: String?, _ clock: LibraryClock) -> String {
    let ms = JSDate.parse(iso ?? "", timeZone: clock.zone)
    guard ms.isFinite else { return "" }
    var options = DateFormatOptions(month: "short", day: "numeric")
    // An older post needs its year, or "Sep 2" reads as this September.
    if JSDate.fields(ms, timeZone: clock.zone)?.year != JSDate.fields(clock.nowMs, timeZone: clock.zone)?.year {
      options.year = "numeric"
    }
    return AppLocale.toLocaleDateString(ms, options, locale: clock.locale, timeZone: clock.zone)
  }

  /// The first non-empty line (trimmed), and the rest as one line.
  static func splitFirstLine(_ value: JSONValue?) -> (first: String, rest: String) {
    let lines = TemplateJS.split(str(value), on: 0x0A).map { $0.jsTrimmed() }
    guard let first = lines.firstIndex(where: { !$0.isEmpty }) else { return ("", "") }
    return (lines[first], oneLine(lines[(first + 1)...].joined(separator: " ")))
  }

  /// `str(v).replace(/#view$/, '')`.
  static func withoutView(_ value: JSONValue?) -> String {
    let text = str(value)
    let suffix = Array("#view".utf16)
    let units = Array(text.utf16)
    guard units.count >= suffix.count, Array(units[(units.count - suffix.count)...]) == suffix else { return text }
    return String(jsUnits: units[..<(units.count - suffix.count)])
  }

  // What a post with no text shows instead, by what it carries.
  static func embedLabel(_ post: JSONValue?) -> String {
    let embed = post?["record"]?["embed"]?.truthy
    let type = str(embed?["$type"]).isEmpty ? withoutView(post?["embed"]?["$type"]) : str(embed?["$type"])
    if type == imagesEmbed { return "Image" }
    if type == videoEmbed { return "Video" }
    if type == externalEmbed { return "Link" }
    if type == recordWithMedia {
      let own = str(embed?["media"]?["$type"])
      let media = own.isEmpty ? withoutView(post?["embed"]?["media"]?["$type"]) : own
      if media == videoEmbed { return "Video" }
      if media == imagesEmbed { return "Image" }
      return "Quote"
    }
    if type == recordEmbed {
      let collection = collectionOf(embed?["record"]?["uri"].truthy ?? post?["embed"]?["record"]?["uri"])
      if collection == feedCollection { return "Feed" }
      if collection == listCollection { return "List" }
      return "Quote"
    }
    if post?["hasMedia"]?.isTruthy == true { return "Image" }
    return "Post"
  }

  // Alt texts in image order, the empty ones left out.
  static func altsOf(_ images: [JSONValue]) -> String {
    images.map { oneLine($0["alt"]) }.filter { !$0.isEmpty }.joined(separator: " · ")
  }

  /// The pictures a post carries: the first one's thumbnail and every alt
  /// text. The thumbnail comes from the hydrated view only; a post read as a
  /// bare record still has its alt text. Nil when it carries none.
  public static func postMedia(_ post: JSONValue?) -> LibraryMedia? {
    var view = post?["embed"]?.truthy
    if isString(view?["$type"], "\(recordWithMedia)#view") { view = view?["media"]?.truthy }
    var record = post?["record"]?["embed"]?.truthy
    if isString(record?["$type"], recordWithMedia) { record = record?["media"]?.truthy }
    if isString(view?["$type"], "\(imagesEmbed)#view"), let images = view?["images"]?.arrayValue, !images.isEmpty {
      let thumb = str(images[0]["thumb"])
      return LibraryMedia(thumb: thumb.isEmpty ? nil : thumb, alt: altsOf(images))
    }
    if isString(view?["$type"], "\(videoEmbed)#view") {
      let thumb = str(view?["thumbnail"])
      return LibraryMedia(thumb: thumb.isEmpty ? nil : thumb, alt: oneLine(view?["alt"]))
    }
    if isString(record?["$type"], imagesEmbed), let images = record?["images"]?.arrayValue, !images.isEmpty {
      return LibraryMedia(thumb: nil, alt: altsOf(images))
    }
    if isString(record?["$type"], videoEmbed) { return LibraryMedia(thumb: nil, alt: oneLine(record?["alt"])) }
    return nil
  }

  /// A post's title: its first line, or what it carries when it has no text.
  static func postTitle(_ post: JSONValue?) -> String {
    let first = splitFirstLine(post?["record"]?["text"]).first
    return first.isEmpty ? embedLabel(post) : first
  }

  static func isRecordKind(_ kind: String?) -> Bool { kind == "post" || kind == "feed" || kind == "list" }

  /// `embedView && typeof embedView === 'object' ? embedView : null`.
  static func viewOf(_ embedView: JSONValue?) -> JSONValue? {
    switch embedView {
    case .object?, .array?: return embedView
    default: return nil
    }
  }

  static func isOwnHandle(_ handle: JSONValue?, _ context: TemplateContext?) -> Bool {
    guard let handle, handle.isTruthy, let mine = context?.my?.handle, !mine.isEmpty else { return false }
    return isString(handle, mine)
  }

  /// `Number.isFinite(n) ? n : 0`.
  static func finite(_ value: JSONValue?) -> Double {
    guard case .number(let n)? = value, n.isFinite else { return 0 }
    return n
  }

  static func finite(_ value: Double?) -> Double {
    guard let value, value.isFinite else { return 0 }
    return value
  }

  /// `a ?? b` for members read from JSON.
  static func coalesce(_ a: JSONValue?, _ b: JSONValue?) -> JSONValue? {
    a.nonNull ?? b
  }

  /// A post's likes, reposts, replies and quotes, from a view or an archive row.
  public static func engagementScore(_ post: JSONValue?) -> Double {
    guard let post, post.isTruthy else { return 0 }
    let counts = [
      coalesce(post["likeCount"], post["likes"]),
      coalesce(post["repostCount"], post["reposts"]),
      coalesce(post["replyCount"], post["replies"]),
      coalesce(post["quoteCount"], post["quotes"]),
    ]
    return counts.reduce(0) { $0 + finite($1) }
  }

  /// Whether a post belongs to its author's own thread: a standalone post, a
  /// thread start, or a self-reply. A reply counts only when both the root
  /// and the parent are the author's; answering someone else's comment
  /// inside your own thread is a reply to them.
  public static func isOwnThreadPost(_ post: JSONValue?) -> Bool {
    let reply = post?["record"]?["reply"]
    guard let rootUri = reply?["root"]?["uri"], rootUri.isTruthy else { return true }
    guard let did = text(post?["author"]?["did"]) ?? didOf(post?["uri"]), !did.isEmpty else { return false }
    let parentUri = reply?["parent"]?["uri"]?.truthy ?? rootUri
    let prefix = "at://\(did)/"
    return TemplateJS.startsWith(rootUri.stringValue ?? rootUri.jsString, prefix)
      && TemplateJS.startsWith(parentUri.stringValue ?? parentUri.jsString, prefix)
  }

  // MARK: - Items

  static func templateLabel(_ template: JSONValue?, _ context: TemplateContext?, _ embedView: JSONValue?) -> String {
    let asks = PostTemplates.templateQuestions(template ?? .null, context).count
    if asks == 1 { return "Template · asks a question" }
    if asks > 1 { return "Template · asks \(asks) questions" }
    if isString(embedView, missing) { return "Template" }
    switch EditorDrafts.templateEmbedKind(template?["embed"]) {
    case "post": return "Template · quotes a post"
    case "feed": return "Template · attaches a feed"
    case "list": return "Template · attaches a list"
    case "link": return "Template · attaches a link"
    default: return "Template"
    }
  }

  /// A template as an item. `context` is buildTemplateContext's result;
  /// `embedView` the hydrated view of what it quotes, or "missing".
  public static func itemFromTemplate(
    _ template: JSONValue?, _ context: TemplateContext?, embedView: JSONValue? = nil
  ) -> LibraryItem {
    let t = template ?? .null
    let parts = PostTemplates.templatePreviewParts(t, [String: String](), context)
    let excerpt = oneLine(parts.map { $0.kind == "blank" ? "…" : $0.text }.joined())
    let shortcut = PostTemplates.normalizeShortcut(template?["shortcut"])
    var title = oneLine(template?["name"])
    if title.isEmpty { title = splitFirstLine(template?["text"]).first }
    if title.isEmpty { title = "Untitled template" }
    return LibraryItem(
      id: "template:\(text(template?["rkey"]) ?? "")", kind: "template", shelf: "templates", title: title,
      excerpt: excerpt, label: templateLabel(template, context, embedView),
      shortcut: shortcut.isEmpty ? "" : "/\(shortcut)", source: template, embedView: embedView,
      template: template, at: text(template?["updatedAt"]) ?? text(template?["createdAt"]))
  }

  /// A normalized template as an item.
  public static func itemFromTemplate(
    _ template: PostTemplate, _ context: TemplateContext?, embedView: JSONValue? = nil
  ) -> LibraryItem {
    itemFromTemplate(template.json, context, embedView: embedView)
  }

  // Short enough that the closing quote survives a one-line row.
  static let parentLineGraphemes = 60

  /// `line` cut to `max` graphemes at a word break, with an ellipsis when cut.
  static func clipAtWord(_ line: String, _ max: Int) -> String {
    let short = Graphemes.truncateGraphemes(line, max)
    if short.jsEquals(line) { return line }
    let units = Array(short.utf16)
    let space = short.jsLastIndexOf(" ")
    let cut = Double(space) > Double(units.count) / 2 ? Array(units[..<space]) : units
    var end = cut.count
    while end > 0, PostingJS.isSpace(cut[end - 1]) || [0x2C, 0x2E, 0x3B, 0x3A, 0x21, 0x3F].contains(cut[end - 1]) {
      end -= 1
    }
    return String(jsUnits: cut[..<end]) + "…"
  }

  static func isReplyPost(_ view: JSONValue?, _ shelf: String) -> Bool {
    if shelf == "replies" { return true }
    if shelf == "posts" { return false }
    return view?["record"]?["reply"]?.isTruthy == true && !isOwnThreadPost(view)
  }

  /// A post view (or a bare `{ uri, cid, record, author }`) as an item.
  /// `shelf` is 'posts' | 'replies' | 'saved' | 'suggested' | 'search';
  /// `selfDid` the account the library is for; `parentView` the post a
  /// reply answers. The label's date is written on `clock`.
  public static func itemFromPost(
    _ view: JSONValue?, shelf: String = "posts", selfDid: String? = nil, parentView: JSONValue? = nil,
    clock: LibraryClock = LibraryClock()
  ) -> LibraryItem {
    let (first, rest) = splitFirstLine(view?["record"]?["text"])
    let at = text(view?["record"]?["createdAt"]) ?? text(view?["indexedAt"])
    let date = shortDate(at, clock)
    let authorDid = view?["author"]?["did"]?.truthy ?? didOf(view?["uri"]).map(JSONValue.string)
    let mine = (selfDid?.isEmpty == false) && isString(authorDid, selfDid!)
    let head: String
    if mine {
      head = isReplyPost(view, shelf) ? "Your reply" : "Your post"
    } else if let handle = text(view?["author"]?["handle"]) {
      head = "Post by @\(handle)"
    } else {
      head = "Post"
    }
    var excerpt = rest
    if let handle = text(parentView?["author"]?["handle"]) {
      let line = splitFirstLine(parentView?["record"]?["text"]).first
      let shown = clipAtWord(line, parentLineGraphemes)
      excerpt = shown.isEmpty ? "Replying to @\(handle)" : "Replying to @\(handle): \(quoted(shown))"
    }
    let hydrated = view?["cid"]?.isTruthy == true
    // Only a signed-in read carries viewer state; a public one says nothing
    // here, and LibrarySources.hydratePick asks the post's postgate instead.
    let quotesOff = !mine && view?["viewer"]?["embeddingDisabled"]?.boolValue == true
    let item = LibraryItem(
      id: "post:\(text(view?["uri"]) ?? "")", kind: "post", shelf: shelf, title: first.isEmpty ? embedLabel(view) : first,
      excerpt: excerpt, label: date.isEmpty ? head : "\(head) · \(date)", source: view, media: postMedia(view),
      uri: text(view?["uri"]), cid: text(view?["cid"]), view: hydrated ? view : .null, at: at,
      score: engagementScore(view))
    return quotesOff ? markQuotesOff(item) : item
  }

  /// A post item marked as one its author doesn't allow quotes of: listed
  /// with a word saying so, and previewFor blocks attaching it.
  public static func markQuotesOff(_ item: LibraryItem) -> LibraryItem {
    if item.quotesOff == true { return item }
    var out = item.labelled(item.label.isEmpty ? "Quotes off" : "\(item.label) · quotes off")
    out.quotesOff = true
    return out
  }

  /// A post from the archive (VirgaArchive's compact row, `{ uri, at, text,
  /// replyTo, hasMedia, likes, reposts, replies, quotes }`). The row keeps
  /// the start of the text and no cid; LibrarySources.hydratePick reads the
  /// post itself before it is attached.
  public static func itemFromArchiveRow(
    _ row: JSONValue?, shelf: String? = nil, selfDid: String? = nil, clock: LibraryClock = LibraryClock()
  ) -> LibraryItem {
    let ownThread = isOwnThreadRow(row, selfDid)
    var source: [String: JSONValue] = [
      "uri": text(row?["uri"]).map(JSONValue.string) ?? .null,
      "cid": .null,
      "author": ["did": didOf(row?["uri"]).map(JSONValue.string) ?? .null],
      "record": ["text": .string(str(row?["text"])), "createdAt": row?["at"]?.truthy ?? .null],
      "hasMedia": .bool(row?["hasMedia"]?.isTruthy == true),
    ]
    source["likeCount"] = row?["likes"]
    source["repostCount"] = row?["reposts"]
    source["replyCount"] = row?["replies"]
    source["quoteCount"] = row?["quotes"]
    let chosen = (shelf?.isEmpty == false) ? shelf! : (ownThread ? "posts" : "replies")
    var item = itemFromPost(.object(source), shelf: chosen, selfDid: selfDid, clock: clock)
    item.media = row?["hasMedia"]?.isTruthy == true ? LibraryMedia(thumb: nil, alt: "") : nil
    return item
  }

  /// An archive row as an item, from the archive's typed row.
  public static func itemFromArchiveRow(
    _ row: PostRow, shelf: String? = nil, selfDid: String? = nil, clock: LibraryClock = LibraryClock()
  ) -> LibraryItem {
    itemFromArchiveRow(row.json, shelf: shelf, selfDid: selfDid, clock: clock)
  }

  /// Whether an archive row belongs on Your posts (else Your replies).
  public static func isOwnThreadRow(_ row: JSONValue?, _ selfDid: String?) -> Bool {
    guard let replyTo = row?["replyTo"], replyTo.isTruthy else { return true }
    return same(replyTo, selfDid)
  }

  /// isOwnThreadRow for the archive's typed row.
  public static func isOwnThreadRow(_ row: PostRow?, _ selfDid: String?) -> Bool {
    guard let replyTo = row?.replyTo, !replyTo.isEmpty else { return true }
    return selfDid.map { replyTo.jsEquals($0) } ?? false
  }

  /// A link `{ url, title, description, image, postUri, createdAt }` as an item.
  public static func itemFromLink(_ link: JSONValue?) -> LibraryItem {
    let host = hostOf(link?["url"])
    var title = oneLine(link?["title"])
    if title.isEmpty { title = str(link?["url"]) }
    return LibraryItem(
      id: "link:\(text(link?["url"]) ?? "")", kind: "link", shelf: "links", title: title,
      excerpt: hostAndPath(link?["url"]), label: host.isEmpty ? "Link" : "Link · \(host)", source: link,
      url: text(link?["url"]), at: text(link?["createdAt"]))
  }

  /// A feed generator view as an item; `group` is 'yours' | 'saved' | 'search'.
  public static func itemFromFeed(_ view: JSONValue?, group: String = "yours") -> LibraryItem {
    let label: String
    if group == "yours" {
      label = "Feed · yours"
    } else if group == "saved" {
      label = "Feed · saved"
    } else {
      label = text(view?["creator"]?["handle"]).map { "Feed by @\($0)" } ?? "Feed"
    }
    let title = oneLine(view?["displayName"])
    return LibraryItem(
      id: "feed:\(text(view?["uri"]) ?? "")", kind: "feed", shelf: "feeds", title: title.isEmpty ? "Untitled feed" : title,
      excerpt: oneLine(view?["description"]), label: label, source: view, uri: text(view?["uri"]),
      cid: text(view?["cid"]), view: view?.truthy ?? .null, at: text(view?["indexedAt"]), group: group)
  }

  /// A list view as an item.
  public static func itemFromList(_ view: JSONValue?) -> LibraryItem {
    var label = "List"
    if isString(view?["purpose"], curateList) {
      label = "List · curation"
    } else if isString(view?["purpose"], modList) {
      label = "List · moderation"
    }
    let title = oneLine(view?["name"])
    return LibraryItem(
      id: "list:\(text(view?["uri"]) ?? "")", kind: "list", shelf: "lists", title: title.isEmpty ? "Untitled list" : title,
      excerpt: oneLine(view?["description"]), label: label, source: view, uri: text(view?["uri"]),
      cid: text(view?["cid"]), view: view?.truthy ?? .null, at: text(view?["indexedAt"]))
  }

  /// Items newest first (`"date"`) or most engaged first (`"engagement"`,
  /// newest first among equals). `Date.parse` reads `at` in `timeZone`.
  public static func sortItems(_ items: [LibraryItem]?, by: String = "date", timeZone: TimeZone? = nil) -> [LibraryItem] {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let times = (items ?? []).map { item -> Double in
      let t = JSDate.parse(item.at ?? "", timeZone: zone)
      return t.isNaN ? -.infinity : t
    }
    let indexed = Array(zip(items ?? [], times))
    return JSSort.sort(indexed) { a, b in
      by == "engagement"
        ? or(finite(b.0.score) - finite(a.0.score), b.1 - a.1)
        : b.1 - a.1
    }.map(\.0)
  }

  /// `a || b` for numbers: `b` when `a` is 0 or NaN.
  static func or(_ a: Double, _ b: @autoclosure () -> Double) -> Double {
    a == 0 || a.isNaN ? b() : a
  }
}
