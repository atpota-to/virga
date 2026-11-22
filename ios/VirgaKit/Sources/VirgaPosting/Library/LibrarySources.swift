// Ports src/posting/library/sources.js
//
// The reads behind the embed library's shelves, for the account the post is
// written as, and the lookups that turn a pasted link or a template's quote
// into something the composer can attach.
//
//   Your posts, Your replies   that account's archive (VirgaArchive's store,
//                              read only); the public author feed when the
//                              archive is empty
//   Saved                      Bluesky bookmarks, signed in
//   Links                      links in recent posts, public author feed
//   Feeds, Lists               public reads, plus the saved feeds in the
//                              account's preferences
//   Search                     Bluesky post search, signed in
//
// Whatever is picked is read again from the public AppView (getPosts and the
// feed and list reads) before it's attached, for its cid and the post as it
// now is. A post by someone else is checked for quoting turned off (its
// postgate) too.
//
// The public AppView reads themselves (publicXrpc, getPosts, resolveHandle,
// chunk) are VirgaNetwork's PublicAppView. Public reads take a transport
// (HTTP.transport by default); signed-in reads take the account's agent and
// always ask Bluesky's AppView. Cancelling the task is the web's abort.
//
// publish/linkCard.js's fetchLinkCard is another chain's port: it comes in
// as a closure with the web's signature (`FetchLinkCard`).

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

/// `fetchLinkCard(url, { signal })`: the card for a web address (the
/// composer's card shape, `{ url, title, description, thumb }`), or nil when
/// the card service has nothing. Throws only when called off.
public typealias FetchLinkCard = @Sendable (String) async throws -> JSONValue?

/// `openAnalyticsStore(did)`: the account's archive, read only here.
public typealias OpenArchiveStore = @Sendable (String) async throws -> any AnalyticsStoreHandle

/// A page of a shelf's read: its views (or links), the cursor for the
/// next, and (for the first page of feeds) the saved feeds.
public struct LibraryPage: Hashable, Sendable {
  public var items: [JSONValue]
  public var cursor: String?
  public var saved: [JSONValue]?

  public init(items: [JSONValue] = [], cursor: String? = nil, saved: [JSONValue]? = nil) {
    self.items = items
    self.cursor = cursor
    self.saved = saved
  }

  public var json: JSONValue {
    var out: [String: JSONValue] = ["items": .array(items), "cursor": cursor.map(JSONValue.string) ?? .null]
    if let saved { out["saved"] = .array(saved) }
    return .object(out)
  }
}

/// A shelf's items, and (for archive rows) how many rows matched.
public struct ShelfItems: Hashable, Sendable {
  public var items: [LibraryItem]
  public var total: Int?

  public init(items: [LibraryItem], total: Int?) {
    self.items = items
    self.total = total
  }

  public var json: JSONValue {
    ["items": .array(items.map(\.json)), "total": total.map { .number(Double($0)) } ?? .null]
  }
}

/// What the AppView says a template quotes: a URI's view, or "missing"
/// when it's gone (`Map<uri, view | 'missing'>`). URIs compare by code unit.
public struct LibraryEmbedViews: Hashable, Sendable {
  public struct Entry: Hashable, Sendable {
    public var uri: String
    public var view: JSONValue
  }

  public private(set) var entries: [Entry] = []

  public init() {}

  public var isEmpty: Bool { entries.isEmpty }
  public var count: Int { entries.count }

  /// The view (or `.string("missing")`) for a URI, or nil when unknown.
  public subscript(uri: String) -> JSONValue? {
    get { entries.first { $0.uri.jsEquals(uri) }?.view }
    set {
      if let index = entries.firstIndex(where: { $0.uri.jsEquals(uri) }) {
        if let newValue { entries[index].view = newValue } else { entries.remove(at: index) }
      } else if let newValue {
        entries.append(Entry(uri: uri, view: newValue))
      }
    }
  }

  /// `new Map([...this, ...other])`.
  public func merging(_ other: LibraryEmbedViews) -> LibraryEmbedViews {
    var out = self
    for entry in other.entries { out[entry.uri] = entry.view }
    return out
  }

  /// The Map as a fixture writes it: an object of URIs.
  public var json: JSONValue {
    var out: [String: JSONValue] = [:]
    for entry in entries { out[entry.uri] = entry.view }
    return .object(out)
  }
}

/// A pasted link as an embed for a template: `{ embed, title, by, view? }`.
public struct ResolvedTemplateLink: Hashable, Sendable {
  public var embed: JSONValue
  public var title: String
  public var by: String
  public var view: JSONValue?

  public var json: JSONValue {
    var out: [String: JSONValue] = ["embed": embed, "title": .string(title), "by": .string(by)]
    if let view { out["view"] = view }
    return .object(out)
  }
}

/// A failed pick: `code` 'GONE' (it no longer exists) or 'QUOTES_OFF' (its
/// author doesn't allow quotes), with the web's message.
public struct LibraryPickError: Error, Hashable, Sendable, LocalizedError {
  public var code: String
  public var message: String
  public var errorDescription: String? { message }

  public static let gone = "GONE"
  public static let quotesOff = "QUOTES_OFF"
}

/// A read that couldn't be made: 'Not signed in', or a post that couldn't be read.
public struct LibrarySourcesError: Error, Hashable, Sendable, LocalizedError {
  public var message: String
  public var errorDescription: String? { message }
}

public enum LibrarySources {
  static let postCollection = "app.bsky.feed.post"
  static let feedCollection = "app.bsky.feed.generator"
  static let listCollection = "app.bsky.graph.list"
  static let recordEmbed = "app.bsky.embed.record"
  static let externalEmbed = "app.bsky.embed.external"
  static let linkFeature = "app.bsky.richtext.facet#link"
  static let postView = "app.bsky.feed.defs#postView"
  static let postgateCollection = "app.bsky.feed.postgate"
  static let disableRule = "app.bsky.feed.postgate#disableRule"

  static let pageOwnPosts = 50
  static let pageLinks = 100
  static let pageFeeds = 50
  static let pageLists = 50
  public static let pageBookmarks = 50
  static let pageSearch = 25
  static let linksScanLimit = 500
  static let linksWanted = 50
  // A page of an author feed can hold none of one shelf's kind (fifty posts
  // and not one reply), so the fallback reads on until it has this many, or
  // has read this many pages.
  static let ownPostsWanted = 10
  static let ownPostsPages = 4

  /// `typeof v === 'string' ? v : ''`.
  static func str(_ value: JSONValue?) -> String { TemplateJS.str(value) }

  /// `v || null` as text.
  static func text(_ value: JSONValue?) -> String? { TemplateJS.text(value) }

  /// `(v || [])` walked as a list (a non-array reads as empty).
  static func list(_ value: JSONValue?) -> [JSONValue] { value?.truthy?.arrayValue ?? [] }

  /// `{ ...params, cursor }` when there is a cursor.
  static func withCursor(_ params: QueryParams, _ cursor: String?) -> QueryParams {
    guard let cursor, !cursor.isEmpty else { return params }
    return QueryParams(params.items.map { ($0.name, $0.value) } + [("cursor", .string(cursor))])
  }

  static func withCursor(_ params: XRPCParams, _ cursor: String?) -> XRPCParams {
    guard let cursor, !cursor.isEmpty else { return params }
    var out = params
    out["cursor"] = .string(cursor)
    return out
  }

  /// `/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/`.
  static func parseAtUri(_ uri: JSONValue?) -> AtUri? { AtUri.parseExact(str(uri)) }

  // A 400 or a not-found from the AppView means the record is gone; anything
  // else (offline, a 5xx) says nothing about it.
  static let notFound = JSRegex(
    "[nN][oO][tT][\(JSRegex.space)]*[fF][oO][uU][nN][dD]|[cC][oO][uU][lL][dD] [nN][oO][tT] (?:[fF][iI][nN][dD]|[lL][oO][cC][aA][tT][eE])")

  static func isGone(_ error: any Error) -> Bool {
    if let e = error as? PublicXrpcError {
      if e.status == 400 || e.status == 404 { return true }
      if e.error?.stringValue == "NotFound" { return true }
    }
    return notFound.test(jsMessage(error))
  }

  static func appviewAgent(_ agent: XRPCAgent?) throws -> XRPCAgent {
    guard let agent else { throw LibrarySourcesError(message: "Not signed in") }
    return agent.withBlueskyAppView()
  }

  // MARK: - Posts

  /// Every post row in `did`'s archive, read only. Empty when there is none
  /// (or it couldn't be read).
  public static func readArchivePosts(_ did: String?, openStore: OpenArchiveStore) async -> [JSONValue] {
    guard let did, !did.isEmpty else { return [] }
    do {
      let store = try await openStore(did)
      let rows = await store.all("posts")
      let prefix = "at://\(did)/"
      return rows.filter { row in
        guard let uri = row["uri"], uri.isTruthy else { return false }
        return TemplateJS.startsWith(uri.stringValue ?? uri.jsString, prefix)
      }
    } catch {
      return []
    }
  }

  /// One shelf of archive rows as items: Your posts (top-level posts and
  /// continuations of your own threads) or, with `replies`, Your replies.
  /// Searched (`query`, in the text the row keeps), sorted (`"date"` or
  /// `"engagement"`) and cut to `limit`; `total` is every row that matched.
  public static func archiveShelf(
    _ rows: [JSONValue]?, did: String? = nil, replies: Bool = false, sort: String = "date", query: String = "",
    limit: Double = 50, clock: LibraryClock = LibraryClock()
  ) -> ShelfItems {
    let needle = query.jsTrimmed().jsLowercased()
    func time(_ r: JSONValue) -> Double {
      let t = JSDate.parse(text(r["at"]) ?? "", timeZone: clock.zone)
      return t.isNaN ? -.infinity : t
    }
    // `(r.likes || 0) + …`: JavaScript's `+`, so a string count concatenates.
    func score(_ r: JSONValue) -> JSONValue {
      ["likes", "reposts", "replies", "quotes"].reduce(JSONValue.number(0)) { sum, key in
        jsAdd(sum, r[key]?.truthy ?? .number(0))
      }
    }
    let matched = (rows ?? []).filter { r in
      guard r["uri"]?.isTruthy == true else { return false }
      guard Library.isOwnThreadRow(r, did) != replies else { return false }
      return needle.isEmpty || str(r["text"]).jsLowercased().jsIndexOf(needle) >= 0
    }
    let sorted = JSSort.sort(matched) { a, b in
      sort == "engagement" ? Library.or(jsSubtract(score(b), score(a)), time(b) - time(a)) : time(b) - time(a)
    }
    let shelf = replies ? "replies" : "posts"
    let count = limit.isNaN ? 0 : Int(Swift.max(0, Swift.min(limit, Double(sorted.count))).rounded(.towardZero))
    return ShelfItems(
      items: sorted.prefix(count).map { Library.itemFromArchiveRow($0, shelf: shelf, selfDid: did, clock: clock) },
      total: matched.count)
  }

  /// `a + b` as JavaScript adds two values.
  static func jsAdd(_ a: JSONValue, _ b: JSONValue) -> JSONValue {
    func primitive(_ v: JSONValue) -> JSONValue {
      switch v {
      case .array, .object: return .string(v.jsString)
      default: return v
      }
    }
    let (x, y) = (primitive(a), primitive(b))
    if case .string = x { return .string(x.jsString + y.jsString) }
    if case .string = y { return .string(x.jsString + y.jsString) }
    return .number(x.jsNumber + y.jsNumber)
  }

  /// `a - b` as JavaScript subtracts.
  static func jsSubtract(_ a: JSONValue, _ b: JSONValue) -> Double { a.jsNumber - b.jsNumber }

  /// The account's own posts from its public author feed, for when its
  /// archive hasn't been built: top-level posts and own-thread
  /// continuations, or with `replies` its replies into other threads.
  /// Reposts are left out. Reads on until it has ten or has read four pages.
  public static func fetchOwnPosts(
    _ did: String?, cursor: String? = nil, replies: Bool = false, transport: any HTTPTransport = HTTP.transport
  ) async throws -> LibraryPage {
    var items: [JSONValue] = []
    // The cursor as the AppView gave it, so a repeat is told by `!==`.
    var next: JSONValue? = cursor?.isEmpty == false ? .string(cursor!) : nil
    var pages = 0
    repeat {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.feed.getAuthorFeed",
        withCursor(
          ["actor": did.map(JSONValue.string), "limit": .number(Double(pageOwnPosts)), "filter": "posts_with_replies"],
          text(next)),
        transport: transport)
      for entry in list(body["feed"]) {
        guard let post = entry["post"], post["uri"]?.isTruthy == true, entry["reason"]?.isTruthy != true else { continue }
        if let author = post["author"]?["did"], author.isTruthy, !Library.same(author, did) { continue }
        let own = Library.isOwnThreadPost(post)
        if replies ? !own : own { items.append(post) }
      }
      // A cursor handed back unchanged would read the same page forever.
      let answered = body["cursor"]
      next = answered?.isTruthy == true && !TemplateJS.strictEquals(answered, next) ? answered : nil
      pages += 1
    } while next != nil && items.count < ownPostsWanted && pages < ownPostsPages
    return LibraryPage(items: items, cursor: text(next))
  }

  /// Bluesky bookmarks, signed in, as post views (blocked and deleted ones left out).
  public static func fetchBookmarks(
    _ agent: XRPCAgent?, cursor: String? = nil, limit: Int = pageBookmarks
  ) async throws -> LibraryPage {
    let res = try await appviewAgent(agent).query(
      "app.bsky.bookmark.getBookmarks", withCursor(["limit": .integer(limit)], cursor))
    let items = list(res.data["bookmarks"]).compactMap { $0["item"] }.filter { item in
      guard item["uri"]?.isTruthy == true else { return false }
      return Library.isString(item["$type"], postView) || (item["$type"] == nil && item["record"]?.isTruthy == true)
    }
    return LibraryPage(items: items, cursor: text(res.data["cursor"]))
  }

  /// Bluesky post search, signed in. With `mine`, only the account's own
  /// posts (`from:` its handle, or `from:me` when the handle isn't known).
  public static func searchPosts(
    _ agent: XRPCAgent?, _ query: String?, mine: Bool = false, handle: String? = nil, cursor: String? = nil
  ) async throws -> LibraryPage {
    let q = (query ?? "").jsTrimmed()
    let who = handle?.isEmpty == false ? handle! : "me"
    let res = try await appviewAgent(agent).query(
      "app.bsky.feed.searchPosts",
      withCursor(["q": .string(mine ? "from:\(who) \(q)" : q), "limit": .integer(pageSearch)], cursor))
    return LibraryPage(items: list(res.data["posts"]), cursor: text(res.data["cursor"]))
  }

  // MARK: - Links

  static let mediaExtensions = [".gif", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".svg"]
  static let mediaHosts = [
    "media.tenor.com", "giphy.com", "media.giphy.com", "i.imgur.com", "media.imgur.com", "i.redd.it",
    "media.discordapp.net", "cdn.discordapp.com",
  ]

  /// Whether a link is an image or a GIF rather than a page worth a card.
  public static func isMediaUrl(_ url: JSONValue?) -> Bool {
    guard let url, url.isTruthy else { return false }
    let lower = (url.stringValue ?? url.jsString).jsLowercased()
    var path = lower
    var host = ""
    if let parsed = WHATWGURL.parse(lower) {
      path = parsed.pathname
      host = parsed.hostname
    }
    func endsWith(_ s: String, _ suffix: String) -> Bool { s.utf16.reversed().starts(with: suffix.utf16.reversed()) }
    if mediaExtensions.contains(where: { endsWith(path, $0) || endsWith(lower, $0) }) { return true }
    return !host.isEmpty && mediaHosts.contains { host.jsEquals($0) || endsWith(host, ".\($0)") }
  }

  public static func isMediaUrl(_ url: String?) -> Bool { isMediaUrl(url.map(JSONValue.string)) }

  // Links to posts and profiles belong to quoting, not to link cards:
  // /\bbsky\.app\/profile/i.
  static func isProfileLink(_ url: String) -> Bool {
    let units = Array(url.utf16).map { (0x41...0x5A).contains($0) ? $0 + 0x20 : $0 }
    let needle = Array("bsky.app/profile".utf16)
    guard units.count >= needle.count else { return false }
    func isWord(_ u: UInt16) -> Bool {
      (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F
    }
    for start in 0...(units.count - needle.count) where Array(units[start..<(start + needle.count)]) == needle {
      if start == 0 || !isWord(units[start - 1]) { return true }
    }
    return false
  }

  /// A set of the links already seen, as `new Set(...)` compares them.
  struct SeenLinks {
    var strings = Set<JSKey>()
    var others: [JSONValue] = []

    func contains(_ value: JSONValue) -> Bool {
      if let s = value.stringValue { return strings.contains(JSKey(s)) }
      return others.contains { TemplateJS.sameValueZero($0, value) }
    }

    mutating func insert(_ value: JSONValue) {
      if let s = value.stringValue { strings.insert(JSKey(s)) } else { others.append(value) }
    }
  }

  /// Links from the account's recent posts: link cards first-hand, and bare
  /// links from facets. Scans at most 500 posts per call, stopping after the
  /// page that brings the count to 50. Media links and post links are left
  /// out, and so are reposts (someone else's link). A link already in
  /// `seen`, or earlier in this call, is skipped, so pages dedupe against
  /// each other. Newest first; each `{ url, title, description, image,
  /// postUri, createdAt }`.
  public static func fetchRecentLinks(
    _ did: String?, cursor: String? = nil, seen: [JSONValue]? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> LibraryPage {
    var known = SeenLinks()
    for url in seen ?? [] { known.insert(url) }
    var found: [JSONValue] = []
    var next = cursor?.isEmpty == false ? cursor : nil
    var scanned = 0

    func add(_ link: [String: JSONValue]) {
      guard let url = link["url"], url.isTruthy, !known.contains(url), !isMediaUrl(url) else { return }
      known.insert(url)
      found.append(.object(link))
    }

    repeat {
      let body = try await PublicAppView.publicXrpc(
        "app.bsky.feed.getAuthorFeed",
        withCursor(["actor": did.map(JSONValue.string), "limit": .number(Double(pageLinks))], next),
        transport: transport)
      let feed = list(body["feed"])
      for entry in feed {
        guard let post = entry["post"], post.isTruthy, entry["reason"]?.isTruthy != true else { continue }
        if let author = post["author"]?["did"], author.isTruthy, !Library.same(author, did) { continue }
        let createdAt = post["record"]?["createdAt"]?.truthy ?? post["indexedAt"]?.truthy ?? .null
        let embed = post["record"]?["embed"]
        if Library.isString(embed?["$type"], externalEmbed), let uri = embed?["external"]?["uri"], uri.isTruthy {
          // The view's thumb is a URL; the record's is a blob.
          let thumb = post["embed"]?["external"]?["thumb"]
          add([
            "url": uri, "title": .string(str(embed?["external"]?["title"])),
            "description": .string(str(embed?["external"]?["description"])),
            "image": thumb?.stringValue.map(JSONValue.string) ?? .null, "postUri": post["uri"] ?? .null,
            "createdAt": createdAt,
          ])
        }
        for facet in list(post["record"]?["facets"]) {
          for feature in list(facet["features"]) {
            guard Library.isString(feature["$type"], linkFeature), let uri = feature["uri"]?.stringValue else { continue }
            if isProfileLink(uri) { continue }
            add([
              "url": .string(uri), "title": .string(uri), "description": "", "image": .null,
              "postUri": post["uri"] ?? .null, "createdAt": createdAt,
            ])
          }
        }
      }
      scanned += feed.count
      next = text(body["cursor"])
      // An empty page with a cursor would otherwise loop; the cursor is kept for Load more.
      if feed.isEmpty { break }
    } while next != nil && scanned < linksScanLimit && found.count < linksWanted

    // `new Date(createdAt || '').getTime()`.
    func time(_ link: JSONValue) -> Double {
      let t = JSDate.toMs(link["createdAt"]?.truthy ?? .string(""), timeZone: AppLocale.activeTimeZone())
      return t.isNaN ? -.infinity : t
    }
    return LibraryPage(items: JSSort.sort(found) { time($1) - time($0) }, cursor: next)
  }

  // MARK: - Feeds and lists

  /// Feeds the account made, from the public AppView.
  public static func fetchOwnFeeds(
    _ did: String?, cursor: String? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> LibraryPage {
    let body = try await PublicAppView.publicXrpc(
      "app.bsky.feed.getActorFeeds",
      withCursor(["actor": did.map(JSONValue.string), "limit": .number(Double(pageFeeds))], cursor),
      transport: transport)
    return LibraryPage(items: list(body["feeds"]), cursor: text(body["cursor"]))
  }

  /// The feed URIs saved in an account's preferences, in saved order.
  public static func savedFeedUris(_ preferences: JSONValue?) -> [String] {
    var out: [String] = []
    for pref in preferences?.arrayValue ?? [] {
      if Library.isString(pref["$type"], "app.bsky.actor.defs#savedFeedsPrefV2") {
        for item in list(pref["items"]) where Library.isString(item["type"], "feed") {
          if let value = item["value"]?.stringValue { out.append(value) }
        }
      } else if Library.isString(pref["$type"], "app.bsky.actor.defs#savedFeedsPref") {
        for uri in list(pref["pinned"]) + list(pref["saved"]) {
          guard let s = uri.stringValue, parseAtUri(uri)?.collection == feedCollection else { continue }
          out.append(s)
        }
      }
    }
    var seen = Set<JSKey>()
    return out.filter { seen.insert(JSKey($0)).inserted }
  }

  /// Feeds the account saved (lists left out), read from the public AppView;
  /// one that can't be read is dropped. Throws when the preferences
  /// themselves can't be read, so the shelf shows an error rather than "none".
  public static func fetchSavedFeeds(_ agent: XRPCAgent?, transport: any HTTPTransport = HTTP.transport) async throws -> [JSONValue] {
    guard let agent else { throw LibrarySourcesError(message: "Not signed in") }
    let res = try await agent.query("app.bsky.actor.getPreferences", [:])
    let uris = savedFeedUris(res.data["preferences"])
    let parts = PublicAppView.chunk(uris)
    let pages = await withTaskGroup(of: (Int, [JSONValue]).self) { group in
      for (index, feeds) in parts.enumerated() {
        group.addTask {
          let body = try? await PublicAppView.publicXrpc(
            "app.bsky.feed.getFeedGenerators", ["feeds": .array(feeds.map(JSONValue.string))], transport: transport)
          return (index, body.map { list($0["feeds"]) } ?? [])
        }
      }
      var out: [(Int, [JSONValue])] = []
      for await page in group { out.append(page) }
      return out.sorted { $0.0 < $1.0 }.flatMap(\.1)
    }
    // `new Map(views.map((v) => [v.uri, v]))`: the last view for a URI wins.
    var byUri: [JSKey: JSONValue] = [:]
    for view in pages {
      if let uri = view["uri"]?.stringValue { byUri[JSKey(uri)] = view }
    }
    return uris.compactMap { byUri[JSKey($0)] }.filter(\.isTruthy)
  }

  /// Lists the account made, from the public AppView.
  public static func fetchOwnLists(
    _ did: String?, cursor: String? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> LibraryPage {
    let body = try await PublicAppView.publicXrpc(
      "app.bsky.graph.getLists",
      withCursor(["actor": did.map(JSONValue.string), "limit": .number(Double(pageLists))], cursor),
      transport: transport)
    return LibraryPage(items: list(body["lists"]), cursor: text(body["cursor"]))
  }

  // MARK: - Reading a pick again

  static func readRecord(_ kind: String, _ uri: String, transport: any HTTPTransport) async throws -> JSONValue? {
    if kind == "post" {
      let result = await PublicAppView.getPosts([uri], transport: transport)
      if result.failed > 0 { throw result.error ?? LibrarySourcesError(message: "Couldn’t read that post.") }
      return result.views.first?.truthy
    }
    do {
      if kind == "feed" {
        return try await PublicAppView.publicXrpc("app.bsky.feed.getFeedGenerator", ["feed": .string(uri)], transport: transport)["view"]?.truthy
      }
      if kind == "list" {
        return try await PublicAppView.publicXrpc(
          "app.bsky.graph.getList", ["list": .string(uri), "limit": 1], transport: transport)["list"]?.truthy
      }
    } catch {
      if isGone(error) { return nil }
      throw error
    }
    return nil
  }

  // /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/
  static func postAt(_ uri: String) -> (repo: String, rkey: String)? {
    guard let parsed = AtUri.parseExact(uri), parsed.collection == postCollection else { return nil }
    return (parsed.authority, parsed.rkey)
  }

  /// Whether the post's author has turned quoting off: its postgate (at the
  /// post's rkey) holds a disableRule. The public reads carry no viewer
  /// state, so `viewer.embeddingDisabled` is never there to say; the record
  /// is public. An author's own post can always be quoted by them. False
  /// when there's no postgate, or it couldn't be read; throws only when
  /// called off.
  public static func quotesTurnedOff(
    _ uri: String?, selfDid: String? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> Bool {
    guard let at = postAt(uri ?? "") else { return false }
    if let selfDid, !selfDid.isEmpty, at.repo.jsEquals(selfDid) { return false }
    do {
      let body = try await PublicAppView.publicXrpc(
        "com.atproto.repo.getRecord",
        ["repo": .string(at.repo), "collection": .string(postgateCollection), "rkey": .string(at.rkey)],
        transport: transport)
      guard let rules = body["value"]?["embeddingRules"]?.arrayValue else { return false }
      return rules.contains { Library.isString($0["$type"], disableRule) }
    } catch {
      if error is CancellationError || Task.isCancelled { throw error }
      return false
    }
  }

  static func quotesOffError() -> LibraryPickError {
    LibraryPickError(code: LibraryPickError.quotesOff, message: "That post’s author doesn’t allow quotes.")
  }

  /// Whether the post at `view` (or `uri`) can't be quoted by `selfDid`.
  static func quotesOffFor(_ view: JSONValue?, _ uri: String?, selfDid: String?, transport: any HTTPTransport) async throws -> Bool {
    let mine = (selfDid?.isEmpty == false) && Library.isString(view?["author"]?["did"], selfDid!)
    if !mine && view?["viewer"]?["embeddingDisabled"]?.isTruthy == true { return true }
    return try await quotesTurnedOff(uri, selfDid: selfDid, transport: transport)
  }

  static func goneError(_ kind: String) -> LibraryPickError {
    let noun = ["post": "post", "feed": "feed", "list": "list"][kind] ?? "record"
    return LibraryPickError(code: LibraryPickError.gone, message: "That \(noun) is gone, so it can’t be attached.")
  }

  /// A picked post, feed or list read again from the public AppView, as the
  /// item it now is (its cid, its full text, its counts), keeping the shelf
  /// it was picked from and its reason. A post whose author doesn't allow
  /// quotes comes back marked `quotesOff`, to be shown but not attached.
  /// Templates and links come back as they are. Throws LibraryPickError
  /// 'GONE' for one that no longer exists; any other failure as it came.
  public static func hydratePick(
    _ item: LibraryItem, selfDid: String? = nil, transport: any HTTPTransport = HTTP.transport,
    clock: LibraryClock = LibraryClock()
  ) async throws -> LibraryItem {
    let kind = item.kind
    guard let uri = item.uri, !uri.isEmpty, Library.isRecordKind(kind) else { return item }
    guard let view = try await readRecord(kind, uri, transport: transport) else { throw goneError(kind) }
    var fresh: LibraryItem
    switch kind {
    case "post": fresh = Library.itemFromPost(view, shelf: item.shelf.isEmpty ? "posts" : item.shelf, selfDid: selfDid, clock: clock)
    case "feed": fresh = Library.itemFromFeed(view, group: item.group?.isEmpty == false ? item.group! : "yours")
    default: fresh = Library.itemFromList(view)
    }
    if !item.shelf.isEmpty { fresh.shelf = item.shelf }
    fresh.reason = item.reason
    // The public read has no viewer state, so what a signed-in shelf already
    // knew is kept, and the postgate is asked otherwise.
    if kind == "post" {
      if item.quotesOff == true { return Library.markQuotesOff(fresh) }
      if try await quotesOffFor(view, uri, selfDid: selfDid, transport: transport) { return Library.markQuotesOff(fresh) }
    }
    return fresh
  }

  /// A plan's attachment with its cid and view filled in (a template's
  /// quote, or a post picked from the archive). A link, or a record that
  /// already has both, comes back as it is, once a post is known to be
  /// quotable. Throws LibraryPickError 'GONE' and 'QUOTES_OFF' as hydratePick does.
  public static func hydrateAttachment(
    _ attach: LibraryAttachment, selfDid: String? = nil, transport: any HTTPTransport = HTTP.transport
  ) async throws -> LibraryAttachment {
    guard !attach.isLink, let uri = attach.uri, !uri.isEmpty else { return attach }
    var out = attach
    if !(attach.cid?.isEmpty == false && attach.view?.isTruthy == true) {
      guard let view = try await readRecord(attach.kind, uri, transport: transport) else { throw goneError(attach.kind) }
      out.cid = text(view["cid"]) ?? (attach.cid?.isEmpty == false ? attach.cid : nil)
      out.view = view
    }
    if out.kind == "post" {
      if try await quotesOffFor(out.view, out.uri, selfDid: selfDid, transport: transport) { throw quotesOffError() }
    }
    return out
  }

  static func embedUri(_ entry: JSONValue) -> JSONValue? {
    if case .string = entry { return entry }
    let embed = entry["$type"]?.isTruthy == true ? entry : entry["embed"]
    if Library.isString(embed?["$type"], recordEmbed) { return embed?["record"]?["uri"]?.truthy ?? .null }
    return nil
  }

  /// Views for what templates quote, batched: posts in getPosts chunks,
  /// feeds through getFeedGenerator, lists through getList, all public.
  /// Entries may be template embeds, templates, or at:// URIs; link cards
  /// need no view. A URI maps to its view, or to "missing" when the AppView
  /// says it's gone. A URI whose read failed for any other reason is
  /// absent, so a network blip never reads as a deleted quote.
  public static func hydrateEmbedViews(_ entries: [JSONValue]?, transport: any HTTPTransport = HTTP.transport) async -> LibraryEmbedViews {
    var posts: [String] = []
    var feeds: [String] = []
    var lists: [String] = []
    func listed(_ uri: String) -> Bool {
      posts.contains { $0.jsEquals(uri) } || feeds.contains { $0.jsEquals(uri) } || lists.contains { $0.jsEquals(uri) }
    }
    for entry in entries ?? [] {
      guard let uri = embedUri(entry), let parsed = parseAtUri(uri), let text = uri.stringValue, !listed(text) else { continue }
      if parsed.collection == postCollection {
        posts.append(text)
      } else if parsed.collection == feedCollection {
        feeds.append(text)
      } else if parsed.collection == listCollection {
        lists.append(text)
      }
    }

    enum Read: Sendable {
      case posts([String], JSONValue?)
      case one(String, JSONValue?)
    }
    let missing = Library.missingValue
    let reads = await withTaskGroup(of: (Int, Read).self) { group in
      var index = 0
      for uris in PublicAppView.chunk(posts) {
        let at = index
        index += 1
        group.addTask {
          let body = try? await PublicAppView.publicXrpc(
            "app.bsky.feed.getPosts", ["uris": .array(uris.map(JSONValue.string))], transport: transport)
          return (at, .posts(uris, body))
        }
      }
      for (nsid, param, key, uris) in [
        ("app.bsky.feed.getFeedGenerator", "feed", "view", feeds), ("app.bsky.graph.getList", "list", "list", lists),
      ] {
        for uri in uris {
          let at = index
          index += 1
          group.addTask {
            let params: QueryParams =
              nsid == "app.bsky.graph.getList" ? [param: .string(uri), "limit": 1] : [param: .string(uri)]
            do {
              let body = try await PublicAppView.publicXrpc(nsid, params, transport: transport)
              return (at, .one(uri, body[key]?.truthy ?? missing))
            } catch {
              return (at, .one(uri, isGone(error) ? missing : nil))
            }
          }
        }
      }
      var out: [(Int, Read)] = []
      for await read in group { out.append(read) }
      return out.sorted { $0.0 < $1.0 }.map(\.1)
    }

    var out = LibraryEmbedViews()
    for read in reads {
      switch read {
      case .posts(let uris, let body):
        // Unknown, not gone: a chunk that failed is left out, and so is
        // one whose `posts` the web can't map (not a list, or holding a
        // null its `p.uri` throws on).
        guard let body else { continue }
        let answered = body["posts"]?.truthy ?? .array([])
        guard let posts = answered.arrayValue, !posts.contains(where: \.isNull) else { continue }
        var found: [JSKey: JSONValue] = [:]
        for post in posts {
          if let uri = post["uri"]?.stringValue { found[JSKey(uri)] = post }
        }
        for uri in uris { out[uri] = found[JSKey(uri)]?.truthy ?? missing }
      case .one(let uri, let view):
        if let view { out[uri] = view }
      }
    }
    return out
  }

  // MARK: - Pasted links

  /// A handle's DID from the public AppView, or nil (VirgaNetwork's).
  public static func resolveHandle(_ handle: String?, transport: any HTTPTransport = HTTP.transport) async -> String? {
    await PublicAppView.resolveHandle(handle, transport: transport)
  }

  static func firstLine(_ value: JSONValue?) -> String {
    TemplateJS.split(str(value), on: 0x0A).map { $0.jsTrimmed() }.first { !$0.isEmpty } ?? ""
  }

  static func recordFromLink(_ input: String, transport: any HTTPTransport) async -> (kind: String, view: JSONValue)? {
    guard let link = PostLink.parseRecordLink(input.jsTrimmed()), Library.isRecordKind(link.kind) else { return nil }
    var did = link.did?.isEmpty == false ? link.did : nil
    if did == nil { did = await resolveHandle(link.handle, transport: transport) }
    guard let did, !did.isEmpty else { return nil }
    let uri = "at://\(did)/\(link.collection)/\(link.rkey)"
    guard let view = try? await readRecord(link.kind, uri, transport: transport),
      view["uri"]?.isTruthy == true, view["cid"]?.isTruthy == true
    else { return nil }
    return (link.kind, view)
  }

  /// A pasted bsky.app (or aturi.to, or at://) link to a post, feed or
  /// list, as a record embed for a template, or nil when the link isn't one
  /// or the record can't be read.
  public static func resolveRecordLink(_ url: String?, transport: any HTTPTransport = HTTP.transport) async -> ResolvedTemplateLink? {
    guard let (kind, view) = await recordFromLink(url ?? "", transport: transport) else { return nil }
    var title: String
    var by: String
    switch kind {
    case "post":
      title = firstLine(view["record"]?["text"])
      if title.isEmpty { title = "Post" }
      by = text(view["author"]?["handle"]).map { "Post by @\($0)" } ?? "Post"
    case "feed":
      title = str(view["displayName"])
      if title.isEmpty { title = "Feed" }
      by = text(view["creator"]?["handle"]).map { "Feed by @\($0)" } ?? "Feed"
    default:
      title = str(view["name"])
      if title.isEmpty { title = "List" }
      by = text(view["creator"]?["handle"]).map { "List by @\($0)" } ?? "List"
    }
    let embed: JSONValue = [
      "$type": .string(recordEmbed), "record": ["uri": view["uri"] ?? .null, "cid": view["cid"] ?? .null],
    ]
    return ResolvedTemplateLink(embed: embed, title: title, by: by, view: view)
  }

  /// `new URL(text)` when it is an http(s) address.
  static func webURL(_ text: String) -> WHATWGURL? {
    guard let url = WHATWGURL.parse(text), url.protocolString == "https:" || url.protocolString == "http:" else { return nil }
    return url
  }

  /// Any other web link as a link-card embed for a template, `by` the host;
  /// nil when it isn't a web address or its card can't be read.
  public static func resolveExternalLink(_ url: String?, fetchLinkCard: FetchLinkCard) async throws -> ResolvedTemplateLink? {
    let trimmed = (url ?? "").jsTrimmed()
    guard let parsed = webURL(trimmed) else { return nil }
    let host = Library.withoutWWW(parsed.hostname)
    guard let card = try await fetchLinkCard(trimmed), card.isTruthy else { return nil }
    let title = str(card["title"])
    let embed: JSONValue = [
      "$type": .string(externalEmbed),
      "external": ["uri": .string(trimmed), "title": .string(title), "description": .string(str(card["description"]))],
    ]
    return ResolvedTemplateLink(embed: embed, title: title.isEmpty ? trimmed : title, by: host)
  }

  /// A link pasted into the library as an item to pick: a post, feed or
  /// list when it's a link to one (read from the public AppView), otherwise
  /// a link card (read from Bluesky's card service). Nil when it's neither,
  /// or can't be read.
  public static func resolvePastedLink(
    _ input: String?, selfDid: String? = nil, transport: any HTTPTransport = HTTP.transport,
    fetchLinkCard: FetchLinkCard, clock: LibraryClock = LibraryClock()
  ) async throws -> LibraryItem? {
    let text = (input ?? "").jsTrimmed()
    if text.isEmpty { return nil }
    if let (kind, view) = await recordFromLink(text, transport: transport) {
      switch kind {
      case "post":
        let item = Library.itemFromPost(view, shelf: "search", selfDid: selfDid, clock: clock)
        return try await quotesOffFor(view, item.uri, selfDid: selfDid, transport: transport) ? Library.markQuotesOff(item) : item
      case "feed": return Library.itemFromFeed(view, group: "search")
      default: return Library.itemFromList(view)
      }
    }
    if PostLink.parseRecordLink(text) != nil { return nil }
    guard webURL(text) != nil else { return nil }
    guard let card = try await fetchLinkCard(text), card.isTruthy else { return nil }
    var link: [String: JSONValue] = ["url": .string(text)]
    link["title"] = card["title"]
    link["description"] = card["description"]
    link["image"] = card["thumb"]
    return Library.itemFromLink(.object(link))
  }

  /// A FetchLinkCard that finds no card, for an app without the card
  /// service wired (the composer's linkCard port supplies the real one).
  public static let noLinkCard: FetchLinkCard = { _ in nil }

  // MARK: - Bound to one account

  /// The library's reads for one account (the one the post is written as).
  /// `agent` resolves the account's signed-in agent when it's asked for
  /// (the session's agentFor); only Saved, saved feeds and Search sign in.
  public static func librarySources(
    did: String?, agent: @escaping @Sendable (String?) async throws -> XRPCAgent? = { _ in nil },
    handle: String? = nil, transport: any HTTPTransport = HTTP.transport, openStore: @escaping OpenArchiveStore,
    fetchLinkCard: @escaping FetchLinkCard = noLinkCard, clock: @escaping @Sendable () -> LibraryClock = { LibraryClock() }
  ) -> AccountLibrarySources {
    AccountLibrarySources(
      did: did, agent: agent, handle: handle, transport: transport, openStore: openStore, fetchLinkCard: fetchLinkCard,
      clock: clock)
  }
}

/// What the library's store and model read a shelf with: the web's
/// librarySources object. AccountLibrarySources is the app's; tests and the
/// demo stand in their own.
public protocol LibraryShelfSources: Sendable {
  var did: String? { get }
  func archive() async -> [JSONValue]
  func posts(cursor: String?) async throws -> LibraryPage
  func replies(cursor: String?) async throws -> LibraryPage
  func saved(cursor: String?) async throws -> LibraryPage
  func links(cursor: String?, seen: [JSONValue]?) async throws -> LibraryPage
  func feeds(cursor: String?) async throws -> LibraryPage
  func savedFeeds() async throws -> [JSONValue]
  func lists(cursor: String?) async throws -> LibraryPage
  func search(_ query: String, mine: Bool, cursor: String?) async throws -> LibraryPage
  func hydrate(_ item: LibraryItem) async throws -> LibraryItem
  func hydrateAttachment(_ attach: LibraryAttachment) async throws -> LibraryAttachment
  func hydrateEmbeds(_ entries: [JSONValue]) async throws -> LibraryEmbedViews
  func resolveLink(_ input: String) async throws -> LibraryItem?
}

/// The library's reads bound to one account (sources.js librarySources).
public struct AccountLibrarySources: LibraryShelfSources {
  public let did: String?
  let agent: @Sendable (String?) async throws -> XRPCAgent?
  public let handle: String?
  let transport: any HTTPTransport
  let openStore: OpenArchiveStore
  let fetchLinkCard: FetchLinkCard
  let clock: @Sendable () -> LibraryClock

  init(
    did: String?, agent: @escaping @Sendable (String?) async throws -> XRPCAgent?, handle: String?,
    transport: any HTTPTransport, openStore: @escaping OpenArchiveStore, fetchLinkCard: @escaping FetchLinkCard,
    clock: @escaping @Sendable () -> LibraryClock
  ) {
    self.did = did
    self.agent = agent
    self.handle = handle
    self.transport = transport
    self.openStore = openStore
    self.fetchLinkCard = fetchLinkCard
    self.clock = clock
  }

  func signedIn() async throws -> XRPCAgent? { try await agent(did) }

  public func archive() async -> [JSONValue] {
    await LibrarySources.readArchivePosts(did, openStore: openStore)
  }

  public func posts(cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchOwnPosts(did, cursor: cursor, replies: false, transport: transport)
  }

  public func replies(cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchOwnPosts(did, cursor: cursor, replies: true, transport: transport)
  }

  public func saved(cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchBookmarks(try await signedIn(), cursor: cursor)
  }

  public func links(cursor: String? = nil, seen: [JSONValue]? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchRecentLinks(did, cursor: cursor, seen: seen, transport: transport)
  }

  public func feeds(cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchOwnFeeds(did, cursor: cursor, transport: transport)
  }

  public func savedFeeds() async throws -> [JSONValue] {
    try await LibrarySources.fetchSavedFeeds(try await signedIn(), transport: transport)
  }

  public func lists(cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.fetchOwnLists(did, cursor: cursor, transport: transport)
  }

  public func search(_ query: String, mine: Bool = false, cursor: String? = nil) async throws -> LibraryPage {
    try await LibrarySources.searchPosts(try await signedIn(), query, mine: mine, handle: handle, cursor: cursor)
  }

  public func hydrate(_ item: LibraryItem) async throws -> LibraryItem {
    try await LibrarySources.hydratePick(item, selfDid: did, transport: transport, clock: clock())
  }

  public func hydrateAttachment(_ attach: LibraryAttachment) async throws -> LibraryAttachment {
    try await LibrarySources.hydrateAttachment(attach, selfDid: did, transport: transport)
  }

  public func hydrateEmbeds(_ entries: [JSONValue]) async throws -> LibraryEmbedViews {
    await LibrarySources.hydrateEmbedViews(entries, transport: transport)
  }

  public func resolveLink(_ input: String) async throws -> LibraryItem? {
    try await LibrarySources.resolvePastedLink(
      input, selfDid: did, transport: transport, fetchLinkCard: fetchLinkCard, clock: clock())
  }
}
