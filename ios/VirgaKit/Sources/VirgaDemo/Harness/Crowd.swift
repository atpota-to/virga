// Ports harness/crowd.js
//
// Who piles onto a post, for Defense's scans. Everything here is derived,
// without the worlds' random number generators, from the worlds and a hash
// of each post's address, so the same post meets the same crowd every time
// and adding this moved nothing else the worlds draw.
//
// A post of Mira's is engaged with by as many accounts as its counts say (up
// to a cap per kind, which a real Constellation also pages through): a few
// of the cast she follows, a few she doesn't, some of her followers, and a
// crowd of strangers, more of them in the replies and quotes, where a pile-on
// happens. Among the strangers a few are widely followed, a few are followed
// by one or more of the people Mira follows, and a few block her.
//
// Vouches ("how many of the people you follow follow them") are worked out
// for whoever is asking: the cast follow one another along a fixed hash, and
// a stranger's count is set as seen by Mira, so Field Lab, who follows a
// dozen of the cast, sees smaller counts and no stranger counted at all.

import Foundation
import VirgaCore

public enum Crowd {
  static let crowdSize = 1200
  /// The most records of one kind a post gives out: enough for the runaway post to page.
  static let capLike = 1800
  static let capRepost = 400
  static let capReply = 320
  static let capThreadReply = 60
  static let capQuote = 160

  static let first = [
    "Ash", "Bree", "Cole", "Dara", "Eli", "Faye", "Gus", "Hollis", "Ivo", "Jem", "Kit", "Lark", "Moss", "Nell",
    "Ode", "Pip", "Quill", "Rue", "Sol", "Tam",
  ]

  /// The i-th stranger: a DID, a handle under example.net, counts drawn from a hash.
  static func stranger(_ i: Int) -> CrowdStranger {
    let did = "did:plc:virgaharnesscrowd\(String.zeroPadded(i, 5))"
    let h = World.hashOf(did)
    let notable = i % 97 == 3 || i % 211 == 17
    let reachy = i % 113 == 11
    let followers = notable ? 12_000 + (h % 80_000) : reachy ? 6_000 + (h % 3_000) : h % 900
    let ageDays = 20 + (h % 1400)
    let firstName = first[h % first.count]
    let initial = String(UnicodeScalar(UInt8(65 + (h % 26))))
    return CrowdStranger(
      did: did,
      handle: "\(firstName.jsLowercased())\(i).crowd.example.net",
      // Some never set a name, as everywhere.
      displayName: i % 5 == 2 ? "" : "\(firstName) \(initial).",
      avatar: "",
      followersCount: followers,
      followsCount: 40 + (h % 700),
      // A handful post all day long.
      postsCount: i % 53 == 9 ? ageDays * 30 : Int((Double(ageDays) * (Double(h % 40) / 10)).rounded(.down)),
      ageDays: ageDays,
      // As Mira sees them: how many of the people she follows follow them.
      knownByMira: i % 89 == 7 ? 3 + (h % 4) : i % 41 == 5 || reachy ? 1 : i % 67 == 30 ? 2 : 0,
      blocksMira: i % 61 == 13
    )
  }

  /// Whether one of the cast follows another account. Fixed, so vouches are
  /// the same every time.
  public static func castFollows(_ fromDid: String, _ toDid: String) -> Bool {
    !fromDid.jsEquals(toDid) && World.hashOf("\(fromDid)>\(toDid)") % 4 == 0
  }

  /// The crowd around these worlds (the first one's `now` dates the
  /// strangers' profiles). Keep the result for as long as the web keeps its
  /// crowd: who has engaged with a post, and whom an account follows as the
  /// crowd first saw it, are worked out once and kept, as the web keeps them.
  public static func createCrowd(_ worlds: [AccountWorld]) -> DemoCrowd {
    DemoCrowd(core: CrowdCore(worlds), worlds: worlds)
  }
}

/// One of the 1,200 strangers in the crowd.
public struct CrowdStranger: Codable, Hashable, Sendable {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String
  public var followersCount: Int
  public var followsCount: Int
  public var postsCount: Int
  public var ageDays: Int
  /// As Mira sees them: how many of the people she follows follow them.
  public var knownByMira: Int
  public var blocksMira: Bool
}

/// Everyone who engaged with a post, by kind, as DIDs.
public struct CrowdEngagers: Codable, Hashable, Sendable {
  public var like: [String] = []
  public var repost: [String] = []
  public var reply: [String] = []
  public var threadReply: [String] = []
  public var quote: [String] = []

  public init() {}
}

/// What the crowd works out once: the strangers, whose followers are whose,
/// and the caches the web keeps (each account as the crowd first saw it,
/// each post's engagers).
final class CrowdCore: Sendable {
  struct Viewer: Sendable {
    var follows: Set<JSKey>
    var followers: Set<JSKey>
    /// The cast the account follows, in the order it followed them.
    var castFollows: [String]
  }

  let strangerList: [CrowdStranger]
  let strangerDids: [String]
  let strangers: [JSKey: CrowdStranger]
  let castDids: Set<JSKey>
  let followerRows: [JSKey: WorldFollower]
  /// The first world's `now` and cast (`list[0]`).
  let firstNow: Double
  let firstCast: [WorldPerson]
  let viewers = Locked<[JSKey: Viewer]>([:])
  let engaged = Locked<[JSKey: CrowdEngagers]>([:])
  /// Each world's followers outside the cast, as DIDs (followers never change).
  let fans = Locked<[JSKey: [String]]>([:])

  init(_ worlds: [AccountWorld]) {
    strangerList = (0..<Crowd.crowdSize).map(Crowd.stranger)
    strangerDids = strangerList.map(\.did)
    var byDid: [JSKey: CrowdStranger] = [:]
    for s in strangerList { byDid[JSKey(s.did)] = s }
    strangers = byDid
    castDids = Set(worlds.flatMap { $0.cast.map { JSKey($0.did) } })
    var rows: [JSKey: WorldFollower] = [:]
    for w in worlds {
      for f in w.followers where rows[JSKey(f.did)] == nil { rows[JSKey(f.did)] = f }
    }
    followerRows = rows
    firstNow = worlds.first?.now ?? .nan
    firstCast = worlds.first?.cast ?? []
  }

  /// `new Set(world.follows.map((r) => r.value.subject))`, the string ones in order.
  static func followsOf(_ world: AccountWorld) -> [String] {
    var seen = JSOrderedSet()
    for row in world.follows {
      if let subject = row.value["subject"]?.stringValue { seen.add(subject) }
    }
    return seen.elements
  }

  func viewerOf(_ world: AccountWorld) -> Viewer {
    let key = JSKey(world.me.did)
    if let cached = viewers.withLock({ $0[key] }) { return cached }
    let follows = Self.followsOf(world)
    let viewer = Viewer(
      follows: Set(follows.map(JSKey.init)),
      followers: Set(world.followers.map { JSKey($0.did) }),
      castFollows: follows.filter { castDids.contains(JSKey($0)) }
    )
    return viewers.withLock { cache in
      if let raced = cache[key] { return raced }
      cache[key] = viewer
      return viewer
    }
  }

  func fansOf(_ world: AccountWorld) -> [String] {
    let key = JSKey(world.me.did)
    if let cached = fans.withLock({ $0[key] }) { return cached }
    let list = world.followers.filter { !castDids.contains(JSKey($0.did)) }.map(\.did)
    fans.withLock { $0[key] = list }
    return list
  }
}

/// harness/crowd.js's `createCrowd(worlds)`: profiles of the strangers and
/// followers, profiles as an account sees them, relationships, vouches, and
/// the crowd on each post. A value over the worlds as they are now; the
/// caches are shared by every copy (`with(worlds:)` after a write, as the
/// web's crowd reads its live worlds).
public struct DemoCrowd: Sendable {
  let core: CrowdCore
  /// The worlds as they are now (`list`).
  public var worlds: [AccountWorld]

  init(core: CrowdCore, worlds: [AccountWorld]) {
    self.core = core
    self.worlds = worlds
  }

  /// The same crowd over the worlds as they are now.
  public func with(worlds: [AccountWorld]) -> DemoCrowd {
    DemoCrowd(core: core, worlds: worlds)
  }

  /// The strangers, in order (the web's `strangers` Map's values).
  public var strangers: [CrowdStranger] { core.strangerList }

  /// `strangers.get(did)`.
  public func stranger(_ did: String) -> CrowdStranger? { core.strangers[JSKey(did)] }

  /// A stranger's or a follower's profile, as the public AppView gives it,
  /// or nil.
  public func profile(_ did: String) -> JSONValue? {
    if let s = core.strangers[JSKey(did)] { return publicView(s) }
    if let f = core.followerRows[JSKey(did)], !core.castDids.contains(JSKey(did)) {
      let h = World.hashOf(did)
      return [
        "did": .string(did),
        "handle": .string(f.handle),
        "displayName": .string(f.displayName),
        "avatar": .string(f.avatar),
        "followersCount": .number(Double(h % 400)),
        "followsCount": .number(Double(50 + (h % 300))),
        "postsCount": .number(Double(h % 900)),
        "createdAt": .string(World.iso(1_672_531_200_000 + Double(h % 600) * 86_400_000)),
      ]
    }
    return nil
  }

  func publicView(_ s: CrowdStranger) -> JSONValue {
    [
      "did": .string(s.did),
      "handle": .string(s.handle),
      "displayName": .string(s.displayName),
      "avatar": .string(s.avatar),
      "followersCount": .number(Double(s.followersCount)),
      "followsCount": .number(Double(s.followsCount)),
      "postsCount": .number(Double(s.postsCount)),
      "createdAt": .string(World.iso(core.firstNow - Double(s.ageDays) * 86_400_000)),
    ]
  }

  /// How many of the accounts `viewer` follows follow `did`: the cast along
  /// castFollows, a stranger as set for Mira (and nobody else), a follower
  /// of Mira's now and then one.
  public func knownCount(_ viewer: AccountWorld, _ did: String) -> Int {
    if let s = core.strangers[JSKey(did)] { return viewer.me.did.jsEquals(World.me.did) ? s.knownByMira : 0 }
    let theirs = core.viewerOf(viewer).castFollows
    if core.castDids.contains(JSKey(did))
      || viewer.follows.contains(where: { $0.value["subject"]?.stringValue?.jsEquals(did) == true })
    {
      return theirs.filter { Crowd.castFollows($0, did) }.count
    }
    if core.followerRows[JSKey(did)] != nil { return World.hashOf(did) % 13 == 0 ? 1 : 0 }
    return 0
  }

  /// Up to five of the people `viewer` follows who follow `did`, as cards.
  func knownSample(_ viewer: AccountWorld, _ did: String, _ n: Int) -> [JSONValue] {
    let theirs = core.viewerOf(viewer).castFollows
    let cards = Array(theirs.filter { Crowd.castFollows($0, did) }.prefix(5))
    let padCount = Swift.max(0, Swift.min(5, n) - cards.count)
    let pad = (0..<padCount).compactMap { i in i < theirs.count ? theirs[i] : nil }
    return (cards + pad).prefix(Swift.min(5, n)).map { d in
      let p = core.firstCast.first { $0.did.jsEquals(d) }
      return [
        "did": .string(d),
        "handle": .string(p.map(\.handle).flatMap { $0.isEmpty ? nil : $0 } ?? "handle.invalid"),
        "displayName": .string(p?.displayName ?? ""),
        "avatar": .string(p?.avatar ?? ""),
      ]
    }
  }

  /// A profile as `viewer` sees it, signed in: the public view, a full one
  /// for the cast, and `viewer` with following, followedBy, blockedBy and
  /// knownFollowers. `card` is what the caller already has for the cast.
  public func profileAs(_ viewer: AccountWorld, _ did: String, card: JSONValue? = nil) -> JSONValue? {
    var base: [String: JSONValue]
    if let found = profile(did), case .object(let members) = found {
      base = members
    } else if let card, card.isTruthy {
      let h = World.hashOf(did)
      base = card.jsSpread
      base["followersCount"] = .number(Double(60 + (h % 2400)))
      base["followsCount"] = .number(Double(80 + (h % 500)))
      base["postsCount"] = .number(Double(120 + (h % 4000)))
      base["createdAt"] = .string(World.iso(viewer.start - Double(h % 700) * 86_400_000))
    } else {
      return nil
    }
    let seen = core.viewerOf(viewer)
    let n = knownCount(viewer, did)
    var v: [String: JSONValue] = [:]
    if seen.follows.contains(JSKey(did)) {
      v["following"] = .string("at://\(viewer.me.did)/app.bsky.graph.follow/\(Self.base36(World.hashOf(did)))")
    }
    if seen.followers.contains(JSKey(did)) {
      v["followedBy"] = .string("at://\(did)/app.bsky.graph.follow/\(Self.base36(World.hashOf("\(did)!")))")
    }
    if core.strangers[JSKey(did)]?.blocksMira == true && viewer.me.did.jsEquals(World.me.did) {
      v["blockedBy"] = true
    }
    if n > 0 {
      v["knownFollowers"] = ["count": .number(Double(n)), "followers": .array(knownSample(viewer, did, n))]
    }
    base["viewer"] = .object(v)
    return .object(base)
  }

  /// `(h % 1e9).toString(36)`.
  static func base36(_ h: Int) -> String { String(h % 1_000_000_000, radix: 36) }

  /// Who follows whom, for the public getRelationships.
  public func relationship(_ actorWorld: AccountWorld, _ did: String) -> JSONValue {
    let seen = core.viewerOf(actorWorld)
    var out: [String: JSONValue] = ["$type": "app.bsky.graph.defs#relationship", "did": .string(did)]
    if seen.follows.contains(JSKey(did)) {
      out["following"] = .string("at://\(actorWorld.me.did)/app.bsky.graph.follow/\(Self.base36(World.hashOf(did)))")
    }
    if seen.followers.contains(JSKey(did)) {
      out["followedBy"] = .string("at://\(did)/app.bsky.graph.follow/\(Self.base36(World.hashOf("\(did)!")))")
    }
    return .object(out)
  }

  /// Everyone who engaged with one of a world's posts, by kind. Empty for a
  /// post that isn't one of a world's own. Worked out once per address and
  /// kept.
  public func engagersOf(_ uri: String) -> CrowdEngagers {
    let key = JSKey(uri)
    if let cached = core.engaged.withLock({ $0[key] }) { return cached }
    let out = computeEngagers(uri)
    return core.engaged.withLock { cache in
      if let raced = cache[key] { return raced }
      cache[key] = out
      return out
    }
  }

  private func computeEngagers(_ uri: String) -> CrowdEngagers {
    let pieces = uri.jsSplit("/")
    let did = pieces.count > 2 ? pieces[2] : nil
    let collection = pieces.count > 3 ? pieces[3] : nil
    let rkey = pieces.count > 4 ? pieces[4] : nil
    var out = CrowdEngagers()
    guard let did, let rkey, let world = worlds.first(where: { $0.me.did.jsEquals(did) }),
      collection?.jsEquals("app.bsky.feed.post") == true,
      let post = world.posts.first(where: { $0.rkey.jsEquals(rkey) })
    else { return out }
    var rand = World.mulberry(Double(World.hashOf(uri)))
    let follows = Set(CrowdCore.followsOf(world).map(JSKey.init))
    let followed = world.cast.filter { follows.contains(JSKey($0.did)) }
    let notFollowed = world.cast.filter { !follows.contains(JSKey($0.did)) }
    let fanDids = core.fansOf(world)
    func pickFrom(_ pool: [String]) -> String {
      pool[Int((rand() * Double(pool.count)).rounded(.down))]
    }
    let followedDids = followed.map(\.did)
    let notFollowedDids = notFollowed.map(\.did)
    let strangerDids = core.strangerDids
    /// One engager: the loud kinds lean on strangers, as a pile-on does.
    func someone(_ loud: Bool) -> String {
      let r = rand()
      if r < (loud ? 0.03 : 0.06) && !followedDids.isEmpty { return pickFrom(followedDids) }
      if r < (loud ? 0.05 : 0.09) && !notFollowedDids.isEmpty { return pickFrom(notFollowedDids) }
      if r < (loud ? 0.1 : 0.2) && !fanDids.isEmpty { return pickFrom(fanDids) }
      return pickFrom(strangerDids)
    }
    let wantReply = Swift.min(Crowd.capReply, post.replies)
    let kinds: [(WritableKeyPath<CrowdEngagers, [String]>, Int, Bool)] = [
      (\.like, Swift.min(Crowd.capLike, post.likes), false),
      (\.repost, Swift.min(Crowd.capRepost, post.reposts), false),
      (\.reply, wantReply, true),
      (\.threadReply, Swift.min(Crowd.capThreadReply, wantReply / 5), true),
      (\.quote, Swift.min(Crowd.capQuote, post.quotes), true),
    ]
    for (path, want, loud) in kinds {
      var seen = Set<JSKey>()
      var tries = 0
      while out[keyPath: path].count < want && tries < want * 4 {
        let d = someone(loud)
        if !d.isEmpty && !seen.contains(JSKey(d)) && !d.jsEquals(world.me.did) {
          seen.insert(JSKey(d))
          out[keyPath: path].append(d)
        }
        tries += 1
      }
    }
    return out
  }
}
