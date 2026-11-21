// Ports src/lib/analytics.js
//
// Pure derivations for the dashboard: bucketing, growth series, period
// comparisons, the ranked lists, and the shapers that turn feed items,
// records and notifications into archive rows. No fetch, no state.
//
// Everything is bucketed in LOCAL time: the web reads the browser's zone and
// its first day of the week (lib/locale.js); here both are parameters,
// defaulting to VirgaCore's active ones (AppLocale).

import Foundation
import VirgaCore
import VirgaNetwork

/// A bucket size: 'day', 'week' or 'month'. Anything else reads as a day,
/// as every branch of the web code does.
public enum AnalyticsUnit: String, Codable, Hashable, Sendable, CaseIterable {
  case day, week, month

  /// The unit a string names; anything unknown is a day.
  public init(_ raw: String?) {
    self = raw.flatMap(AnalyticsUnit.init(rawValue:)) ?? .day
  }
}

/// A period preset (`{ key, days, label }`) or a custom range (periods.js).
public struct AnalyticsPeriod: Codable, Hashable, Sendable {
  public var key: String
  /// The window's length in days; nil for all time.
  public var days: Int?
  public var label: String
  /// A custom range's first midnight (ms).
  public var start: Double?
  /// A custom range's end (ms): the close of its last day, or now.
  public var end: Double?
  public var from: String?
  public var to: String?
  public var custom: Bool?

  public init(
    key: String, days: Int?, label: String, start: Double? = nil, end: Double? = nil, from: String? = nil,
    to: String? = nil, custom: Bool? = nil
  ) {
    self.key = key
    self.days = days
    self.label = label
    self.start = start
    self.end = end
    self.from = from
    self.to = to
    self.custom = custom
  }

  enum CodingKeys: String, CodingKey { case key, days, label, start, end, from, to, custom }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(key, forKey: .key)
    // A preset's `days: null` is written, as the web's object has it.
    try c.encode(days, forKey: .days)
    try c.encode(label, forKey: .label)
    try c.encodeIfPresent(start, forKey: .start)
    try c.encodeIfPresent(end, forKey: .end)
    try c.encodeIfPresent(from, forKey: .from)
    try c.encodeIfPresent(to, forKey: .to)
    try c.encodeIfPresent(custom, forKey: .custom)
  }

  /// Whether this is a range picked by hand (`period?.custom`).
  public var isCustom: Bool { custom == true }
}

/// A filter choice: `{ key, label }`.
public struct AnalyticsKind: Codable, Hashable, Sendable {
  public var key: String
  public var label: String

  public init(key: String, label: String) {
    self.key = key
    self.label = label
  }
}

/// One bucket of a series: its start (local ms) and its value.
public struct SeriesPoint: Codable, Hashable, Sendable {
  public var t: Double
  public var v: Double

  public init(t: Double, v: Double) {
    self.t = t
    self.v = v
  }
}

/// A point of a trend that can have no value (`v: null`).
public struct TrendPoint: Codable, Hashable, Sendable {
  public var t: Double
  public var v: Double?

  public init(t: Double, v: Double?) {
    self.t = t
    self.v = v
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(t, forKey: .t)
    try c.encode(v, forKey: .v)
  }
}

/// One bucket of an engagement rate: the rate (nil with no posts), the
/// engagement it divides and the posts it divides by.
public struct RatePoint: Codable, Hashable, Sendable {
  public var t: Double
  public var v: Double?
  public var total: Double
  public var posts: Double

  public init(t: Double, v: Double?, total: Double, posts: Double) {
    self.t = t
    self.v = v
    self.total = total
    self.posts = posts
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(t, forKey: .t)
    try c.encode(v, forKey: .v)
    try c.encode(total, forKey: .total)
    try c.encode(posts, forKey: .posts)
  }
}

/// `comparePeriods`: this period against the one before it.
public struct PeriodComparison: Codable, Hashable, Sendable {
  public var current: Double
  public var previous: Double
  public var delta: Double
  /// Nil when the previous period was zero.
  public var pct: Double?

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(current, forKey: .current)
    try c.encode(previous, forKey: .previous)
    try c.encode(delta, forKey: .delta)
    try c.encode(pct, forKey: .pct)
  }
}

/// `compareRates`: this period's engagement rate against the last one's.
public struct RateComparison: Codable, Hashable, Sendable {
  public var current: Double?
  public var previous: Double?
  public var pct: Double?

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(current, forKey: .current)
    try c.encode(previous, forKey: .previous)
    try c.encode(pct, forKey: .pct)
  }
}

/// One person blocking the account, once (`blockReach`).
public struct BlockPerson: Codable, Hashable, Sendable {
  public var did: String
  public var direct: Bool
  public var list: Bool
  /// "direct" or "list": the path that reached them first.
  public var source: String
  public var blockedAt: String?

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(did, forKey: .did)
    try c.encode(direct, forKey: .direct)
    try c.encode(list, forKey: .list)
    try c.encode(source, forKey: .source)
    try c.encode(blockedAt, forKey: .blockedAt)
  }
}

/// `blockReach`: the people behind the block paths, and how they split.
public struct BlockReach: Codable, Hashable, Sendable {
  public var people: [BlockPerson]
  public var directCount: Int
  public var listCount: Int
  public var listOnlyCount: Int
  public var overlapCount: Int
}

/// One account in a ranked list (`topActors`).
public struct TopActor: Codable, Hashable, Sendable {
  public var did: String
  public var total: Int
  public var byKind: [String: Int]
}

/// Anything `topActors` can rank: an event's who, what and when.
public protocol ArchiveEventLike: ArchiveTimed {
  var eventDid: String? { get }
  var eventKind: JSONValue? { get }
}

extension EngagementEvent: ArchiveEventLike {
  public var eventDid: String? { did.isEmpty ? nil : did }
  public var eventKind: JSONValue? { .string(kind) }
}

extension JSONValue: ArchiveEventLike {
  public var eventDid: String? {
    guard let did = self["did"], did.isTruthy else { return nil }
    return did.stringValue ?? did.jsString
  }
  public var eventKind: JSONValue? { self["kind"] }
}

public enum Analytics {
  static let dayMs: Double = 86_400_000

  /// The shape of an archive post row; rows of an older shape are brought
  /// up at the next sync from the repo's own records (upgradePostRows).
  public static let postRowVersion = 2

  /// The period presets; `days: nil` is all time.
  public static let analyticsPeriods: [AnalyticsPeriod] = [
    AnalyticsPeriod(key: "7d", days: 7, label: "7 days"),
    AnalyticsPeriod(key: "30d", days: 30, label: "30 days"),
    AnalyticsPeriod(key: "90d", days: 90, label: "90 days"),
    AnalyticsPeriod(key: "1y", days: 365, label: "Year"),
    AnalyticsPeriod(key: "all", days: nil, label: "All time"),
  ]

  /// The engagement-type filter for anything derived from post counts.
  public static let engagementKinds: [AnalyticsKind] = [
    AnalyticsKind(key: "all", label: "All"),
    AnalyticsKind(key: "like", label: "Likes"),
    AnalyticsKind(key: "repost", label: "Reposts"),
    AnalyticsKind(key: "reply", label: "Replies"),
    AnalyticsKind(key: "quote", label: "Quotes"),
  ]

  /// The filter for event lists: the above and mentions.
  public static let eventKinds: [AnalyticsKind] = engagementKinds + [AnalyticsKind(key: "mention", label: "Mentions")]

  // MARK: - Kinds

  /// How much engagement a post carries, for one kind or all four summed.
  /// Unknown kinds count 0.
  public static func engagementOf(_ post: PostRow?, _ kind: String = "all") -> Int {
    guard let post else { return 0 }
    switch kind {
    case "all": return post.likes + post.reposts + post.replies + post.quotes
    case "like": return post.likes
    case "repost": return post.reposts
    case "reply": return post.replies
    case "quote": return post.quotes
    default: return 0
    }
  }

  // MARK: - Buckets

  /// `new Date(value).getTime()`: a number as a time, a string parsed, null
  /// as 0 and a boolean as 0 or 1; undefined (nil) and anything else NaN.
  public static func dateValue(_ value: JSONValue?, timeZone: TimeZone) -> Double {
    switch value {
    case .none: return .nan
    case .some(.number(let n)): return JSDate.timeClip(n)
    case .some(.string(let s)): return JSDate.parse(s, timeZone: timeZone)
    case .some(.null): return 0
    case .some(.bool(let b)): return b ? 1 : 0
    case .some(.array): return JSDate.parse(value!.jsString, timeZone: timeZone)
    case .some(.object): return .nan
    }
  }

  /// `typeof raw === 'number' ? raw : Date.parse(raw)`.
  public static func timeOf(_ raw: JSONValue?, timeZone: TimeZone) -> Double {
    JSDate.toMs(raw, timeZone: timeZone)
  }

  /// Start of the bucket containing `t` (ms), in local time. Weeks start on
  /// `weekStart` (a getDay index; the active one by default). NaN for an
  /// unreadable time.
  public static func bucketStartMs(
    _ t: Double, _ unit: AnalyticsUnit, timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> Double {
    let ms = JSDate.timeClip(t)
    guard let d = JSDate.fields(ms, timeZone: timeZone) else { return .nan }
    let year = Double(d.year)
    let month = Double(d.month)
    switch unit {
    case .month:
      return JSDate.local(year, month, 1, timeZone: timeZone)
    case .week:
      let first = d.date - AppLocale.weekdayOffset(d.day, weekStart)
      return JSDate.local(year, month, Double(first), timeZone: timeZone)
    case .day:
      return JSDate.local(year, month, Double(d.date), timeZone: timeZone)
    }
  }

  /// `bucketStartMs` of any value `new Date()` reads.
  public static func bucketStartMs(
    _ t: JSONValue?, _ unit: AnalyticsUnit, timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> Double {
    bucketStartMs(dateValue(t, timeZone: timeZone), unit, timeZone: timeZone, weekStart: weekStart)
  }

  /// Start of the bucket after the one containing `t`: calendar arithmetic,
  /// so a day with a clock change is still one day.
  public static func nextBucketMs(
    _ t: Double, _ unit: AnalyticsUnit, timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> Double {
    let start = bucketStartMs(t, unit, timeZone: timeZone, weekStart: weekStart)
    guard let s = JSDate.fields(start, timeZone: timeZone) else { return .nan }
    if unit == .month { return JSDate.local(Double(s.year), Double(s.month) + 1, 1, timeZone: timeZone) }
    let days: Double = unit == .week ? 7 : 1
    return JSDate.local(Double(s.year), Double(s.month), Double(s.date) + days, timeZone: timeZone)
  }

  /// `nextBucketMs` of any value `new Date()` reads.
  public static func nextBucketMs(
    _ t: JSONValue?, _ unit: AnalyticsUnit, timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> Double {
    nextBucketMs(dateValue(t, timeZone: timeZone), unit, timeZone: timeZone, weekStart: weekStart)
  }

  /// Dense series: one entry per bucket from `t0` through `t1` inclusive,
  /// zero-filled, at most 1000 buckets. `pickTime` gives an item's time (a
  /// number, or a string Date.parse reads); `pickValue` its contribution
  /// (`Number(value)`; a count by default). Items outside [t0, t1] or
  /// without a readable time are dropped.
  public static func bucketSeries<T>(
    _ items: [T]?,
    unit: AnalyticsUnit = .day,
    t0: Double,
    t1: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    weekStart: Int? = nil,
    pickTime: (T) -> JSONValue?,
    pickValue: ((T) -> Double)? = nil
  ) -> [SeriesPoint] {
    let from = bucketStartMs(t0, unit, timeZone: timeZone, weekStart: weekStart)
    let to = bucketStartMs(t1, unit, timeZone: timeZone, weekStart: weekStart)
    guard from.isFinite, to.isFinite, !(to < from) else { return [] }

    var series: [SeriesPoint] = []
    var index: [Double: Int] = [:]
    var t = from
    var n = 0
    while t <= to && n < 1000 {
      index[t] = series.count
      series.append(SeriesPoint(t: t, v: 0))
      t = nextBucketMs(t, unit, timeZone: timeZone, weekStart: weekStart)
      n += 1
    }

    for item in items ?? [] {
      let at = timeOf(pickTime(item), timeZone: timeZone)
      if !at.isFinite || at < t0 || at > t1 { continue }
      guard let slot = index[bucketStartMs(at, unit, timeZone: timeZone, weekStart: weekStart)] else { continue }
      let v = pickValue?(item) ?? 1
      if v.isFinite { series[slot].v += v }
    }
    return series.count > 1000 ? Array(series.suffix(1000)) : series
  }

  /// `bucketSeries` reading each item's own `at`.
  public static func bucketSeries<T: ArchiveTimed>(
    _ items: [T]?,
    unit: AnalyticsUnit = .day,
    t0: Double,
    t1: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    weekStart: Int? = nil,
    pickValue: ((T) -> Double)? = nil
  ) -> [SeriesPoint] {
    bucketSeries(
      items, unit: unit, t0: t0, t1: t1, timeZone: timeZone, weekStart: weekStart, pickTime: { $0.atValue },
      pickValue: pickValue)
  }

  /// Running total over a dense series, climbing from `baseline`.
  public static func cumulativeSeries(_ series: [SeriesPoint]?, _ baseline: Double = 0) -> [SeriesPoint] {
    var sum = baseline
    return (series ?? []).map { p in
      sum += p.v
      return SeriesPoint(t: p.t, v: sum)
    }
  }

  /// Direct blocks and moderation-list subscriptions collapsed into the
  /// people blocking the account, each counted once, dated by the earliest
  /// readable date of any of their paths.
  public static func blockReach(_ blocks: [BlockRow]?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> BlockReach {
    struct Person {
      var did: String
      var direct = false
      var list = false
      var candidates: [(atMs: Double, source: String)] = []
    }
    var order: [JSKey] = []
    var byDid: [JSKey: Person] = [:]
    var directDids = Set<JSKey>()
    var listDids = Set<JSKey>()

    for block in blocks ?? [] {
      guard !block.did.isEmpty else { continue }
      let key = JSKey(block.did)
      let source = block.source == "list" ? "list" : "direct"
      if source == "direct" { directDids.insert(key) } else { listDids.insert(key) }
      if byDid[key] == nil {
        byDid[key] = Person(did: block.did)
        order.append(key)
      }
      if source == "direct" { byDid[key]!.direct = true } else { byDid[key]!.list = true }
      let atMs = JSDate.parse(block.blockedAt.flatMap { $0.isEmpty ? nil : $0 } ?? "", timeZone: timeZone)
      if atMs.isFinite { byDid[key]!.candidates.append((atMs, source)) }
    }

    let people: [BlockPerson] = order.map { key in
      let person = byDid[key]!
      let sorted = JSSort.sort(person.candidates) { a, b in
        let d = a.atMs - b.atMs
        if d != 0, !d.isNaN { return d }
        return a.source == "direct" ? -1 : 1
      }
      let first = sorted.first
      return BlockPerson(
        did: person.did, direct: person.direct, list: person.list,
        source: first?.source ?? (person.direct ? "direct" : "list"),
        blockedAt: first.flatMap { JSDate.toISOString($0.atMs) })
    }

    return BlockReach(
      people: people,
      directCount: directDids.count,
      listCount: listDids.count,
      listOnlyCount: people.filter { $0.list && !$0.direct }.count,
      overlapCount: people.filter { $0.list && $0.direct }.count)
  }

  /// Centred moving average; the window shrinks at the edges.
  public static func movingAverage(_ series: [SeriesPoint]?, _ window: Double = 7) -> [SeriesPoint] {
    let series = series ?? []
    let n = series.count
    if n == 0 { return [] }
    // A NaN window makes every bound NaN: the sum stays 0 and is divided by NaN.
    guard let half = halfWindow(window) else { return series.map { SeriesPoint(t: $0.t, v: .nan) } }
    return series.indices.map { i in
      let lo = Swift.max(0, i - half)
      let hi = Swift.min(n - 1, i + half)
      var sum: Double = 0
      for j in lo...hi { sum += series[j].v }
      return SeriesPoint(t: series[i].t, v: sum / Double(hi - lo + 1))
    }
  }

  /// `Math.floor(Math.max(1, window) / 2)`, as an index offset; nil for a
  /// NaN window (NaN on the web, which no loop over it runs for).
  static func halfWindow(_ window: Double) -> Int? {
    if window.isNaN { return nil }
    let w = Swift.max(1, window)
    guard w.isFinite else { return Int.max / 4 }
    return Int((w / 2).rounded(.down))
  }

  /// This period against the one immediately before it, the same length.
  /// `pct` is nil when the previous period was zero.
  public static func comparePeriods<T>(
    _ items: [T]?,
    days: Double?,
    now: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    pickTime: (T) -> JSONValue?,
    pickValue: ((T) -> Double)? = nil
  ) -> PeriodComparison {
    let span = (days.flatMap { $0.isNaN ? nil : $0 } ?? 0) * dayMs
    var current: Double = 0
    var previous: Double = 0
    if span > 0 {
      for item in items ?? [] {
        let at = timeOf(pickTime(item), timeZone: timeZone)
        if !at.isFinite || at > now { continue }
        let v = pickValue?(item) ?? 1
        if !v.isFinite { continue }
        if at > now - span {
          current += v
        } else if at > now - 2 * span {
          previous += v
        }
      }
    }
    let delta = current - previous
    let pct: Double? = previous > 0 ? (delta / previous) * 100 : nil
    return PeriodComparison(current: current, previous: previous, delta: delta, pct: pct)
  }

  /// `comparePeriods` reading each item's own `at`.
  public static func comparePeriods<T: ArchiveTimed>(
    _ items: [T]?,
    days: Double?,
    now: Double,
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    pickValue: ((T) -> Double)? = nil
  ) -> PeriodComparison {
    comparePeriods(items, days: days, now: now, timeZone: timeZone, pickTime: { $0.atValue }, pickValue: pickValue)
  }

  // MARK: - Rates

  /// A post in the owner's own voice: top-level, or a reply to themselves.
  public static func isOwnVoicePost(_ post: PostRow?, _ ownerDid: String?) -> Bool {
    guard let post else { return false }
    guard let replyTo = post.replyTo, !replyTo.isEmpty else { return true }
    return Optional(replyTo).jsEquals(ownerDid)
  }

  /// `typeof p?.atMs === 'number' ? p.atMs : p?.at`.
  static func rateTime(_ post: PostRow) -> JSONValue? {
    if let atMs = post.atMs { return .number(atMs) }
    return post.atValue
  }

  /// Engagement per post, bucket by bucket; nil where a bucket has no posts.
  public static func rateSeries(
    _ posts: [PostRow]?,
    unit: AnalyticsUnit = .day,
    t0: Double,
    t1: Double,
    kind: String = "all",
    timeZone: TimeZone = AppLocale.activeTimeZone(),
    weekStart: Int? = nil
  ) -> [RatePoint] {
    let totals = bucketSeries(
      posts, unit: unit, t0: t0, t1: t1, timeZone: timeZone, weekStart: weekStart, pickTime: rateTime,
      pickValue: { Double(engagementOf($0, kind)) })
    let counts = bucketSeries(posts, unit: unit, t0: t0, t1: t1, timeZone: timeZone, weekStart: weekStart, pickTime: rateTime)
    return totals.indices.map { i in
      let n = i < counts.count ? counts[i].v : 0
      let b = totals[i]
      return RatePoint(t: b.t, v: n != 0 ? b.v / n : nil, total: b.v, posts: n)
    }
  }

  /// The trend under a rate series: total engagement over total posts
  /// across a centred window (a ratio of sums); nil where none posted.
  public static func rollingRate(_ series: [RatePoint]?, _ window: Double = 7) -> [TrendPoint] {
    let series = series ?? []
    let n = series.count
    // A NaN window runs no loop: no posts, no rate.
    guard let half = halfWindow(window) else { return series.map { TrendPoint(t: $0.t, v: nil) } }
    return series.indices.map { i in
      var total: Double = 0
      var posts: Double = 0
      let lo = Swift.max(0, i - half)
      let hi = Swift.min(n - 1, i + half)
      if lo <= hi {
        for j in lo...hi {
          total += series[j].total.isNaN ? 0 : series[j].total
          posts += series[j].posts.isNaN ? 0 : series[j].posts
        }
      }
      return TrendPoint(t: series[i].t, v: posts != 0 ? total / posts : nil)
    }
  }

  /// This period's engagement rate against the previous one's; `pct` is
  /// nil when the previous period had no rate.
  public static func compareRates(
    _ posts: [PostRow]?, days: Double?, now: Double, kind: String = "all",
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> RateComparison {
    let span = (days.flatMap { $0.isNaN ? nil : $0 } ?? 0) * dayMs
    var cur: (Double, Double) = (0, 0)
    var prev: (Double, Double) = (0, 0)
    if span > 0 {
      for p in posts ?? [] {
        let at = p.atMs ?? JSDate.parse(p.at ?? "undefined", timeZone: timeZone)
        if !at.isFinite || at > now { continue }
        if at > now - span {
          cur.0 += Double(engagementOf(p, kind))
          cur.1 += 1
        } else if at > now - 2 * span {
          prev.0 += Double(engagementOf(p, kind))
          prev.1 += 1
        }
      }
    }
    let current: Double? = cur.1 != 0 ? cur.0 / cur.1 : nil
    let previous: Double? = prev.1 != 0 ? prev.0 / prev.1 : nil
    var pct: Double?
    if let current, let previous, previous != 0, !previous.isNaN { pct = ((current - previous) / previous) * 100 }
    return RateComparison(current: current, previous: previous, pct: pct)
  }

  // MARK: - Engagement given

  /// Every act of engagement the owner has given: their likes and reposts
  /// plus the replies and quotes in the post archive, leaving out anything
  /// aimed at themselves.
  public static func givenEvents(_ outbound: [EngagementEvent]?, _ posts: [PostRow]?, _ ownerDid: String?) -> [EngagementEvent] {
    ((outbound ?? []) + outboundFromPosts(posts)).filter { !$0.did.isEmpty && !Optional($0.did).jsEquals(ownerDid) }
  }

  // MARK: - Ranked lists

  /// Posts within [t0, t1] ranked by one kind (or all four); ties newest first.
  public static func topPosts(
    _ posts: [PostRow]?, kind: String = "all", t0: Double = -.infinity, t1: Double = .infinity, limit: Int = 10,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [PostRow] {
    let parse = { (p: PostRow) in JSDate.parse(p.at ?? "undefined", timeZone: timeZone) }
    let kept = (posts ?? []).filter { p in
      let at = parse(p)
      return at.isFinite && at >= t0 && at <= t1
    }
    let sorted = JSSort.sort(kept) { a, b in
      let d = Double(engagementOf(b, kind) - engagementOf(a, kind))
      if d != 0 { return d }
      return parse(b) - parse(a)
    }
    return Array(sorted.prefix(Swift.max(0, limit)))
  }

  /// The accounts behind a pile of engagement events, ranked by how many
  /// they hold; ties by DID. `excludeDid` drops the owner.
  public static func topActors<E: ArchiveEventLike>(
    _ events: [E]?, kind: String = "all", t0: Double = -.infinity, t1: Double = .infinity, limit: Int = 12,
    excludeDid: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [TopActor] {
    var order: [JSKey] = []
    var rows: [JSKey: (did: String, total: Int, byKind: [String: Int])] = [:]
    for ev in events ?? [] {
      guard let did = ev.eventDid else { continue }
      if let excludeDid, did.jsEquals(excludeDid) { continue }
      let evKind = ev.eventKind
      if kind != "all" && !(evKind?.stringValue.map { $0.jsEquals(kind) } ?? false) { continue }
      let at = timeOf(ev.atValue, timeZone: timeZone)
      if !at.isFinite || at < t0 || at > t1 { continue }
      let key = JSKey(did)
      if rows[key] == nil {
        rows[key] = (did, 0, [:])
        order.append(key)
      }
      rows[key]!.total += 1
      let name = evKind?.stringValue ?? evKind?.jsString ?? "undefined"
      rows[key]!.byKind[name, default: 0] += 1
    }
    let list = order.map { rows[$0]! }
    let sorted = JSSort.sort(list) { a, b in
      let d = Double(b.total - a.total)
      if d != 0 { return d }
      return jsLess(a.did, b.did) ? -1 : 1
    }
    return sorted.prefix(Swift.max(0, limit)).map { TopActor(did: $0.did, total: $0.total, byKind: $0.byKind) }
  }

  /// `a < b` for strings, by UTF-16 code unit.
  static func jsLess(_ a: String, _ b: String) -> Bool {
    Array(a.utf16).lexicographicallyPrecedes(Array(b.utf16))
  }

  // MARK: - Compact shapes

  /// The DID a fully formed at:// URI belongs to (`/^at:\/\/(did:[^/]+)/`), or nil.
  public static func didFromAtUri(_ uri: String?) -> String? {
    guard let uri else { return nil }
    let units = Array(uri.utf16)
    let prefix = Array("at://did:".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return nil }
    var end = prefix.count
    while end < units.count, units[end] != 0x2F { end += 1 }
    guard end > prefix.count else { return nil }
    return String(jsUnits: units[5..<end])
  }

  /// `didFromAtUri(String(uri || ''))` for any value.
  public static func didFromAtUri(_ uri: JSONValue?) -> String? {
    guard let uri = uri.truthy else { return nil }
    return didFromAtUri(uri.stringValue ?? uri.jsString)
  }

  /// "example.com" for a link, without the www; nil for anything that isn't one.
  public static func linkHost(_ uri: String?) -> String? {
    guard let url = try? WebURL(uri ?? "undefined") else { return nil }
    let host = url.hostname.jsLowercased()
    let stripped = host.jsStartsWithUnits("www.") ? host.jsDropping(units: 4) : host
    return stripped.isEmpty ? nil : stripped
  }

  /// `linkHost` of any value (`new URL(String(value))`).
  public static func linkHost(_ uri: JSONValue?) -> String? {
    guard let uri else { return linkHost("undefined") }
    return linkHost(uri.stringValue ?? uri.jsString)
  }

  /// `/(^|\.)(tenor\.com|giphy\.com)$/`.
  static func isGifHost(_ host: String) -> Bool {
    for name in ["tenor.com", "giphy.com"] {
      if host.jsEquals(name) || host.jsEndsWithUnits("." + name) { return true }
    }
    return false
  }

  /// `/^at:\/\/([^/]+)\/[^/]+\/([^/?#]+)/` over a string: the did and rkey.
  static func atUriParts(_ uri: JSONValue?) -> (did: String, rkey: String)? {
    guard case .string(let text) = uri else { return nil }
    let units = Array(text.utf16)
    let prefix = Array("at://".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return nil }
    var i = prefix.count
    let didStart = i
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > didStart, i < units.count else { return nil }
    let did = String(jsUnits: units[didStart..<i])
    i += 1
    let collectionStart = i
    while i < units.count, units[i] != 0x2F { i += 1 }
    guard i > collectionStart, i < units.count else { return nil }
    i += 1
    let rkeyStart = i
    while i < units.count, units[i] != 0x2F, units[i] != 0x3F, units[i] != 0x23 { i += 1 }
    guard i > rkeyStart else { return nil }
    return (did, String(jsUnits: units[rkeyStart..<i]))
  }

  /// The facts a raw post record carries (postFacts), or nil when it can't
  /// be dated. A createdAt that isn't a string reads as undated.
  struct PostFacts {
    var at: String
    var text: String
    var len: Int
    var replyTo: String?
    var quoteOf: String?
    var hasMedia: Bool
    var media: String?
    var mediaCount: Int
    var altCount: Int
    var tags: [String]
    var links: [String]
    var mentions: [String]
    var langs: [String]
    var threadOf: String?
    var threadKey: String?

    func apply(to row: inout PostRow) {
      row.at = at
      row.text = text
      row.len = len
      row.replyTo = replyTo
      row.quoteOf = quoteOf
      row.hasMedia = hasMedia
      row.media = media
      row.mediaCount = mediaCount
      row.altCount = altCount
      row.tags = tags
      row.links = links
      row.mentions = mentions
      row.langs = langs
      row.threadOf = threadOf
      row.threadKey = threadKey
    }
  }

  static func postFacts(_ record: JSONValue?, timeZone: TimeZone) -> PostFacts? {
    guard case .string(let at)? = record?["createdAt"], !at.isEmpty,
      JSDate.parse(at, timeZone: timeZone).isFinite
    else { return nil }
    let embed = record?["embed"].truthy ?? .object([:])
    let type = embed["$type"]?.stringValue
    let withMedia = type == "app.bsky.embed.recordWithMedia"
    var quotedUri: JSONValue?
    if type == "app.bsky.embed.record" {
      quotedUri = embed["record"]?["uri"]
    } else if withMedia {
      quotedUri = embed["record"]?["record"]?["uri"]
    }
    let media = mediaFacts(withMedia ? embed["media"] : embed)
    let text = record?["text"]?.stringValue ?? ""
    var (tags, links, mentions) = facetFacts(record)
    if let host = media.host, !host.isEmpty, !links.jsIncludes(host) { links.append(host) }
    let root = atUriParts(record?["reply"]?["root"]?["uri"])
    var langs: [String] = []
    if case .array(let items)? = record?["langs"] {
      langs = Array(items.compactMap { $0.stringValue }.filter { !$0.isEmpty }.prefix(3))
    }
    return PostFacts(
      at: at, text: text, len: text.isEmpty ? 0 : Graphemes.countGraphemes(text),
      replyTo: didFromAtUri(record?["reply"]?["parent"]?["uri"]), quoteOf: didFromAtUri(quotedUri),
      hasMedia: media.kind == "image" || media.kind == "video", media: media.kind, mediaCount: media.count,
      altCount: media.alt, tags: tags, links: links, mentions: mentions, langs: langs,
      threadOf: root.map(\.did).flatMap { $0.isEmpty ? nil : $0 },
      threadKey: root.map(\.rkey).flatMap { $0.isEmpty ? nil : $0 })
  }

  /// What a post carries besides its words.
  static func mediaFacts(_ embed: JSONValue?) -> (kind: String?, count: Int, alt: Int, host: String?) {
    let none: (String?, Int, Int, String?) = (nil, 0, 0, nil)
    guard let embed, embed.isTruthy else { return none }
    switch embed {
    case .object, .array: break
    default: return none
    }
    switch embed["$type"]?.stringValue {
    case "app.bsky.embed.images":
      let images = embed["images"]?.arrayValue ?? []
      let alt = images.filter { $0["alt"]?.stringValue.map { !$0.jsTrimmed().isEmpty } ?? false }.count
      return ("image", images.count, alt, nil)
    case "app.bsky.embed.video":
      let alt = embed["alt"]?.stringValue.map { !$0.jsTrimmed().isEmpty } ?? false
      return ("video", 1, alt ? 1 : 0, nil)
    case "app.bsky.embed.external":
      let host = linkHost(embed["external"]?["uri"])
      if let host, isGifHost(host) { return ("gif", 1, 0, nil) }
      return ("link", 1, 0, host)
    default:
      return none
    }
  }

  /// The tags, link hosts and mentioned accounts a post's facets (and its
  /// tag list) name, each once, in the order first named.
  static func facetFacts(_ record: JSONValue?) -> (tags: [String], links: [String], mentions: [String]) {
    var tags: [String] = []
    var links: [String] = []
    var mentions: [String] = []
    func add(_ list: inout [String], _ value: String?) {
      if let value, !value.isEmpty, !list.jsIncludes(value) { list.append(value) }
    }
    for facet in record?["facets"]?.arrayValue ?? [] {
      for feature in facet["features"]?.arrayValue ?? [] {
        switch feature["$type"]?.stringValue {
        case "app.bsky.richtext.facet#tag": add(&tags, cleanTag(feature["tag"]))
        case "app.bsky.richtext.facet#link": add(&links, linkHost(feature["uri"]))
        case "app.bsky.richtext.facet#mention": add(&mentions, feature["did"]?.stringValue)
        default: break
        }
      }
    }
    for tag in record?["tags"]?.arrayValue ?? [] { add(&tags, cleanTag(tag)) }
    return (tags, links, mentions)
  }

  static func cleanTag(_ tag: JSONValue?) -> String? {
    guard case .string(let text)? = tag else { return nil }
    let trimmed = text.jsTrimmed()
    let clean = trimmed.jsStartsWithUnits("#") ? trimmed.jsDropping(units: 1) : trimmed
    return clean.isEmpty ? nil : clean
  }

  /// Rows of an older shape brought up to the current one from the repo's
  /// own records (`uri → record`), keeping every count. Only the rows that
  /// changed; a row whose record is gone or undated is left out.
  public static func upgradePostRows(
    _ rows: [PostRow]?, _ recordsByUri: [JSKey: JSONValue]?, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [PostRow] {
    var out: [PostRow] = []
    for row in rows ?? [] {
      guard let record = recordsByUri?[JSKey(row.uri)], record.isTruthy else { continue }
      guard let facts = postFacts(record, timeZone: timeZone) else { continue }
      var next = row
      facts.apply(to: &next)
      out.append(next)
    }
    return out
  }

  /// `uri.split('/').pop()`.
  static func lastSegment(_ uri: String) -> String {
    let units = Array(uri.utf16)
    guard let slash = units.lastIndex(of: 0x2F) else { return uri }
    return String(jsUnits: units[(slash + 1)...])
  }

  /// One getAuthorFeed item → one archive row, or nil for anything that
  /// isn't the owner's own dated post (a repost wears a `reason`).
  public static func compactPostFromFeedItem(_ item: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> PostRow? {
    guard let post = item?["post"], let uri = post["uri"]?.stringValue, !uri.isEmpty else { return nil }
    if item?["reason"].truthy != nil { return nil }
    guard let facts = postFacts(post["record"].truthy ?? .object([:]), timeZone: timeZone) else { return nil }
    func count(_ key: String) -> Int { JSONFields(post).count(key) }
    var row = PostRow(
      uri: uri, rkey: lastSegment(uri), likes: count("likeCount"), reposts: count("repostCount"),
      replies: count("replyCount"), quotes: count("quoteCount"))
    facts.apply(to: &row)
    return row
  }

  /// One raw post record (from the repo CAR) → the same row, every count 0.
  public static func compactPostFromRecord(_ uri: String?, _ record: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> PostRow? {
    guard let uri, !uri.isEmpty else { return nil }
    guard let facts = postFacts(record.truthy ?? .object([:]), timeZone: timeZone) else { return nil }
    var row = PostRow(uri: uri, rkey: lastSegment(uri))
    facts.apply(to: &row)
    return row
  }

  /// The notification reasons that are engagement aimed at the owner.
  static let inboundReasons: Set<String> = ["like", "repost", "reply", "quote", "mention"]

  /// One listNotifications entry → one inbound event, or nil for the
  /// reasons that aren't engagement.
  public static func inboundFromNotification(_ n: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> EngagementEvent? {
    guard let uri = n?["uri"]?.stringValue, !uri.isEmpty,
      let did = n?["author"]?["did"]?.stringValue, !did.isEmpty,
      let reason = n?["reason"]?.stringValue, inboundReasons.contains(where: { $0.jsEquals(reason) })
    else { return nil }
    let atValue = n?["record"]?["createdAt"].truthy ?? n?["indexedAt"].truthy
    guard case .string(let at)? = atValue, JSDate.parse(at, timeZone: timeZone).isFinite else { return nil }
    var subject: String?
    if let s = n?["reasonSubject"]?.stringValue, s.jsStartsWithUnits("at://") { subject = s }
    return EngagementEvent(uri: uri, did: did, kind: reason, at: at, subject: subject)
  }

  /// One of the owner's like/repost records → an outbound event aimed at
  /// the account whose post it was, or nil when that is unreadable.
  public static func outboundFromRecord(_ kind: String, _ record: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> EngagementEvent? {
    let did = didFromAtUri(record?["value"]?["subject"]?["uri"])
    guard let uri = record?["uri"]?.stringValue, !uri.isEmpty, let did else { return nil }
    guard case .string(let at)? = record?["value"]?["createdAt"].truthy,
      JSDate.parse(at, timeZone: timeZone).isFinite
    else { return nil }
    return EngagementEvent(uri: uri, did: did, kind: kind, at: at)
  }

  /// The outbound reply and quote events already in the post archive; a
  /// post that is both gives both.
  public static func outboundFromPosts(_ posts: [PostRow]?) -> [EngagementEvent] {
    var events: [EngagementEvent] = []
    for p in posts ?? [] {
      let uri = p.uri.isEmpty ? "undefined" : p.uri
      if let replyTo = p.replyTo, !replyTo.isEmpty {
        events.append(EngagementEvent(uri: "\(uri)#reply", did: replyTo, kind: "reply", at: p.at.map(JSONValue.string)))
      }
      if let quoteOf = p.quoteOf, !quoteOf.isEmpty {
        events.append(EngagementEvent(uri: "\(uri)#quote", did: quoteOf, kind: "quote", at: p.at.map(JSONValue.string)))
      }
    }
    return events
  }

  // MARK: - Formatting and choices

  /// Which bucket sizes read well over a span, smallest first.
  public static func unitChoicesFor(_ spanDays: Double?) -> [AnalyticsUnit] {
    guard let spanDays, !(spanDays > 366) else { return [.week, .month] }
    if spanDays > 120 { return [.week, .month] }
    if spanDays > 31 { return [.day, .week, .month] }
    return [.day, .week]
  }

  /// The unit a span opens on.
  public static func defaultUnitFor(_ spanDays: Double?) -> AnalyticsUnit {
    guard let spanDays, !(spanDays > 366) else { return .month }
    if spanDays > 31 { return .week }
    return .day
  }

  /// Tile values: exact and grouped while short, compact (12.9K) past 10,000.
  public static func fmtCompact(_ n: Double?, locale: String? = nil) -> String {
    guard let n, n.isFinite else { return "—" }
    let abs = Swift.abs(n)
    if abs >= 1_000_000 { return "\(trimZero((n / 1_000_000).jsToFixed(1)))M" }
    if abs >= 10_000 { return "\(trimZero((n / 1000).jsToFixed(1)))K" }
    return AppLocale.formatNumber(n.jsRounded, locale: locale)
  }

  static func trimZero(_ s: String) -> String {
    s.hasSuffix(".0") ? String(s.dropLast(2)) : s
  }

  /// A signed percent for a tile: "+12%", "−3.2%", "±0%", "new".
  public static func fmtDelta(_ pct: Double?) -> String {
    guard let pct else { return "new" }
    if pct == 0 { return "±0%" }
    let rounded = Swift.abs(pct) >= 10 ? pct.jsRounded : (pct * 10).jsRounded / 10
    return "\(pct > 0 ? "+" : "−")\(JSNumber.format(Swift.abs(rounded)))%"
  }

  /// "Jun 3", "wk of Jun 1", "Jun 2025": a bucket's name.
  public static func bucketLabel(_ t: Double, _ unit: AnalyticsUnit, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String {
    let ms = JSDate.timeClip(t)
    guard ms.isFinite else { return "" }
    if unit == .month {
      return AppLocale.toLocaleDateString(ms, DateFormatOptions(year: "numeric", month: "short"), locale: locale, timeZone: timeZone)
    }
    let day = AppLocale.toLocaleDateString(ms, DateFormatOptions(month: "short", day: "numeric"), locale: locale, timeZone: timeZone)
    return unit == .week ? "wk of \(day)" : day
  }

  /// The oldest event time in a pile (ms), or nil.
  public static func oldestEventMs<T: ArchiveTimed>(_ events: [T]?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> Double? {
    var oldest = Double.infinity
    for ev in events ?? [] {
      let at = timeOf(ev.atValue, timeZone: timeZone)
      if at.isFinite && at < oldest { oldest = at }
    }
    return oldest.isFinite ? oldest : nil
  }
}

// MARK: - Code-unit string helpers

extension String {
  func jsStartsWithUnits(_ prefix: String) -> Bool {
    let a = Array(utf16)
    let p = Array(prefix.utf16)
    return a.count >= p.count && Array(a[0..<p.count]) == p
  }

  func jsEndsWithUnits(_ suffix: String) -> Bool {
    let a = Array(utf16)
    let s = Array(suffix.utf16)
    return a.count >= s.count && Array(a[(a.count - s.count)...]) == s
  }

  func jsDropping(units n: Int) -> String {
    String(jsUnits: Array(utf16).dropFirst(n))
  }
}
