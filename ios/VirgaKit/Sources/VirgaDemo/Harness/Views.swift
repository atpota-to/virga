// Ports harness/views.js
//
// What the AppView says about posts, feeds, lists and people, built from the
// worlds (World) and what has been written to them since (HarnessRepo).
// Shared by the public routes and the signed-in reads of the fake network,
// so a post looks the same from both.
//
// Everyone in the cast has posts too, made up on demand: any
// `at://<someone in the cast>/app.bsky.feed.post/<tid>` is a post with a
// line of text, dated by its record key. That is what bookmarks, quotes and
// search results point at.
//
// Views are JSON (JSONValue), in exactly the shapes the harness answers
// with, since that is what a fake network serves; decode them into
// VirgaCore's lexicon models (PostView, ProfileViewDetailed, …) where a
// typed value is wanted (DemoViews+Models.swift).
//
// Where the web reads the clock (`Date.now()`) the port takes `now`.

import Foundation
import VirgaCore

public enum Views {
  static let minute: Double = 60_000
  static let day: Double = 86_400_000

  static let castPosts = [
    "Planted the last of the garlic before the frost. Fingers crossed.",
    "Our street finally got its second bench. People are already arguing about the view.",
    "Reading group meets Tuesday. We are halfway through and nobody has finished.",
    "The tool library now has a ladder tall enough for the gutters. Book early.",
    "Photographed a heron, which then stood very still for twenty minutes, mocking me.",
    "Question for gardeners: what do you do with forty green tomatoes in November?",
    "Wrote down every bus I missed this month. It was a short list, and a long one.",
    "New zine about local wildflowers is out. Free at the café while copies last.",
    "If anyone has a spare sourdough starter, I have jam to trade.",
    "Cycling club ride on Sunday, slow pace, cake at the end.",
    "The community fridge is full again. Thank you, whoever brought all the soup.",
    "Mapping the neighbourhood’s trees with the school. The kids are better at it than us.",
  ]

  /// One page of a list, with the cursor for the next.
  public struct Page<Row> {
    public var rows: [Row]
    public var cursor: String?
  }

  /// One page of a list: `limit` and `cursor` as a query string or a caller
  /// gives them (anything `Number()` reads; a missing one is nil).
  public static func pageOf<Row>(_ all: [Row], limit: JSONValue?, cursor: JSONValue?) -> Page<Row> {
    let parsedFrom = cursor.jsNumber
    let from = parsedFrom.isNaN || parsedFrom == 0 ? 0 : parsedFrom
    let parsedLimit = limit.jsNumber
    let size = JSMath.max(1, JSMath.min(100, parsedLimit.isNaN || parsedLimit == 0 ? 50 : parsedLimit))
    let rows = JSArray.slice(all, from, from + size)
    return Page(rows: rows, cursor: from + size < Double(all.count) ? JSNumber.format(from + size) : nil)
  }

  /// `pageOf` with numbers.
  public static func pageOf<Row>(_ all: [Row], limit: Int?, cursor: String?) -> Page<Row> {
    pageOf(all, limit: limit.map { .number(Double($0)) }, cursor: cursor.map(JSONValue.string))
  }

  static func b32Index(_ unit: UInt16) -> UInt64? {
    switch unit {
    case 0x32...0x37: return UInt64(unit - 0x32)  // 2–7
    case 0x61...0x7A: return UInt64(unit - 0x61 + 6)  // a–z
    default: return nil
    }
  }

  /// When a TID record key was minted (ms), or nil for a key that isn't one.
  public static func tidTime(_ rkey: String?) -> Double? {
    guard let rkey else { return nil }
    let units = Array(rkey.utf16)
    guard units.count == 13 else { return nil }
    var digits: [UInt64] = []
    for unit in units {
      guard let digit = b32Index(unit) else { return nil }
      digits.append(digit)
    }
    // n is 65 bits: the first digit's 5 bits above the other twelve's 60.
    var rest: UInt64 = 0
    for digit in digits.dropFirst() { rest = rest << 5 | digit }
    let shifted = digits[0] << 50 | rest >> 10
    return Double(shifted / 1000)
  }

  /// The counts a post written in the harness has picked up: a like every
  /// few minutes, now and then a reply or a repost, so timers with
  /// conditions and the Posted page have something to read. A fixture
  /// post's own counts otherwise. NaN where the post's time can't be read,
  /// as on the web (JSON carries it as null). A time without an offset is
  /// read in `timeZone`, as `Date.parse` reads it in the browser's zone.
  public static func liveCounts(_ post: WorldPost, now: Double, timeZone: TimeZone = .gmt) -> LiveCounts {
    guard let written = post.writtenAt, written != 0, !written.isNaN else {
      return LiveCounts(
        likes: Double(post.likes), reposts: Double(post.reposts), replies: Double(post.replies),
        quotes: Double(post.quotes))
    }
    let when = !post.at.isEmpty ? post.at : post.indexedAt
    let parsed = when.map { JSDate.parse($0, timeZone: timeZone) } ?? .nan
    let minutes = JSMath.max(0, (now - parsed) / minute)
    func floor(_ x: Double) -> Double { x.rounded(.down) }
    return LiveCounts(
      likes: JSMath.min(60, floor(minutes / 3)),
      reposts: JSMath.min(12, floor(minutes / 20)),
      replies: JSMath.min(20, floor(minutes / 15)),
      quotes: JSMath.min(4, floor(minutes / 60))
    )
  }

  /// `hashOf(seed)` for a seed of any kind, as the web's loop over
  /// `text.length` and `charCodeAt` treats it.
  static func hashOfSeed(_ seed: JSONValue) throws -> Int {
    switch seed {
    case .string(let text): return World.hashOf(text)
    case .array(let items) where !items.isEmpty:
      throw HarnessJSError.typeError("text.charCodeAt is not a function")
    case .object(let members) where 0 < members["length"].jsNumber:
      throw HarnessJSError.typeError("text.charCodeAt is not a function")
    default: return 2_166_136_261  // no length: the loop never runs
    }
  }

  static func placeholderImage(_ seed: JSONValue) throws -> String {
    let hue = try hashOfSeed(seed) % 360
    let svg =
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 300\">"
      + "<rect width=\"400\" height=\"300\" fill=\"hsl(\(hue) 45% 82%)\"/>"
      + "<path d=\"M0 220 L120 140 L210 200 L290 120 L400 210 L400 300 L0 300 Z\" fill=\"hsl(\(hue) 35% 58%)\"/>"
      + "<circle cx=\"320\" cy=\"70\" r=\"28\" fill=\"hsl(\((hue + 40) % 360) 70% 90%)\"/></svg>"
    return "data:image/svg+xml,\(JSURI.encodeURIComponent(svg))"
  }

  /// The views over these worlds (`createViews`).
  ///
  /// - Parameter timeZone: the zone a written post's time is read in when
  ///   it carries no offset (`Date.parse` reads such a time in the
  ///   browser's zone); the app writes its times with `Z`, so the zone only
  ///   matters for a record written without one.
  public static func createViews(_ worlds: [AccountWorld], timeZone: TimeZone = .gmt) -> DemoViews {
    DemoViews(index: ViewsIndex(worlds), worlds: worlds, timeZone: timeZone)
  }

  /// `text.split(/\s+/)`: cut at every run of JavaScript whitespace, empty
  /// pieces at the ends kept.
  static func splitOnWhitespace(_ text: String) -> [String] {
    var pieces: [String] = []
    var current: [UInt16] = []
    var inRun = false
    for unit in text.utf16 {
      let isSpace = Unicode.Scalar(unit).map(JSWhitespace.contains) ?? false
      if isSpace {
        if !inRun {
          pieces.append(String(jsUnits: current))
          current = []
          inRun = true
        }
      } else {
        inRun = false
        current.append(unit)
      }
    }
    pieces.append(String(jsUnits: current))
    return pieces
  }

  /// `String(value || '')`.
  static func stringOrEmpty(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.jsString
  }

  /// `String(actor || '').replace(/^@/, '').toLowerCase()`.
  static func normalizeHandle(_ text: String?) -> String {
    var t = text ?? ""
    if t.jsHasPrefix("@") { t = t.jsSlice(1) }
    return t.jsLowercased()
  }
}

/// A post's counts as views show them (Double, since a post whose time
/// can't be read has NaN counts on the web).
public struct LiveCounts: Codable, Hashable, Sendable {
  public var likes: Double
  public var reposts: Double
  public var replies: Double
  public var quotes: Double

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(JSONValue.jsNumber(likes), forKey: .likes)
    try c.encode(JSONValue.jsNumber(reposts), forKey: .reposts)
    try c.encode(JSONValue.jsNumber(replies), forKey: .replies)
    try c.encode(JSONValue.jsNumber(quotes), forKey: .quotes)
  }
}

/// Who the views know by DID and handle: the cast and the follows outside
/// it of every world, then each account's profile. Fixed when the views
/// are made, as the web's maps are.
final class ViewsIndex: Sendable {
  struct Person: Sendable {
    var did: String
    var handle: String
    var displayName: String?
    var avatar: String?
  }

  /// `people`, in the web Map's order.
  let people: [Person]
  let peopleByDid: [JSKey: Person]
  let byHandle: [JSKey: Person]
  /// The accounts' DIDs (`byDid`'s keys).
  let accounts: Set<JSKey>
  let crowd: CrowdCore

  init(_ worlds: [AccountWorld]) {
    var order = JSOrderedMap<Person>()
    for w in worlds {
      for p in w.cast + w.followedOnly where !order.has(p.did) {
        order[p.did] = Person(did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar)
      }
    }
    for w in worlds {
      let p = w.profile
      order[w.me.did] = Person(did: p.did, handle: p.handle, displayName: p.displayName, avatar: p.avatar)
    }
    people = order.values
    var byDid: [JSKey: Person] = [:]
    for (key, person) in order.entries { byDid[JSKey(key)] = person }
    peopleByDid = byDid
    var handles: [JSKey: Person] = [:]
    for person in people { handles[JSKey(person.handle)] = person }
    byHandle = handles
    accounts = Set(worlds.map { JSKey($0.me.did) })
    crowd = CrowdCore(worlds)
  }
}

/// harness/views.js's `createViews(worlds)`: the AppView over the worlds as
/// they are now. A value; after a write, `with(worlds:)` gives the views
/// over the changed worlds (the people they know and the crowd's caches
/// stay, as the web's do).
public struct DemoViews: Sendable {
  let index: ViewsIndex
  /// The worlds as they are now (`worlds`).
  public var worlds: [AccountWorld]
  /// The local zone of the web's browser: where a written post's time
  /// without an offset is read (its live counts).
  public let timeZone: TimeZone

  init(index: ViewsIndex, worlds: [AccountWorld], timeZone: TimeZone = .gmt) {
    self.index = index
    self.worlds = worlds
    self.timeZone = timeZone
  }

  public func with(worlds: [AccountWorld]) -> DemoViews {
    DemoViews(index: index, worlds: worlds, timeZone: timeZone)
  }

  /// Who engages with the accounts' posts, for Defense's scans.
  public var crowd: DemoCrowd { DemoCrowd(core: index.crowd, worlds: worlds) }

  /// `byDid.get(did)`: an account's world.
  public func world(_ did: String) -> AccountWorld? {
    worlds.last { $0.me.did.jsEquals(did) }
  }

  /// A profile card (`{ did, handle, displayName, avatar }`), or a stand-in
  /// for someone nobody knows.
  public func card(_ did: String) -> JSONValue {
    guard let p = index.peopleByDid[JSKey(did)] else {
      return ["did": .string(did), "handle": "handle.invalid", "displayName": ""]
    }
    var out: [String: JSONValue] = ["did": .string(p.did), "handle": .string(p.handle)]
    if let name = p.displayName { out["displayName"] = .string(name) }
    if let avatar = p.avatar { out["avatar"] = .string(avatar) }
    return .object(out)
  }

  /// A person by DID or handle: the account's whole profile, the cast's
  /// card, or (by DID) one of the crowd or a follower, with their counts.
  public func person(_ actor: String?) -> JSONValue? {
    let p = actor.flatMap { index.peopleByDid[JSKey($0)] } ?? index.byHandle[JSKey(Views.normalizeHandle(actor))]
    guard let p else { return actor.flatMap { crowd.profile($0) } }
    if let w = world(p.did) { return try? JSONValue(encoding: w.profile) }
    return card(p.did)
  }

  public func resolveHandle(_ handle: String?) -> String? {
    index.byHandle[JSKey(Views.normalizeHandle(handle))]?.did
  }

  /* ---- posts ------------------------------------------------------- */

  func syntheticRecord(_ did: String, _ rkey: String) -> JSONValue? {
    guard let at = Views.tidTime(rkey) else { return nil }
    return [
      "$type": "app.bsky.feed.post",
      "text": .string(Views.castPosts[World.hashOf("\(did)/\(rkey)") % Views.castPosts.count]),
      "createdAt": .string(World.iso(at)),
      "langs": ["en"],
    ]
  }

  func syntheticView(_ did: String, _ rkey: String) -> JSONValue? {
    guard let record = syntheticRecord(did, rkey) else { return nil }
    let h = World.hashOf(rkey)
    return [
      "$type": "app.bsky.feed.defs#postView",
      "uri": .string("at://\(did)/app.bsky.feed.post/\(rkey)"),
      "cid": "bafyharness",
      "author": card(did),
      "record": record,
      "likeCount": .number(Double(h % 90)),
      "repostCount": .number(Double(h % 13)),
      "replyCount": .number(Double(h % 7)),
      "quoteCount": .number(Double(h % 3)),
      "indexedAt": record["createdAt"] ?? .null,
      "labels": [],
      "viewer": [:],
    ]
  }

  func gatesOf(_ world: AccountWorld, _ rkey: String) throws -> JSONValue? {
    guard let threadgate = try HarnessRepo.readRecord(world, "app.bsky.feed.threadgate", rkey) else { return nil }
    return ["uri": .string(threadgate.uri), "cid": .string(threadgate.cid), "record": threadgate.value, "lists": []]
  }

  func ownView(_ world: AccountWorld, _ p: WorldPost, now: Double, depth: Int = 0) throws -> JSONValue {
    let record = World.postRecord(p)
    let counts = Views.liveCounts(p, now: now, timeZone: timeZone)
    var view: [String: JSONValue] = [
      "$type": "app.bsky.feed.defs#postView",
      "uri": .string("at://\(world.me.did)/app.bsky.feed.post/\(p.rkey)"),
      "cid": .string(p.cid.flatMap { $0.isEmpty ? nil : $0 } ?? "bafyharness"),
      "author": card(world.me.did),
      "record": record,
      "likeCount": .jsNumber(counts.likes),
      "repostCount": .jsNumber(counts.reposts),
      "replyCount": .jsNumber(counts.replies),
      "quoteCount": .jsNumber(counts.quotes),
      "indexedAt": .string(p.indexedAt.flatMap { $0.isEmpty ? nil : $0 } ?? p.at),
      "labels": [],
      "viewer": [:],
    ]
    if let embed = record["embed"], embed.isTruthy, depth < 2,
      let shown = try embedView(embed, did: world.me.did, depth: depth + 1, now: now)
    {
      view["embed"] = shown
    }
    if let written = p.writtenAt, written != 0, !written.isNaN, let gate = try gatesOf(world, p.rkey) {
      view["threadgate"] = gate
    }
    return .object(view)
  }

  /// A post as the AppView would show it, or nil when there's no such post.
  public func postView(_ uri: String?, now: Double, depth: Int = 0) throws -> JSONValue? {
    try postView(uri: uri.map(JSONValue.string), now: now, depth: depth)
  }

  /// `postView` for a URI of any kind (`String(uri || '')` is what's read).
  func postView(uri: JSONValue?, now: Double, depth: Int) throws -> JSONValue? {
    guard let parsed = HarnessRepo.parseAtUri(Views.stringOrEmpty(uri)),
      parsed.collection.jsEquals("app.bsky.feed.post")
    else { return nil }
    if let world = world(parsed.did) {
      guard let p = world.posts.first(where: { $0.rkey.jsEquals(parsed.rkey) }) else { return nil }
      return try ownView(world, p, now: now, depth: depth)
    }
    return index.peopleByDid[JSKey(parsed.did)] != nil ? syntheticView(parsed.did, parsed.rkey) : nil
  }

  func imageView(_ img: JSONValue, _ did: String, _ i: Int) throws -> JSONValue {
    let cid = img["image"]?["ref"]?["$link"]
    var src: String? = nil
    if let cid, cid.isTruthy, case .string(let link) = cid, let world = world(did) {
      src = HarnessRepo.blobDataUrl(world, link)
    }
    let seedText: String
    if let cid, cid.isTruthy { seedText = cid.jsString } else { seedText = String(i) }
    let source = try src.flatMap { $0.isEmpty ? nil : $0 } ?? Views.placeholderImage(.string("\(did)\(seedText)"))
    var out: [String: JSONValue] = [
      "thumb": .string(source),
      "fullsize": .string(source),
      "alt": img["alt"].jsTruthy ?? "",
    ]
    if let ratio = img["aspectRatio"], ratio.isTruthy { out["aspectRatio"] = ratio }
    return .object(out)
  }

  static let notFound = "app.bsky.embed.record#viewNotFound"

  func notFoundView(_ uri: JSONValue?) -> JSONValue {
    var out: [String: JSONValue] = ["$type": .string(Self.notFound), "notFound": true]
    if let uri { out["uri"] = uri }
    return .object(out)
  }

  func recordView(_ ref: JSONValue?, _ depth: Int, now: Double) throws -> JSONValue {
    let uri = ref?["uri"]
    guard let parsed = HarnessRepo.parseAtUri(Views.stringOrEmpty(uri)) else { return notFoundView(uri) }
    if parsed.collection.jsEquals("app.bsky.feed.post") {
      guard let view = try postView(uri: uri, now: now, depth: depth) else { return notFoundView(uri) }
      var out: [String: JSONValue] = [
        "$type": "app.bsky.embed.record#viewRecord",
        "labels": [],
      ]
      for (from, to) in [
        ("uri", "uri"), ("cid", "cid"), ("author", "author"), ("record", "value"), ("likeCount", "likeCount"),
        ("repostCount", "repostCount"), ("replyCount", "replyCount"), ("quoteCount", "quoteCount"),
        ("indexedAt", "indexedAt"),
      ] {
        if let member = view[from] { out[to] = member }
      }
      if let embed = view["embed"], embed.isTruthy { out["embeds"] = [embed] }
      return .object(out)
    }
    if parsed.collection.jsEquals("app.bsky.feed.generator") {
      guard case .string(let text)? = uri, let g = generatorView(text), case .object(var members) = g else {
        return notFoundView(uri)
      }
      members["$type"] = "app.bsky.feed.defs#generatorView"
      return .object(members)
    }
    if parsed.collection.jsEquals("app.bsky.graph.list") {
      guard case .string(let text)? = uri, let l = listView(text, now: now), case .object(var members) = l else {
        return notFoundView(uri)
      }
      members["$type"] = "app.bsky.graph.defs#listView"
      return .object(members)
    }
    return notFoundView(uri)
  }

  /// `(list || []).map(…)`: a list that is there and isn't an array is the
  /// web's TypeError.
  static func listOf(_ value: JSONValue?, _ expression: String) throws -> [JSONValue] {
    guard let value, value.isTruthy else { return [] }
    guard case .array(let items) = value else {
      throw HarnessJSError.typeError("(\(expression) || []).map is not a function")
    }
    return items
  }

  /// A record's embed as its view, the shape getPosts hands back, or nil
  /// for one the AppView doesn't show.
  public func embedView(_ embed: JSONValue?, did: String, depth: Int = 1, now: Double) throws -> JSONValue? {
    guard let embed, embed.isTruthy, embed.objectValue != nil || embed.arrayValue != nil else { return nil }
    guard case .string(let type)? = embed["$type"] else { return nil }
    switch type {
    case "app.bsky.embed.images":
      let images = try Self.listOf(embed["images"], "embed.images")
      return [
        "$type": "app.bsky.embed.images#view",
        "images": .array(try images.enumerated().map { try imageView($1, did, $0) }),
      ]
    case "app.bsky.embed.gallery":
      let items = try Self.listOf(embed["items"], "embed.items")
      return [
        "$type": "app.bsky.embed.images#view",
        "images": .array(try items.enumerated().map { try imageView($1, did, $0) }),
      ]
    case "app.bsky.embed.video":
      let link = embed["video"]?["ref"]?["$link"]
      let cid: JSONValue = link.jsTruthy ?? "bafyharness"
      var out: [String: JSONValue] = [
        "$type": "app.bsky.embed.video#view",
        "cid": cid,
        "playlist": .string(
          "https://video.bsky.app/watch/\(JSURI.encodeURIComponent(did))/\(cid.jsString)/playlist.m3u8"),
        "thumbnail": .string(try Views.placeholderImage(cid)),
        "alt": embed["alt"].jsTruthy ?? "",
      ]
      if let ratio = embed["aspectRatio"], ratio.isTruthy { out["aspectRatio"] = ratio }
      return .object(out)
    case "app.bsky.embed.external":
      let ext = embed["external"].jsTruthy ?? [:]
      let cid = ext["thumb"]?["ref"]?["$link"]
      var thumb: String? = nil
      if let cid, cid.isTruthy {
        var fromBlob: String? = nil
        if case .string(let link) = cid, let world = world(did) { fromBlob = HarnessRepo.blobDataUrl(world, link) }
        thumb = try fromBlob.flatMap { $0.isEmpty ? nil : $0 } ?? Views.placeholderImage(cid)
      }
      var external: [String: JSONValue] = [
        "title": ext["title"].jsTruthy ?? "",
        "description": ext["description"].jsTruthy ?? "",
      ]
      if let uri = ext["uri"] { external["uri"] = uri }
      if let thumb, !thumb.isEmpty { external["thumb"] = .string(thumb) }
      return ["$type": "app.bsky.embed.external#view", "external": .object(external)]
    case "app.bsky.embed.record":
      return ["$type": "app.bsky.embed.record#view", "record": try recordView(embed["record"], depth, now: now)]
    case "app.bsky.embed.recordWithMedia":
      var out: [String: JSONValue] = [
        "$type": "app.bsky.embed.recordWithMedia#view",
        "record": [
          "$type": "app.bsky.embed.record#view",
          "record": try recordView(embed["record"]?["record"], depth, now: now),
        ],
      ]
      if let media = try embedView(embed["media"], did: did, depth: depth, now: now) { out["media"] = media }
      return .object(out)
    default:
      return nil
    }
  }

  /// The account's author feed, newest first, with now and then someone
  /// else's post reposted into it.
  public func authorFeed(_ world: AccountWorld, now: Double) throws -> [JSONValue] {
    let author = card(world.me.did)
    var out: [JSONValue] = []
    for (i, p) in world.posts.enumerated() {
      out.append(["post": try ownView(world, p, now: now)])
      let written = p.writtenAt.map { $0 != 0 && !$0.isNaN } ?? false
      if i % 37 != 5 || written { continue }
      let other = world.cast[i % world.cast.count]
      out.append([
        "post": [
          "uri": .string("at://\(other.did)/app.bsky.feed.post/\(p.rkey)"),
          "cid": "bafyharness",
          "author": card(other.did),
          "record": [
            "$type": "app.bsky.feed.post",
            "text": "Someone else’s post, reposted.",
            "createdAt": .string(p.at),
          ],
          "likeCount": 12,
          "repostCount": 3,
          "replyCount": 1,
          "quoteCount": 0,
        ],
        "reason": ["$type": "app.bsky.feed.defs#reasonRepost", "by": author, "indexedAt": .string(p.at)],
      ])
    }
    return out
  }

  /// getPostThread's `thread`, or nil for a post that isn't there.
  public func threadView(_ uri: String, depth: Int = 6, parentHeight: Int = 80, now: Double) throws -> JSONValue? {
    try threadView(uri: .string(uri), depth: depth, parentHeight: parentHeight, now: now)
  }

  func threadView(uri: JSONValue, depth: Int, parentHeight: Int, now: Double) throws -> JSONValue? {
    guard let post = try postView(uri: uri, now: now, depth: 0) else { return nil }
    var node: [String: JSONValue] = ["$type": "app.bsky.feed.defs#threadViewPost", "post": post, "replies": []]
    if let parsed = HarnessRepo.parseAtUri(Views.stringOrEmpty(uri)), let world = world(parsed.did), depth > 0 {
      var replies: [JSONValue] = []
      for p in world.posts {
        guard case .string(let parent)? = World.postRecord(p)["reply"]?["parent"]?["uri"],
          case .string(let asked) = uri, parent.jsEquals(asked)
        else { continue }
        // Replies go at most `depth` (6) deep, so recursing is safe.
        if let reply = try threadView(
          uri: .string("at://\(world.me.did)/app.bsky.feed.post/\(p.rkey)"), depth: depth - 1, parentHeight: 0,
          now: now)
        {
          replies.append(reply)
        }
      }
      node["replies"] = .array(replies.reversed())
    }
    // The parents, up to `parentHeight` (80) of them: the web recurses, one
    // call per parent with depth 0 (so no replies); walked here in a loop,
    // since 80 nested calls are too deep for a 512 KB thread.
    var chain: [[String: JSONValue]] = [node]
    var height = parentHeight
    var current = post
    while let parentUri = current["record"]?["reply"]?["parent"]?["uri"], parentUri.isTruthy, height > 0 {
      height -= 1
      guard let parent = try postView(uri: parentUri, now: now, depth: 0) else {
        chain[chain.count - 1]["parent"] = [
          "$type": "app.bsky.feed.defs#notFoundPost", "uri": parentUri, "notFound": true,
        ]
        break
      }
      chain.append(["$type": "app.bsky.feed.defs#threadViewPost", "post": parent, "replies": []])
      current = parent
    }
    var assembled = chain.removeLast()
    while var child = chain.popLast() {
      child["parent"] = .object(assembled)
      assembled = child
    }
    return .object(assembled)
  }

  /* ---- feeds and lists ---------------------------------------------- */

  public func generatorView(_ uri: String?) -> JSONValue? {
    guard let uri else { return nil }
    for w in worlds {
      if let f = w.feeds.first(where: { $0.uri.jsEquals(uri) }) {
        return [
          "uri": .string(f.uri),
          "cid": "bafyharness",
          "did": "did:web:feeds.harness.example",
          "creator": card(w.me.did),
          "displayName": .string(f.name),
          "description": .string(f.description),
          "likeCount": .number(Double(f.likeCount)),
          "indexedAt": .string(f.createdAt),
        ]
      }
    }
    return nil
  }

  public func listView(_ uri: String?, now: Double) -> JSONValue? {
    guard let uri else { return nil }
    for w in worlds {
      if let own = w.ownLists.first(where: { $0.uri.jsEquals(uri) }) {
        var out: [String: JSONValue] = [
          "uri": .string(own.uri),
          "cid": "bafyharness",
          "creator": card(w.me.did),
          "name": .string(own.name),
          "purpose": .string(own.purpose),
          "listItemCount": .number(Double(own.members.count)),
          "indexedAt": .string(own.createdAt),
        ]
        if !own.description.isEmpty { out["description"] = .string(own.description) }
        return .object(out)
      }
      if let theirs = w.lists.first(where: { $0.uri.jsEquals(uri) }) {
        let parsed = HarnessRepo.parseAtUri(uri)
        let owner = parsed?.did ?? ""
        let minted = Views.tidTime(parsed?.rkey) ?? 0
        return [
          "uri": .string(uri),
          "cid": "bafyharness",
          "creator": ["did": .string(owner), "handle": .string("\(owner.jsSlice(-6)).example.net"), "displayName": ""],
          "name": .string(theirs.name),
          "purpose": .string(theirs.purpose),
          "listItemCount": 40,
          "indexedAt": .string(World.iso(minted != 0 ? minted : now)),
        ]
      }
    }
    return nil
  }

  public func listMembers(_ uri: String) -> [JSONValue] {
    for w in worlds {
      if let own = w.ownLists.first(where: { $0.uri.jsEquals(uri) }) {
        let base = uri.jsReplacingFirst("app.bsky.graph.list", with: "app.bsky.graph.listitem")
        return own.members.enumerated().map { i, did in
          ["uri": .string("\(base)\(i)"), "subject": card(did)]
        }
      }
    }
    return []
  }

  /* ---- search --------------------------------------------------------- */

  /// Posts whose text has every word of `q`, newest first: the accounts'
  /// own and two of each cast member's.
  public func searchPosts(_ q: String?, now: Double) throws -> [JSONValue] {
    let words = Views.splitOnWhitespace((q ?? "").jsLowercased()).filter { !$0.isEmpty }
    if words.isEmpty { return [] }
    var views: [JSONValue] = []
    for w in worlds {
      for p in w.posts { views.append(try ownView(w, p, now: now)) }
    }
    for (i, p) in index.people.enumerated() {
      if index.accounts.contains(JSKey(p.did)) || !p.did.jsContains("cast") { continue }
      for k in 0..<2 {
        let rkey = World.tid(now - Double(i * 2 + k + 1) * Views.day * 0.7, 300 + i * 2 + k)
        if let view = syntheticView(p.did, rkey) { views.append(view) }
      }
    }
    return
      views
      .filter { v in
        let text = Views.stringOrEmpty(v["record"]?["text"]).jsLowercased()
        return words.allSatisfy { text.jsContains($0) }
      }
      .jsSorted { a, b in
        (a["indexedAt"]?.stringValue ?? "").jsLess(b["indexedAt"]?.stringValue ?? "") ? 1 : -1
      }
  }

  /// People whose handle or name starts with `q` (or has a word that
  /// does). `limit` as a caller gives it (nil is the default, 10).
  public func searchActors(_ q: String?, limit: JSONValue? = nil) -> [JSONValue] {
    let term = Views.normalizeHandle(q)
    if term.isEmpty { return [] }
    let matches = index.people.filter { p in
      p.handle.jsHasPrefix(term)
        || Views.splitOnWhitespace((p.displayName ?? "").jsLowercased()).contains { $0.jsHasPrefix(term) }
    }
    let end = limit.map { $0.jsNumber } ?? 10
    return JSArray.slice(matches, 0, end).map { card($0.did) }
  }
}
