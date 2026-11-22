// Ports harness/fakeNetwork.js
//
// The network, answered from the worlds. Every host the app reads without a
// session (the public AppView, the PLC directory, the accounts' PDS,
// Constellation, Bluesky's card and video services) is routed here, and so
// is Virga's server (FakeServer.swift, at `FakeServer.serverOrigin`), so the
// demo needs no connection and touches no real account. Anything else is
// refused, loudly, so a new outside request can't slip in unnoticed.
//
// `DemoRouter` is createRouter: a request's answer, or nil for a URL that
// isn't one of these hosts. `DemoTransport` is installFakeNetwork's fetch,
// as a VirgaNetwork HTTPTransport: the latency, then the router, and a
// refused request fails as a network failure naming the host.
//
// Where the web reads `Date.now()` (a post's live counts, a list's date)
// the router reads its `now`; the web's router takes the same `now` for
// the author feeds and the video jobs.

import Foundation
import VirgaCore
import VirgaNetwork

public enum FakeNetwork {
  static let day: Double = 86_400_000
  static let videoDid = "did:web:video.bsky.app"
  static var pdsHost: String { (try? WebURL(World.pds).hostname) ?? "pds.harness.example" }

  /// Link previews the card service knows by address (`CARDS`); anything
  /// else gets a generic one.
  public static let cards: [String: (title: String, description: String)] = [
    "example.com": (
      "Example Domain", "This domain is for use in documentation examples without needing permission."
    ),
    "www.example.org": ("Repair cafés near you", "Find a repair café, bring something broken, leave with it working."),
  ]

  /// `cardFor(href)`: what the card service says of an address. Throws
  /// decodeURIComponent's URIError for a path it can't decode, as the web's
  /// route then fails.
  public static func cardFor(_ href: String) throws -> JSONValue {
    let refused: JSONValue = ["error": "Unable to generate link preview"]
    guard let url = try? WebURL(href) else { return refused }
    if !(url.protocol == "http:" || url.protocol == "https:") || url.hostname.jsHasSuffix(".invalid") { return refused }
    let known = cards.first { $0.key.jsEquals(url.hostname) }?.value
    let words = try JSURI.decodeURIComponent(url.pathname).splitOnPathRuns().filter { word in
      !word.isEmpty && !word.endsWithExtension
    }
    var title = known?.title ?? ""
    if title.isEmpty {
      title = words.isEmpty ? url.hostname : words.joined(separator: " ").capitalizedFirstUnit
    }
    let description = known?.description ?? "A page on \(url.hostname)."
    let image = "https://\(url.hostname)/og/\(World.hashOf(url.href)).png"
    return [
      "error": "", "likely_type": "html", "url": .string(url.href), "title": .string(title),
      "description": .string(description),
      // cardyb hands images back through its own proxy, as here.
      "image": .string("https://cardyb.bsky.app/v1/image?url=\(JSURI.encodeURIComponent(image))"),
    ]
  }

  static func json(_ body: JSONValue, _ status: Int = 200) -> HTTPResponse {
    HTTPResponse.json(body, status: status)
  }

  static func xrpcError(_ status: Int, _ error: String, _ message: String) -> HTTPResponse {
    json(["error": .string(error), "message": .string(message)], status)
  }

  static func bytes(_ data: [UInt8], _ type: String, _ extra: HTTPHeaders = HTTPHeaders()) -> HTTPResponse {
    var headers: HTTPHeaders = ["Content-Type": type]
    for field in extra { headers.set(field.name, field.value) }
    return HTTPResponse(status: 200, headers: headers, body: Data(data))
  }

  /// A count for the thread views: Number(...) read as the web's `depth > 0`
  /// recursion goes (NaN and anything not above 0 is none; a fraction
  /// counts up).
  static func levels(_ value: Double) -> Int {
    guard value > 0 else { return 0 }
    return value.isFinite ? Int(min(value.rounded(.up), 1_000_000)) : 1_000_000
  }
}

extension String {
  /// `.split(/[/_-]+/)`.
  fileprivate func splitOnPathRuns() -> [String] {
    var out: [String] = []
    var current: [UInt16] = []
    var inRun = false
    for unit in utf16 {
      if unit == 0x2F || unit == 0x5F || unit == 0x2D {
        if !inRun { out.append(String(decoding: current, as: UTF16.self)); current = [] }
        inRun = true
      } else {
        current.append(unit)
        inRun = false
      }
    }
    out.append(String(decoding: current, as: UTF16.self))
    return out
  }

  /// `/\.\w+$/.test(word)`.
  fileprivate var endsWithExtension: Bool {
    let units = Array(utf16)
    var i = units.count
    func word(_ u: UInt16) -> Bool {
      (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F
    }
    while i > 0, word(units[i - 1]) { i -= 1 }
    return i < units.count && i > 0 && units[i - 1] == 0x2E
  }

  /// `.replace(/^./, (c) => c.toUpperCase())`: the first code unit, unless
  /// it ends a line.
  fileprivate var capitalizedFirstUnit: String {
    let units = Array(utf16)
    // A lone surrogate (half of an emoji) has no upper case.
    guard let first = units.first, ![0x0A, 0x0D, 0x2028, 0x2029].contains(first), Unicode.Scalar(first) != nil else {
      return self
    }
    return String(decoding: [first], as: UTF16.self).uppercased() + String(decoding: units.dropFirst(), as: UTF16.self)
  }

  fileprivate func jsHasSuffix(_ suffix: String) -> Bool {
    let a = Array(utf16)
    let b = Array(suffix.utf16)
    return a.count >= b.count && Array(a.suffix(b.count)) == b
  }
}

/// The query of a request, as `url.searchParams` reads it.
struct SearchParams {
  var pairs: [(String, String)]

  func get(_ name: String) -> String? { pairs.first { $0.0.jsEquals(name) }?.1 }
  func getAll(_ name: String) -> [String] { pairs.filter { $0.0.jsEquals(name) }.map(\.1) }
  func has(_ name: String) -> Bool { get(name) != nil }

  /// `q.get(name)` as JSON: the string, or null.
  func value(_ name: String) -> JSONValue { get(name).map(JSONValue.string) ?? .null }
  /// `${q.get(name)}`: the string, or "null".
  func text(_ name: String) -> String { get(name) ?? "null" }
}

/// The router for the worlds (`createRouter(worlds, { server, now,
/// videoProcessingMs })`).
public final class DemoRouter: Sendable {
  public let world: DemoWorld
  public let server: DemoServer?
  let now: @Sendable () -> Double
  /// How long the video service takes to "process" an upload.
  public let videoProcessingMs: Double

  struct VideoJob: Sendable {
    var did: String
    var blob: JSONValue
    var started: Double
  }

  let videoJobs = Locked<[JSKey: VideoJob]>([:])
  let cardImages = Locked<[JSKey: [UInt8]]>([:])

  public init(world: DemoWorld, server: DemoServer? = nil, now: @escaping @Sendable () -> Double, videoProcessingMs: Double = 4000) {
    self.world = world
    self.server = server
    self.now = now
    self.videoProcessingMs = videoProcessingMs
  }

  /// `worldOf(actor)`: an account's world by DID or handle.
  func worldOf(_ actor: String?, _ views: DemoViews) -> AccountWorld? {
    if let actor, let found = views.world(actor) { return found }
    if let did = views.resolveHandle(actor), let found = views.world(did) { return found }
    return nil
  }

  /// `route(url, init)`: the answer, or nil for a URL that isn't one of the
  /// outside hosts. Throws where the web's route rejects (an address no URL
  /// parser takes, a path decodeURIComponent refuses, the views' TypeErrors).
  public func route(_ request: HTTPRequest) async throws -> HTTPResponse? {
    let url = try WebURL(request.url, base: "http://harness.invalid")
    let q = SearchParams(pairs: url.searchParams)
    let parts = url.pathname.jsSplit("/xrpc/")
    let method = parts.count > 1 ? parts[1] : ""

    if let server, let answer = await server.route(request) { return answer }

    if url.hostname == "plc.directory" {
      return try plc(url)
    }
    if url.hostname == "public.api.bsky.app", let answer = try appView(method, q) {
      return answer
    }
    if url.origin == World.pds, let answer = try pds(url, method, q) {
      return answer
    }
    if url.hostname == "constellation.microcosm.blue", let answer = try constellation(url, method, q) {
      return answer
    }
    if url.hostname == "cardyb.bsky.app" {
      if url.pathname == "/v1/extract" { return FakeNetwork.json(try FakeNetwork.cardFor(q.get("url") ?? "")) }
      if url.pathname == "/v1/image" {
        let key = q.get("url") ?? ""
        let image = cardImages.withLock { held in
          if let found = held[JSKey(key)] { return found }
          let made = PNG.cardImage(Double(World.hashOf(key)))
          held[JSKey(key)] = made
          return made
        }
        return FakeNetwork.bytes(image, "image/png")
      }
    }
    if url.hostname == "video.bsky.app", !method.isEmpty, let answer = try video(request, q, method) {
      return answer
    }
    return nil
  }

  // MARK: The PLC directory

  func plc(_ url: WebURL) throws -> HTTPResponse {
    let views = world.views
    let did = try JSURI.decodeURIComponent(url.pathname.jsSlice(1)).jsSplit("/")[0]
    if url.pathname.jsHasSuffixUnits("/log/audit") {
      guard let log = auditLog(did, views) else { return FakeNetwork.json(["message": "DID not registered"], 404) }
      return FakeNetwork.json(.array(log))
    }
    var handle = views.world(did)?.me.handle
    if handle == nil { handle = views.person(did)?["handle"].jsTruthy.map(\.jsString) }
    return FakeNetwork.json([
      "id": .string(did), "alsoKnownAs": [.string("at://\(handle?.isEmpty == false ? handle! : "handle.invalid")")],
      "service": [["id": "#atproto_pds", "type": "AtprotoPersonalDataServer", "serviceEndpoint": .string(World.pds)]],
    ])
  }

  func auditLog(_ did: String, _ views: DemoViews) -> [JSONValue]? {
    func op(_ handle: String, _ pds: String, _ at: Double) -> JSONValue {
      [
        "did": .string(did),
        "operation": [
          "type": "plc_operation", "alsoKnownAs": [.string("at://\(handle)")],
          "services": ["atproto_pds": ["type": "AtprotoPersonalDataServer", "endpoint": .string(pds)]],
        ],
        "cid": "bafyharness", "nullified": false, "createdAt": .string(World.iso(at)),
      ]
    }
    guard let w = views.world(did) else { return nil }
    if did.jsEquals(World.me.did) {
      // Mira's history: made on Bluesky's own host under its first handle, a
      // handle of its own a year later, then a move to its own PDS.
      return [
        op("mira.bsky.social", "https://bsky.social", w.start),
        op(World.me.handle, "https://bsky.social", w.start + 380 * FakeNetwork.day),
        op(World.me.handle, World.pds, w.now - 210 * FakeNetwork.day),
      ]
    }
    return [op(w.me.handle, World.pds, w.start)]
  }

  // MARK: The public AppView

  func appView(_ method: String, _ q: SearchParams) throws -> HTTPResponse? {
    let views = world.views
    let at = now()
    switch method {
    case "app.bsky.actor.getProfile":
      guard let p = views.person(q.get("actor")) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Profile not found")
      }
      return FakeNetwork.json(p)

    case "app.bsky.actor.getProfiles":
      // An account nobody can resolve is simply absent, as on the network.
      return FakeNetwork.json(["profiles": .array(q.getAll("actors").compactMap { views.person($0) })])

    case "app.bsky.graph.getRelationships":
      // Who the actor follows and who follows them, read without a
      // session: Defense's veto ("you follow them") rests on this.
      let others = q.getAll("others")
      if others.count > 30 { return FakeNetwork.xrpcError(400, "InvalidRequest", "Too many others: at most 30") }
      guard let actorWorld = worldOf(q.get("actor"), views) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Actor not found")
      }
      let crowd = views.crowd
      return FakeNetwork.json([
        "actor": .string(actorWorld.me.did), "relationships": .array(others.map { crowd.relationship(actorWorld, $0) }),
      ])

    case "app.bsky.actor.searchActorsTypeahead", "app.bsky.actor.searchActors":
      let given = q.get("limit").map(JSNumber.toNumber) ?? 0
      let limit = JSMath.min(100, given.isNaN || given == 0 ? 10 : given)
      let term = q.get("q").flatMap { $0.isEmpty ? nil : $0 } ?? q.get("term")
      return FakeNetwork.json(["actors": .array(views.searchActors(term, limit: .number(limit)))])

    case "com.atproto.identity.resolveHandle":
      guard let did = views.resolveHandle(q.get("handle")) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Unable to resolve handle")
      }
      return FakeNetwork.json(["did": .string(did)])

    case "app.bsky.feed.getAuthorFeed":
      let actor = q.get("actor")
      if let actorWorld = worldOf(actor, views) {
        var items = try views.authorFeed(actorWorld, now: at)
        let filter = q.get("filter")
        if filter == "posts_no_replies" {
          items = items.filter { $0["reason"].jsTruthy != nil || $0["post"]?["record"]?["reply"].jsTruthy == nil }
        }
        if filter == "posts_with_media" {
          items = items.filter { $0["reason"].jsTruthy == nil && $0["post"]?["embed"].jsTruthy != nil }
        }
        let page = Views.pageOf(items, limit: q.value("limit"), cursor: q.value("cursor"))
        return FakeNetwork.json(FakeAgent.page("feed", .array(page.rows), page.cursor))
      }
      // Someone else's feed: one item, as old as their activity says.
      let person = views.person(actor)
      let did = person?["did"]?.stringValue
      let activity: WorldActivity = did.map(World.activityOf) ?? .gone
      switch activity {
      case .gone: return FakeNetwork.xrpcError(400, "InvalidRequest", "Profile not found")
      case .never: return FakeNetwork.json(["feed": []])
      case .daysAgo(let days):
        let ms = (at - Double(days) * FakeNetwork.day - 3_600_000).rounded(.towardZero)
        let stamp = World.iso(ms)
        let author = did ?? ""
        return FakeNetwork.json([
          "feed": [[
            "post": [
              "uri": .string("at://\(author)/app.bsky.feed.post/\(try World.tidAt(ms))"), "cid": "bafyharness",
              "author": views.card(author),
              "record": ["$type": "app.bsky.feed.post", "text": "A post.", "createdAt": .string(stamp)],
              "indexedAt": .string(stamp),
            ]
          ]]
        ])
      }

    case "app.bsky.feed.getPosts":
      let uris = q.getAll("uris")
      if uris.count > 25 { return FakeNetwork.xrpcError(400, "InvalidRequest", "Too many URIs: at most 25") }
      return FakeNetwork.json(["posts": .array(try uris.compactMap { try views.postView($0, now: at) })])

    case "app.bsky.feed.getPostThread":
      let depth = q.has("depth") ? FakeNetwork.levels(JSNumber.toNumber(q.get("depth") ?? "")) : 6
      let height = q.has("parentHeight") ? FakeNetwork.levels(JSNumber.toNumber(q.get("parentHeight") ?? "")) : 80
      guard let thread = try views.threadView(uri: q.value("uri"), depth: depth, parentHeight: height, now: at) else {
        return FakeNetwork.xrpcError(400, "NotFound", "Post not found: \(q.text("uri"))")
      }
      return FakeNetwork.json(["thread": thread])

    case "app.bsky.feed.getFeedGenerator":
      guard let view = views.generatorView(q.get("feed")) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "could not find feed")
      }
      return FakeNetwork.json(["view": view, "isOnline": true, "isValid": true])

    case "app.bsky.feed.getFeedGenerators":
      return FakeNetwork.json(["feeds": .array(q.getAll("feeds").compactMap { views.generatorView($0) })])

    case "app.bsky.feed.getActorFeeds":
      let feeds: [JSONValue] = worldOf(q.get("actor"), views)?.feeds.map { views.generatorView($0.uri) ?? .null } ?? []
      let page = Views.pageOf(feeds, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json(FakeAgent.page("feeds", .array(page.rows), page.cursor))

    case "app.bsky.graph.getList":
      guard let view = views.listView(q.get("list"), now: at) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "List not found")
      }
      let page = Views.pageOf(views.listMembers(q.get("list") ?? "null"), limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json(FakeAgent.page("items", .array(page.rows), page.cursor, ["list": view]))

    case "app.bsky.graph.getLists":
      let lists: [JSONValue] = worldOf(q.get("actor"), views)?.ownLists.map { views.listView($0.uri, now: at) ?? .null } ?? []
      let page = Views.pageOf(lists, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json(FakeAgent.page("lists", .array(page.rows), page.cursor))

    case "com.atproto.repo.getRecord":
      let uri = "at://\(q.text("repo"))/\(q.text("collection"))/\(q.text("rkey"))"
      if let repoWorld = worldOf(q.get("repo"), views) {
        guard let found = try HarnessRepo.readRecord(repoWorld, q.text("collection"), q.text("rkey")) else {
          return FakeNetwork.xrpcError(400, "RecordNotFound", "Could not locate record: \(uri)")
        }
        return FakeNetwork.json(try JSONValue(encoding: found))
      }
      for w in views.worlds {
        if let list = w.lists.first(where: { $0.uri.jsEquals(uri) }) {
          return FakeNetwork.json([
            "uri": .string(uri), "cid": "bafyharness",
            "value": ["$type": "app.bsky.graph.list", "name": .string(list.name), "purpose": .string(list.purpose)],
          ])
        }
      }
      if let post = try views.postView(uri, now: at) {
        return FakeNetwork.json(["uri": .string(uri), "cid": post["cid"] ?? .null, "value": post["record"] ?? .null])
      }
      return FakeNetwork.xrpcError(400, "RecordNotFound", "Could not locate record: \(uri)")

    default:
      return nil
    }
  }

  // MARK: The accounts' PDS

  func pds(_ url: WebURL, _ method: String, _ q: SearchParams) throws -> HTTPResponse? {
    let views = world.views
    // What a sign-in reads to name the page an account signs in on: this
    // PDS is its own authorization server.
    if url.pathname == "/.well-known/oauth-protected-resource" {
      return FakeNetwork.json(["resource": .string(World.pds), "authorization_servers": [.string(World.pds)]])
    }
    switch method {
    case "com.atproto.sync.getRepo":
      guard let did = q.get("did"), let repoWorld = views.world(did) else {
        return FakeNetwork.xrpcError(400, "RepoNotFound", "Could not find repo for DID: \(q.text("did"))")
      }
      // No revision log here: asked for a diff, say the revision is gone, and
      // the dashboard pulls the whole repo again as it would from a real PDS.
      if q.get("since").map({ !$0.isEmpty }) ?? false {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Unknown revision")
      }
      let car = try world.repoCar(did: repoWorld.me.did)
      return FakeNetwork.bytes(car, "application/vnd.ipld.car", ["Content-Length": String(car.count)])

    case "com.atproto.repo.getRecord":
      if let repoWorld = worldOf(q.get("repo"), views),
        let found = try HarnessRepo.readRecord(repoWorld, q.text("collection"), q.text("rkey"))
      {
        return FakeNetwork.json(try JSONValue(encoding: found))
      }
      return FakeNetwork.xrpcError(
        400, "RecordNotFound", "Could not locate record: at://\(q.text("repo"))/\(q.text("collection"))/\(q.text("rkey"))")

    case "com.atproto.repo.listRecords":
      guard let repoWorld = worldOf(q.get("repo"), views) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Could not find repo: \(q.text("repo"))")
      }
      let all = try HarnessRepo.listCollection(repoWorld, q.text("collection"))
      let page = Views.pageOf(all, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json(FakeAgent.page("records", try FakeAgent.encode(page.rows), page.cursor))

    case "com.atproto.sync.getBlob":
      guard let did = q.get("did"), let repoWorld = views.world(did),
        let blob = HarnessRepo.readBlob(repoWorld, q.text("cid"))
      else {
        return FakeNetwork.xrpcError(400, "BlobNotFound", "Blob not found")
      }
      // `{ 'Content-Type': blob.mimeType }`: a blob kept without one says "undefined".
      return FakeNetwork.bytes(blob.bytes, blob.mimeType ?? "undefined")

    default:
      return nil
    }
  }

  // MARK: Constellation

  /// The kinds of engagement, in the order `Object.entries` walks them.
  enum Engagement: CaseIterable {
    case like, repost, reply, threadReply, quote

    func of(_ by: CrowdEngagers) -> [String] {
      switch self {
      case .like: return by.like
      case .repost: return by.repost
      case .reply: return by.reply
      case .threadReply: return by.threadReply
      case .quote: return by.quote
      }
    }

    /// Where `/links/all` lists it: the collection and the path.
    var link: (collection: String, path: String) {
      switch self {
      case .like: return ("app.bsky.feed.like", ".subject.uri")
      case .repost: return ("app.bsky.feed.repost", ".subject.uri")
      case .reply: return ("app.bsky.feed.post", ".reply.parent.uri")
      case .threadReply: return ("app.bsky.feed.post", ".reply.root.uri")
      case .quote: return ("app.bsky.feed.post", ".embed.record.uri")
      }
    }

    /// The `source` getBacklinks names it by.
    var source: String { "\(link.collection):\(link.path.jsSlice(1))" }
  }

  func constellation(_ url: WebURL, _ method: String, _ q: SearchParams) throws -> HTTPResponse? {
    let views = world.views
    let crowd = views.crowd
    // Everything pointing at one of the accounts' posts, for a scan: the
    // crowd, as `/links/all` lists its sources.
    if url.pathname == "/links/all" {
      let by = crowd.engagersOf(q.text("target"))
      var links: [String: JSONValue] = [:]
      for kind in Engagement.allCases {
        let dids = kind.of(by)
        let (collection, path) = kind.link
        if dids.isEmpty { continue }
        var paths = links[collection]?.objectValue ?? [:]
        paths[path] = ["records": .number(Double(dids.count)), "distinct_dids": .number(Double(dids.count))]
        links[collection] = .object(paths)
      }
      return FakeNetwork.json(["links": .object(links)])
    }
    let subject = q.get("subject")
    let source = q.get("source")
    if let source, let kind = Engagement.allCases.first(where: { $0.source.jsEquals(source) }),
      q.text("subject").jsHasPrefix("at://"), method == "blue.microcosm.links.getBacklinks"
    {
      let collection = source.jsSplit(":")[0]
      let target = q.text("subject")
      let base = JSDate.parse("2026-01-01", timeZone: .gmt)
      let all: [JSONValue] = try kind.of(crowd.engagersOf(target)).enumerated().map { i, did in
        let at = base + Double(World.hashOf("\(target)\(did)")).truncatingRemainder(dividingBy: 9e9)
        return ["did": .string(did), "collection": .string(collection), "rkey": .string(try World.tidAt(at, Double(i)))]
      }
      let page = Views.pageOf(all, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json([
        "total": .number(Double(all.count)), "records": .array(page.rows), "cursor": page.cursor.map(JSONValue.string) ?? .null,
      ])
    }
    let worlds = views.worlds
    let subjectWorld = subject.flatMap { views.world($0) }
    guard
      let fallback = subjectWorld
        ?? worlds.first(where: { w in w.lists.contains { Optional($0.uri).jsEquals(subject) } }) ?? worlds.first
    else { return nil }
    func backlinks() throws -> [JSONValue] {
      if source == "app.bsky.graph.block:subject" { return try FakeAgent.encode(subjectWorld?.blockers ?? []).arrayValue ?? [] }
      if source == "app.bsky.graph.listblock:subject" {
        let list = fallback.lists.first { Optional($0.uri).jsEquals(subject) }
        return try FakeAgent.encode(list?.subscribers ?? []).arrayValue ?? []
      }
      return []
    }
    switch method {
    case "blue.microcosm.links.getBacklinks":
      let all = try backlinks()
      let page = Views.pageOf(all, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json([
        "total": .number(Double(all.count)), "records": .array(page.rows), "cursor": page.cursor.map(JSONValue.string) ?? .null,
      ])
    case "blue.microcosm.links.getBacklinksCount":
      return FakeNetwork.json(["total": .number(Double(try backlinks().count))])
    case "blue.microcosm.links.getManyToMany":
      let all: [JSONValue] = try (subjectWorld ?? fallback).lists.map { l in
        ["linkRecord": try JSONValue(encoding: l.item), "otherSubject": .string(l.uri)]
      }
      let page = Views.pageOf(all, limit: q.value("limit"), cursor: q.value("cursor"))
      return FakeNetwork.json(["items": .array(page.rows), "cursor": page.cursor.map(JSONValue.string) ?? .null])
    default:
      return nil
    }
  }

  // MARK: Bluesky's video service

  func video(_ request: HTTPRequest, _ q: SearchParams, _ method: String) throws -> HTTPResponse? {
    let token = FakeXrpc.readServiceToken(request.headers.get("authorization"))
    let nowSec = (now() / 1000).rounded(.down)
    func refuse(_ message: String) -> HTTPResponse { FakeNetwork.xrpcError(401, "AuthRequired", message) }
    // `token.exp < nowSec`, as JavaScript compares.
    guard let token, token.isTruthy, !(token["exp"].jsNumber < nowSec) else {
      return refuse("A service-auth token is required")
    }
    func claim(_ key: String) -> String? { token[key]?.stringValue }
    switch method {
    case "app.bsky.video.getUploadLimits":
      if !claim("aud").jsEquals(FakeNetwork.videoDid) || !claim("lxm").jsEquals(method) {
        return refuse("This token is not for the video service")
      }
      return FakeNetwork.json(["canUpload": true, "remainingDailyVideos": 24, "remainingDailyBytes": 9_500_000_000])

    case "app.bsky.video.getJobStatus":
      if !claim("aud").jsEquals(FakeNetwork.videoDid) || !claim("lxm").jsEquals(method) {
        return refuse("This token is not for the video service")
      }
      guard let id = q.get("jobId"), let job = videoJobs.withLock({ $0[JSKey(id)] }) else {
        return FakeNetwork.xrpcError(400, "InvalidRequest", "Job not found")
      }
      let progress = JSMath.min(100, ((now() - job.started) / videoProcessingMs * 100).jsRounded)
      let status: JSONValue =
        progress >= 100
        ? ["jobId": .string(id), "did": .string(job.did), "state": "JOB_STATE_COMPLETED", "progress": 100, "blob": job.blob]
        : ["jobId": .string(id), "did": .string(job.did), "state": "JOB_STATE_ENCODING", "progress": JSONValue.jsNumber(progress)]
      return FakeNetwork.json(["jobStatus": status])

    case "app.bsky.video.uploadVideo":
      // The service writes the blob to the account's PDS with this token.
      if !claim("aud").jsEquals("did:web:\(FakeNetwork.pdsHost)")
        || !claim("lxm").jsEquals("com.atproto.repo.uploadBlob")
      {
        return refuse("The upload token has to be addressed to the account’s PDS for com.atproto.repo.uploadBlob")
      }
      let did = q.get("did")
      guard let did, world.views.world(did) != nil, claim("iss").jsEquals(did), token["iss"]?.stringValue != nil
      else {
        return refuse("The upload token is for another account")
      }
      if (q.get("name") ?? "").isEmpty { return FakeNetwork.xrpcError(400, "InvalidRequest", "name is required") }
      let type = request.headers.get("content-type") ?? "video/mp4"
      let bytes = [UInt8](request.body ?? Data())
      if bytes.isEmpty { return FakeNetwork.xrpcError(400, "InvalidRequest", "The upload was empty") }
      let blob = try world.storeBlob(did: did, bytes: bytes, mimeType: type.isEmpty ? "video/mp4" : type)
      let link = blob["ref"]?["$link"]?.stringValue ?? ""
      let jobId = "harness-\(link.jsSlice(-16))"
      let started = now()
      let existed = videoJobs.withLock { jobs -> Bool in
        if jobs[JSKey(jobId)] != nil { return true }
        jobs[JSKey(jobId)] = VideoJob(did: did, blob: blob, started: started)
        return false
      }
      if existed {
        return FakeNetwork.json(
          ["jobId": .string(jobId), "did": .string(did), "state": "JOB_STATE_COMPLETED", "error": "already_exists", "blob": blob],
          409)
      }
      return FakeNetwork.json([
        "jobStatus": ["jobId": .string(jobId), "did": .string(did), "state": "JOB_STATE_CREATED", "progress": 0]
      ])

    default:
      return nil
    }
  }
}

extension String {
  fileprivate func jsHasSuffixUnits(_ suffix: String) -> Bool {
    let a = Array(utf16)
    let b = Array(suffix.utf16)
    return a.count >= b.count && Array(a.suffix(b.count)) == b
  }
}

/// The network the demo runs on (`installFakeNetwork`'s fetch), as an
/// HTTPTransport: each request waits the latency, then the router answers
/// it; a request to any other host is refused, and fails as a network
/// failure (`harness: no fixture for <host>`), noted in `refused`.
///
/// The calls Virga's server forwards to an account's agent
/// (/api/oauth/proxy, /api/oauth/upload-blob) take the agent's own
/// latency instead (writes four times as long), as the web's pages,
/// which call their agents directly, wait it.
public final class DemoTransport: HTTPTransport, Sendable {
  public let router: DemoRouter
  public let latency: Double
  let clock: NetworkClock
  private let refusedRequests = Locked<[HTTPRequest]>([])

  public init(router: DemoRouter, latency: Double = 60, clock: NetworkClock = .live) {
    self.router = router
    self.latency = latency
    self.clock = clock
  }

  /// A router over `world` (and `server`, when given), at the clock's now.
  public convenience init(
    world: DemoWorld, server: DemoServer? = nil, latency: Double = 60, clock: NetworkClock = .live,
    videoProcessingMs: Double = 4000
  ) {
    self.init(
      router: DemoRouter(world: world, server: server, now: clock.now, videoProcessingMs: videoProcessingMs), latency: latency,
      clock: clock)
  }

  public var world: DemoWorld { router.world }

  /// The requests refused, in order.
  public var refused: [HTTPRequest] { refusedRequests.wrappedValue }

  func isForwarded(_ request: HTTPRequest) -> Bool {
    guard router.server != nil, let url = try? WebURL(request.url), url.origin == FakeServer.serverOrigin else { return false }
    return url.pathname == BackendClient.BackendPaths.proxy || url.pathname == BackendClient.BackendPaths.uploadBlob
  }

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    try Task.checkCancellation()
    if latency > 0 && !isForwarded(request) { await clock.sleep(latency) }
    try Task.checkCancellation()
    if var answer = try await router.route(request) {
      if answer.url.isEmpty { answer.url = request.url }
      return answer
    }
    refusedRequests.withLock { $0.append(request) }
    let host = (try? WebURL(request.url, base: "http://harness.invalid").hostWithPort) ?? request.url
    throw HTTPTransportError.network("harness: no fixture for \(host)")
  }
}
