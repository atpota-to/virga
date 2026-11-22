// Ports src/reports/models.js
//
// What each report model returns, with the web's field names. Each result
// writes the JSON the web's object holds (`json`), numbers the web can make
// NaN included, which is what the parity tests compare.

import Foundation
import VirgaArchive
import VirgaCore

/// JSON for the archive's own result types.
enum ReportJSON {
  static func number(_ n: Double) -> JSONValue { .number(n) }
  static func number(_ n: Double?) -> JSONValue { n.map(JSONValue.number) ?? .null }
  static func number(_ n: Int) -> JSONValue { .number(Double(n)) }
  static func number(_ n: Int?) -> JSONValue { n.map { .number(Double($0)) } ?? .null }
  static func string(_ s: String?) -> JSONValue { s.map(JSONValue.string) ?? .null }

  static func series(_ points: [SeriesPoint]) -> JSONValue {
    .array(points.map { ["t": .number($0.t), "v": .number($0.v)] })
  }

  static func trend(_ points: [TrendPoint]) -> JSONValue {
    .array(points.map { ["t": .number($0.t), "v": number($0.v)] })
  }

  static func rate(_ points: [RatePoint]) -> JSONValue {
    .array(points.map { ["t": .number($0.t), "v": number($0.v), "total": .number($0.total), "posts": .number($0.posts)] })
  }

  static func comparison(_ c: PeriodComparison) -> JSONValue {
    ["current": .number(c.current), "previous": .number(c.previous), "delta": .number(c.delta), "pct": number(c.pct)]
  }

  static func rateComparison(_ c: RateComparison?) -> JSONValue {
    guard let c else { return .null }
    return ["current": number(c.current), "previous": number(c.previous), "pct": number(c.pct)]
  }

  static func actor(_ a: TopActor) -> JSONValue {
    ["did": .string(a.did), "total": number(a.total), "byKind": .object(a.byKind.mapValues { number($0) })]
  }

  static func units(_ units: [AnalyticsUnit]) -> JSONValue { .array(units.map { .string($0.rawValue) }) }
}

/// A follower with the time their follow record gives (`{ ...f, atMs }`).
public struct DatedFollower: Hashable, Sendable {
  public var row: FollowerRow
  public var atMs: Double

  public var json: JSONValue {
    var members = row.json.objectValue ?? [:]
    members["atMs"] = .number(atMs)
    return .object(members)
  }
}

/// A day with new followers: its local midnight and how many.
public struct DayCount: Hashable, Sendable {
  public var t: Double
  public var n: Int

  public var json: JSONValue { ["t": .number(t), "n": ReportJSON.number(n)] }
}

/// `followersModel`.
public struct FollowersReport: Hashable, Sendable {
  public var total: Int
  public var undated: Int
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var counts: [SeriesPoint]
  public var cumulative: [SeriesPoint]
  public var blockCumulative: [SeriesPoint]
  public var gained: Int
  public var perDay: Double
  public var compare: PeriodComparison
  public var spanDays: Double
  public var profileCount: Int?
  public var counterGap: Int?
  public var newest: [DatedFollower]
  public var biggestDays: [DayCount]

  public var json: JSONValue {
    [
      "total": ReportJSON.number(total), "undated": ReportJSON.number(undated), "unit": .string(unit.rawValue),
      "units": ReportJSON.units(units), "counts": ReportJSON.series(counts), "cumulative": ReportJSON.series(cumulative),
      "blockCumulative": ReportJSON.series(blockCumulative), "gained": ReportJSON.number(gained),
      "perDay": .number(perDay), "compare": ReportJSON.comparison(compare), "spanDays": .number(spanDays),
      "profileCount": ReportJSON.number(profileCount), "counterGap": ReportJSON.number(counterGap),
      "newest": .array(newest.map(\.json)), "biggestDays": .array(biggestDays.map(\.json)),
    ]
  }
}

/// `blocksModel`.
public struct BlocksReport: Hashable, Sendable {
  public var total: Int
  public var directTotal: Int
  public var listTotal: Int
  public var overlap: Int
  public var undated: Int
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var counts: [SeriesPoint]
  public var trend: [SeriesPoint]
  public var cumulative: [SeriesPoint]
  public var directCumulative: [SeriesPoint]
  public var listCumulative: [SeriesPoint]
  public var followerCumulative: [SeriesPoint]
  public var received: Int
  public var perDay: Double
  public var compare: PeriodComparison

  public var json: JSONValue {
    [
      "total": ReportJSON.number(total), "directTotal": ReportJSON.number(directTotal),
      "listTotal": ReportJSON.number(listTotal), "overlap": ReportJSON.number(overlap),
      "undated": ReportJSON.number(undated), "unit": .string(unit.rawValue), "units": ReportJSON.units(units),
      "counts": ReportJSON.series(counts), "trend": ReportJSON.series(trend),
      "cumulative": ReportJSON.series(cumulative), "directCumulative": ReportJSON.series(directCumulative),
      "listCumulative": ReportJSON.series(listCumulative), "followerCumulative": ReportJSON.series(followerCumulative),
      "received": ReportJSON.number(received), "perDay": .number(perDay), "compare": ReportJSON.comparison(compare),
    ]
  }
}

/// `postsModel`.
public struct PostsReport: Hashable, Sendable {
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var counts: [SeriesPoint]
  public var trend: [SeriesPoint]
  public var count: Int
  public var perDay: Double
  public var replies: Int
  public var quotes: Int
  public var originals: Int
  public var withMedia: Int
  public var compare: PeriodComparison
  public var spanDays: Double

  public var json: JSONValue {
    [
      "unit": .string(unit.rawValue), "units": ReportJSON.units(units), "counts": ReportJSON.series(counts),
      "trend": ReportJSON.series(trend), "count": ReportJSON.number(count), "perDay": .number(perDay),
      "replies": ReportJSON.number(replies), "quotes": ReportJSON.number(quotes),
      "originals": ReportJSON.number(originals), "withMedia": ReportJSON.number(withMedia),
      "compare": ReportJSON.comparison(compare), "spanDays": .number(spanDays),
    ]
  }
}

/// One kind's share of the engagement (`byKind` of engagementModel).
public struct KindValue: Hashable, Sendable {
  public var kind: String
  public var label: String
  public var value: Int

  public var json: JSONValue { ["kind": .string(kind), "label": .string(label), "value": ReportJSON.number(value)] }
}

/// `engagementModel`.
public struct EngagementReport: Hashable, Sendable {
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var series: [SeriesPoint]
  public var trend: [SeriesPoint]
  public var total: Int
  public var byKind: [KindValue]
  public var posts: Int
  /// The posts that earned the most, with their `atMs`.
  public var top: [PostRow]
  public var compare: PeriodComparison
  public var rateUnit: AnalyticsUnit
  public var rate: [RatePoint]
  public var rateTrend: [TrendPoint]
  public var ownPosts: Int
  public var ownRate: Double?
  public var rateCompare: RateComparison?

  public var json: JSONValue {
    [
      "unit": .string(unit.rawValue), "units": ReportJSON.units(units), "series": ReportJSON.series(series),
      "trend": ReportJSON.series(trend), "total": ReportJSON.number(total), "byKind": .array(byKind.map(\.json)),
      "posts": ReportJSON.number(posts), "top": .array(top.map(\.json)), "compare": ReportJSON.comparison(compare),
      "rateUnit": .string(rateUnit.rawValue), "rate": ReportJSON.rate(rate), "rateTrend": ReportJSON.trend(rateTrend),
      "ownPosts": ReportJSON.number(ownPosts), "ownRate": ReportJSON.number(ownRate),
      "rateCompare": ReportJSON.rateComparison(rateCompare),
    ]
  }
}

/// One kind of engagement given and how much (`byKind` of givenModel).
public struct KindCount: Hashable, Sendable {
  public var kind: String
  public var count: Int

  public var json: JSONValue { ["kind": .string(kind), "count": ReportJSON.number(count)] }
}

/// `givenModel`.
public struct GivenReport: Hashable, Sendable {
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var series: [SeriesPoint]
  public var trend: [SeriesPoint]
  public var total: Int
  public var perDay: Double
  public var accounts: Int
  public var byKind: [KindCount]
  public var compare: PeriodComparison

  public var json: JSONValue {
    [
      "unit": .string(unit.rawValue), "units": ReportJSON.units(units), "series": ReportJSON.series(series),
      "trend": ReportJSON.series(trend), "total": ReportJSON.number(total), "perDay": .number(perDay),
      "accounts": ReportJSON.number(accounts), "byKind": .array(byKind.map(\.json)),
      "compare": ReportJSON.comparison(compare),
    ]
  }
}

/// `peopleModel`.
public struct PeopleReport: Hashable, Sendable {
  public var inbound: [TopActor]
  public var outbound: [TopActor]
  public var inOldest: Double?
  public var inT0: Double

  public var json: JSONValue {
    [
      "inbound": .array(inbound.map(ReportJSON.actor)), "outbound": .array(outbound.map(ReportJSON.actor)),
      "inOldest": ReportJSON.number(inOldest), "inT0": .number(inT0),
    ]
  }
}

/// `relationSets`: who follows the account and whom it follows, by DID
/// (each once, by code units, in the order first met), and each
/// follower's row (the last one for a DID met twice).
public struct RelationSets: Hashable, Sendable {
  public var followers: [String]
  public var following: [String]
  public var followerCards: [JSKey: FollowerRow]
  let followerKeys: Set<JSKey>
  let followingKeys: Set<JSKey>

  init(followers: [FollowerRow], following: [FollowingRow]) {
    var followerOrder: [String] = []
    var followerKeys = Set<JSKey>()
    var cards: [JSKey: FollowerRow] = [:]
    for f in followers {
      let key = JSKey(f.did)
      if followerKeys.insert(key).inserted { followerOrder.append(f.did) }
      cards[key] = f
    }
    var followingOrder: [String] = []
    var followingKeys = Set<JSKey>()
    for f in following where followingKeys.insert(JSKey(f.did)).inserted { followingOrder.append(f.did) }
    self.followers = followerOrder
    self.following = followingOrder
    self.followerCards = cards
    self.followerKeys = followerKeys
    self.followingKeys = followingKeys
  }

  /// `followers.has(did)`.
  public func isFollower(_ did: String) -> Bool { followerKeys.contains(JSKey(did)) }
  /// `following.has(did)`.
  public func isFollowed(_ did: String) -> Bool { followingKeys.contains(JSKey(did)) }
  /// `followerCards.get(did)`.
  public func followerCard(_ did: String) -> FollowerRow? { followerCards[JSKey(did)] }

  public var json: JSONValue {
    var cards: [String: JSONValue] = [:]
    for did in followers { cards[did] = followerCards[JSKey(did)]?.json ?? .null }
    return [
      "followers": .array(followers.map(JSONValue.string)), "following": .array(following.map(JSONValue.string)),
      "followerCards": .object(cards),
    ]
  }
}

/// A collection and how many records were written to it (`ranked`).
public struct CollectionCount: Hashable, Sendable {
  public var collection: String
  public var count: Int

  public var json: JSONValue { ["collection": .string(collection), "count": ReportJSON.number(count)] }
}

/// `atmosphereModel`.
public struct AtmosphereReport: Hashable, Sendable {
  public var unit: AnalyticsUnit
  public var units: [AnalyticsUnit]
  public var series: [SeriesPoint]
  public var trend: [SeriesPoint]
  public var total: Int
  public var collections: Int
  public var ranked: [CollectionCount]
  public var spanDays: Double
  public var allTime: Int

  public var json: JSONValue {
    [
      "unit": .string(unit.rawValue), "units": ReportJSON.units(units), "series": ReportJSON.series(series),
      "trend": ReportJSON.series(trend), "total": ReportJSON.number(total),
      "collections": ReportJSON.number(collections), "ranked": .array(ranked.map(\.json)),
      "spanDays": .number(spanDays), "allTime": ReportJSON.number(allTime),
    ]
  }
}

/// One slot of the best-time grid: how many posts, and their median
/// engagement once there are enough of them.
public struct BestTimeCell: Hashable, Sendable {
  public var posts: Int
  public var avg: Double?

  public var json: JSONValue { ["posts": ReportJSON.number(posts), "avg": ReportJSON.number(avg)] }
}

/// A weekday's row of the grid (`label` is WEEKDAYS[day]).
public struct BestTimeRow: Hashable, Sendable {
  public var label: String
  public var cells: [BestTimeCell]

  public var json: JSONValue { ["label": .string(label), "cells": .array(cells.map(\.json))] }
}

/// A slot that has a value: its weekday (0 is Monday), column, median and posts.
public struct BestTimeSlot: Hashable, Sendable {
  public var day: Int
  public var col: Int
  public var avg: Double
  public var posts: Int

  public var json: JSONValue {
    ["day": ReportJSON.number(day), "col": ReportJSON.number(col), "avg": .number(avg), "posts": ReportJSON.number(posts)]
  }
}

/// A weekday over every hour (`byDay`).
public struct BestTimeDay: Hashable, Sendable {
  public var day: Int
  public var posts: Int
  public var avg: Double?

  public var json: JSONValue { ["day": ReportJSON.number(day), "posts": ReportJSON.number(posts), "avg": ReportJSON.number(avg)] }
}

/// A column of hours over every weekday (`byHour`).
public struct BestTimeHour: Hashable, Sendable {
  public var col: Int
  public var posts: Int
  public var avg: Double?

  public var json: JSONValue { ["col": ReportJSON.number(col), "posts": ReportJSON.number(posts), "avg": ReportJSON.number(avg)] }
}

/// `bestTimeModel`.
public struct BestTimeReport: Hashable, Sendable {
  public var block: Int
  public var cols: Int
  public var rows: [BestTimeRow]
  public var best: [BestTimeSlot]
  public var byDay: [BestTimeDay]
  public var byHour: [BestTimeHour]
  public var posts: Int
  public var overall: Double?

  public var json: JSONValue {
    [
      "block": ReportJSON.number(block), "cols": ReportJSON.number(cols), "rows": .array(rows.map(\.json)),
      "best": .array(best.map(\.json)), "byDay": .array(byDay.map(\.json)), "byHour": .array(byHour.map(\.json)),
      "posts": ReportJSON.number(posts), "overall": ReportJSON.number(overall),
    ]
  }
}

/// A heatmap column label and how many columns it spans (`hourColumns`).
public struct HourColumn: Hashable, Sendable {
  public var label: String
  public var span: Int

  public var json: JSONValue { ["label": .string(label), "span": ReportJSON.number(span)] }
}

/// A format, a length band or a place in a thread (`CONTENT_FORMATS`,
/// `LENGTH_BANDS`, `THREAD_PLACES`).
public struct ContentDef: Hashable, Sendable {
  public var key: String
  public var label: String
  /// A length band's longest post (Infinity for the last).
  public var max: Double?

  public var json: JSONValue {
    var members: [String: JSONValue] = ["key": .string(key), "label": .string(label)]
    if let max { members["max"] = .number(max) }
    return .object(members)
  }
}

/// A group's posts in the window, their engagement, their share of all the
/// posts, and the typical (median) settled post once there are enough.
public struct ContentTally: Hashable, Sendable {
  public var posts: Int
  public var total: Int
  public var share: Double
  public var typical: Double?

  var members: [String: JSONValue] {
    ["posts": ReportJSON.number(posts), "total": ReportJSON.number(total), "share": .number(share), "typical": ReportJSON.number(typical)]
  }
}

/// One of the fixed groups (a format, a length band, a place in a thread).
public struct ContentGroup: Hashable, Sendable {
  public var key: String
  public var label: String
  public var posts: Int
  public var total: Int
  public var share: Double
  public var typical: Double?

  public init(key: String, label: String, posts: Int = 0, total: Int = 0, share: Double = 0, typical: Double?) {
    self.key = key
    self.label = label
    self.posts = posts
    self.total = total
    self.share = share
    self.typical = typical
  }

  public var json: JSONValue {
    [
      "key": .string(key), "label": .string(label), "posts": ReportJSON.number(posts),
      "total": ReportJSON.number(total), "share": .number(share), "typical": ReportJSON.number(typical),
    ]
  }
}

/// A tag (as first written) or a linked site, ranked by use.
public struct ContentUse: Hashable, Sendable {
  /// The tag or the host.
  public var name: String
  public var tally: ContentTally

  public var posts: Int { tally.posts }
  public var total: Int { tally.total }
  public var share: Double { tally.share }
  public var typical: Double? { tally.typical }

  func json(_ field: String) -> JSONValue {
    var members = tally.members
    members[field] = .string(name)
    return .object(members)
  }
}

/// A language tag and how many posts carry it.
public struct LangCount: Hashable, Sendable {
  public var lang: String
  public var posts: Int

  public var json: JSONValue { ["lang": .string(lang), "posts": ReportJSON.number(posts)] }
}

/// How much of the media is described.
public struct AltCoverage: Hashable, Sendable {
  public var posts: Int
  public var described: Int
  public var items: Int
  public var itemsDescribed: Int
  public var pct: Double?

  public var json: JSONValue {
    [
      "posts": ReportJSON.number(posts), "described": ReportJSON.number(described), "items": ReportJSON.number(items),
      "itemsDescribed": ReportJSON.number(itemsDescribed), "pct": ReportJSON.number(pct),
    ]
  }
}

/// `contentModel`.
public struct ContentReport: Hashable, Sendable {
  public var ready: Bool
  public var unread: Int
  public var posts: Int
  public var typical: Double?
  public var formats: [ContentGroup]
  public var lengths: [ContentGroup]
  public var places: [ContentGroup]
  /// `[{ tag, posts, total, share, typical }]`.
  public var tags: [ContentUse]
  /// `[{ host, posts, total, share, typical }]`.
  public var links: [ContentUse]
  public var langs: [LangCount]
  public var withTags: Int
  public var withLinks: Int
  public var alt: AltCoverage

  public var json: JSONValue {
    [
      "ready": .bool(ready), "unread": ReportJSON.number(unread), "posts": ReportJSON.number(posts),
      "typical": ReportJSON.number(typical), "formats": .array(formats.map(\.json)),
      "lengths": .array(lengths.map(\.json)), "places": .array(places.map(\.json)),
      "tags": .array(tags.map { $0.json("tag") }), "links": .array(links.map { $0.json("host") }),
      "langs": .array(langs.map(\.json)), "withTags": ReportJSON.number(withTags),
      "withLinks": ReportJSON.number(withLinks), "alt": alt.json,
    ]
  }
}

/// `contentStandout`: the group that typically earns the most, the group
/// it is held against (nil: the overall typical post) and that baseline.
public struct ContentStandout: Hashable, Sendable {
  public var best: ContentGroup
  public var base: ContentGroup?
  public var baseline: Double

  public var json: JSONValue { ["best": best.json, "base": base?.json ?? .null, "baseline": .number(baseline)] }
}

/// `followerLogModel`: the unfollow tracker's view of the follower log.
public struct FollowerLogReport: Hashable, Sendable {
  public var tracking: Bool
  public var since: Double?
  public var lastSyncAt: Double?
  public var lost: [FollowerLogEntry]
  public var gained: [FollowerLogEntry]
  public var latestLost: [FollowerLogEntry]
  public var latestGained: [FollowerLogEntry]

  public var json: JSONValue {
    [
      "tracking": .bool(tracking), "since": ReportJSON.number(since), "lastSyncAt": ReportJSON.number(lastSyncAt),
      "lost": .array(lost.map(\.json)), "gained": .array(gained.map(\.json)),
      "latestLost": .array(latestLost.map(\.json)), "latestGained": .array(latestGained.map(\.json)),
    ]
  }
}
