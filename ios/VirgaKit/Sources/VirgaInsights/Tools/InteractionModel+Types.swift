// Ports src/tools/interactionModel.js
//
// What the Interaction lookup's functions return, with the web's field
// names (`isSelf` is the web's `self`). Each writes the web's JSON (`json`).

import Foundation
import VirgaArchive
import VirgaCore

/// A choice of the direction filter.
public struct InteractionDirection: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
}

/// A handle or a DID typed in full (`parseActorInput`).
public struct ActorInput: Codable, Hashable, Sendable {
  public enum Kind: String, Codable, Hashable, Sendable {
    case did, handle
  }

  public var kind: Kind
  public var value: String

  public var json: JSONValue { ["kind": .string(kind.rawValue), "value": .string(value)] }
}

/// How many events the archive holds with one account, each way.
public struct InteractionCount: Hashable, Sendable {
  public var did: String
  public var `in`: Int
  public var out: Int
  public var total: Int

  public var json: JSONValue {
    ["did": .string(did), "in": .number(Double(self.in)), "out": .number(Double(out)), "total": .number(Double(total))]
  }
}

/// `interactionIndex`: every account's counts (`byDid`, in the order first
/// met) and the same rows ranked, most events first.
public struct InteractionIndex: Hashable, Sendable {
  /// The DIDs in the order the archive first met them.
  public var order: [String]
  public var byDid: [JSKey: InteractionCount]
  public var ranked: [InteractionCount]

  /// `byDid.get(did)`.
  public func count(_ did: String) -> InteractionCount? { byDid[JSKey(did)] }

  public var json: JSONValue {
    var members: [String: JSONValue] = [:]
    for did in order { members[did] = byDid[JSKey(did)]?.json ?? .null }
    return ["byDid": .object(members), "ranked": .array(ranked.map(\.json))]
  }
}

/// One account the search can suggest.
public struct DirectoryPerson: Hashable, Sendable, Identifiable {
  public var did: String
  public var handle: String
  public var displayName: String
  public var avatar: String
  public var `in`: Int
  public var out: Int
  public var total: Int
  public var followsYou: Bool
  public var youFollow: Bool

  public var id: String { did }

  public init(
    did: String, handle: String, displayName: String, avatar: String, in: Int, out: Int, total: Int, followsYou: Bool,
    youFollow: Bool
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.in = `in`
    self.out = out
    self.total = total
    self.followsYou = followsYou
    self.youFollow = youFollow
  }

  public var json: JSONValue {
    [
      "did": .string(did), "handle": .string(handle), "displayName": .string(displayName), "avatar": .string(avatar),
      "in": .number(Double(self.in)), "out": .number(Double(out)), "total": .number(Double(total)),
      "followsYou": .bool(followsYou), "youFollow": .bool(youFollow),
    ]
  }
}

/// One event between the account and someone: `{ key, dir, kind, at, atMs,
/// uri, subject, url, urlOwner, text }`. `uri` is the record behind it,
/// `url` the post it can open on Bluesky and `urlOwner` whose post that is
/// ("them" or "you"); `text` is your own words, when the post is yours.
public struct InteractionEvent: Hashable, Sendable, Identifiable {
  public var key: String
  /// "in" or "out".
  public var dir: String
  public var kind: String
  public var at: String
  public var atMs: Double
  public var uri: String
  public var subject: String?
  public var url: String?
  public var urlOwner: String?
  public var text: String

  public var id: String { key }

  public init(
    key: String, dir: String, kind: String, at: String, atMs: Double, uri: String, subject: String? = nil,
    url: String? = nil, urlOwner: String? = nil, text: String = ""
  ) {
    self.key = key
    self.dir = dir
    self.kind = kind
    self.at = at
    self.atMs = atMs
    self.uri = uri
    self.subject = subject
    self.url = url
    self.urlOwner = urlOwner
    self.text = text
  }

  public var json: JSONValue {
    [
      "key": .string(key), "dir": .string(dir), "kind": .string(kind), "at": .string(at), "atMs": .number(atMs),
      "uri": .string(uri), "subject": ReportJSON.string(subject), "url": ReportJSON.string(url),
      "urlOwner": ReportJSON.string(urlOwner), "text": .string(text),
    ]
  }
}

/// A count of each kind (nil: not counted) and their total.
public struct KindTotals: Hashable, Sendable {
  public var like: Int?
  public var repost: Int?
  public var reply: Int?
  public var quote: Int?
  public var mention: Int?
  public var total: Int

  public var json: JSONValue {
    [
      "like": ReportJSON.number(like), "repost": ReportJSON.number(repost), "reply": ReportJSON.number(reply),
      "quote": ReportJSON.number(quote), "mention": ReportJSON.number(mention), "total": .number(Double(total)),
    ]
  }
}

/// A pair of one thing each way.
public struct BothWays<Value: Hashable & Sendable>: Hashable, Sendable {
  public var `in`: Value
  public var out: Value
}

/// Who follows whom, and whether they block you.
public struct InteractionRelationship: Hashable, Sendable {
  /// Someone the follower log says left: when it was noticed, the sync
  /// before (it happened in between) and when they had followed.
  public struct Left: Hashable, Sendable {
    public var noticedAt: Double?
    public var since: Double?
    public var followedAt: String?

    public var json: JSONValue {
      ["noticedAt": ReportJSON.number(noticedAt), "since": ReportJSON.number(since), "followedAt": ReportJSON.string(followedAt)]
    }
  }

  public struct TheyFollow: Hashable, Sendable {
    /// Whether the follower store has been read at all.
    public var known: Bool
    public var `is`: Bool
    public var since: String?
    public var left: Left?

    public var json: JSONValue {
      ["known": .bool(known), "is": .bool(self.is), "since": ReportJSON.string(since), "left": left?.json ?? .null]
    }
  }

  public struct YouFollow: Hashable, Sendable {
    public var known: Bool
    public var `is`: Bool
    public var since: String?

    public var json: JSONValue { ["known": .bool(known), "is": .bool(self.is), "since": ReportJSON.string(since)] }
  }

  public struct TheyBlock: Hashable, Sendable {
    public var since: String?
    public var direct: Bool
    public var list: Bool

    public var json: JSONValue { ["since": ReportJSON.string(since), "direct": .bool(direct), "list": .bool(list)] }
  }

  public var theyFollow: TheyFollow
  public var youFollow: YouFollow
  public var theyBlock: TheyBlock?

  public var json: JSONValue {
    ["theyFollow": theyFollow.json, "youFollow": youFollow.json, "theyBlock": theyBlock?.json ?? .null]
  }
}

/// Both directions by month; nil inbound values before the notifications begin.
public struct InteractionTimeline: Hashable, Sendable {
  public var unit: AnalyticsUnit
  public var inbound: [TrendPoint]
  public var outbound: [SeriesPoint]
  /// The first month with an inbound value, when it isn't the first drawn.
  public var inboundFromMs: Double?
  public var inboundCovered: Bool

  public var json: JSONValue {
    [
      "unit": .string(unit.rawValue), "inbound": ReportJSON.trend(inbound), "outbound": ReportJSON.series(outbound),
      "inboundFromMs": ReportJSON.number(inboundFromMs), "inboundCovered": .bool(inboundCovered),
    ]
  }
}

/// How far back each side of the archive can speak.
public struct InteractionCoverage: Hashable, Sendable {
  /// The oldest notification held, from anyone; nil: none on record.
  public var inboundSinceMs: Double?
  public var inboundTruncated: Bool
  /// How far back the likes and reposts reach when the repo couldn't be
  /// downloaded; nil means all of them.
  public var outboundSinceMs: Double?
  /// Whether the post archive has been read to the end.
  public var postsComplete: Bool

  public var json: JSONValue {
    [
      "inboundSinceMs": ReportJSON.number(inboundSinceMs), "inboundTruncated": .bool(inboundTruncated),
      "outboundSinceMs": ReportJSON.number(outboundSinceMs), "postsComplete": .bool(postsComplete),
    ]
  }
}

/// One of your posts and how often they engaged with it.
public struct EngagedPost: Hashable, Sendable {
  public var uri: String
  public var url: String?
  /// The post as the archive holds it, nil once it has left the archive.
  public var post: PostRow?
  public var total: Int
  /// Each kind and how many, in the order first met.
  public var byKind: [KindCount]
  public var latestMs: Double

  public var json: JSONValue {
    var kinds: [String: JSONValue] = [:]
    for k in byKind { kinds[k.kind] = .number(Double(k.count)) }
    return [
      "uri": .string(uri), "url": ReportJSON.string(url), "post": post?.json ?? .null, "total": .number(Double(total)),
      "byKind": .object(kinds), "latestMs": .number(latestMs),
    ]
  }
}

/// Which of your posts they engaged with.
public struct EngagedPosts: Hashable, Sendable {
  public var known: Bool
  public var counted: Int
  public var of: Int
  public var rows: [EngagedPost]

  public var json: JSONValue {
    ["known": .bool(known), "counted": .number(Double(counted)), "of": .number(Double(of)), "rows": .array(rows.map(\.json))]
  }
}

/// `interactionModel`: everything between the account and one other.
public struct Interaction: Hashable, Sendable {
  public var did: String
  /// The web's `self`: looking yourself up.
  public var isSelf: Bool
  public var relationship: InteractionRelationship
  public var totals: BothWays<KindTotals>
  public var first: BothWays<InteractionEvent?>
  public var latest: BothWays<InteractionEvent?>
  public var timeline: InteractionTimeline?
  public var coverage: InteractionCoverage
  public var engagedPosts: EngagedPosts
  /// Your replies to them and quotes of them, newest first.
  public var yourPosts: [PostRow]
  /// Every event, newest first.
  public var events: [InteractionEvent]

  public var json: JSONValue {
    [
      "did": .string(did), "self": .bool(isSelf), "relationship": relationship.json,
      "totals": ["in": totals.in.json, "out": totals.out.json],
      "first": ["in": first.in?.json ?? .null, "out": first.out?.json ?? .null],
      "latest": ["in": latest.in?.json ?? .null, "out": latest.out?.json ?? .null],
      "timeline": timeline?.json ?? .null, "coverage": coverage.json, "engagedPosts": engagedPosts.json,
      "yourPosts": .array(yourPosts.map(\.json)), "events": .array(events.map(\.json)),
    ]
  }
}
