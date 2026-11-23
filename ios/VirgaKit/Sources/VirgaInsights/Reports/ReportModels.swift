// Ports src/reports/models.js
//
// What every report and every dashboard card draws: pure derivations over
// the archive for one period, computed once per (archive revision, period,
// options) and shared. A dashboard with a followers figure, a growth chart
// and a new-followers chart walks the follower list once, not three times.
//
// Each model takes `(archive, period, nowMs, options)`; `period` is one of
// ANALYTICS_PERIODS (or a custom range). All time starts at the oldest thing
// the model counts. Local time, the first day of the week and the locale are
// `formats` (the active ones by default), which the web reads from the
// browser and lib/locale.js.
//
// The rest of the module: ReportModels+Time.swift (when posts land),
// ReportModels+Content.swift (what posts are made of, lists and the follower
// log), ReportModels+Types.swift (what each returns).

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

public enum ReportModels {
  static let dayMs: Double = 86_400_000

  // MARK: - The cache

  /// How many results the cache keeps; the oldest go first past this.
  public static let cacheLimit = 80

  /// Results by key, the oldest first out past `limit`.
  final class Cache: Sendable {
    struct State {
      var order: [String] = []
      var values: [String: any Sendable] = [:]
    }

    let limit: Int
    let state = Locked(State())

    init(limit: Int) {
      self.limit = limit
    }

    func value<T: Sendable>(_ key: String, _ compute: () -> T) -> T {
      // A stored nil (an atmosphere model with no records) is a hit too, so
      // presence is checked apart from the value's type.
      if let stored = state.withLock({ $0.values[key] }), let hit = stored as? T { return hit }
      let value = compute()
      state.withLock { state in
        if state.values[key] == nil { state.order.append(key) }
        state.values[key] = value
        while state.order.count > limit {
          let oldest = state.order.removeFirst()
          state.values[oldest] = nil
        }
      }
      return value
    }

    func clear() {
      state.set(State())
    }
  }

  /// The one cache every report shares, as the web's module-level Map.
  static let cache = Cache(limit: cacheLimit)

  /// `compute()` once per archive revision, period and options; the same
  /// value after that. The oldest entries go first past `cacheLimit`.
  ///
  /// The key is the web's: the account, its revision and follow revision,
  /// the context's now, the formats, the model's name, the period's key and
  /// the options. Here the formats are the ones passed in (the web reads the
  /// active locale and week start, and never keys on the zone, which a
  /// browser doesn't change under a page).
  public static func cached<T: Sendable>(
    _ archive: ReportArchive, _ name: String, _ period: AnalyticsPeriod?, _ options: [(String, JSONValue)],
    formats: ReportFormats = .active, _ compute: () -> T
  ) -> T {
    cached(in: cache, archive, name, period, options, formats: formats, compute)
  }

  static func cached<T: Sendable>(
    in store: Cache, _ archive: ReportArchive, _ name: String, _ period: AnalyticsPeriod?,
    _ options: [(String, JSONValue)], formats: ReportFormats = .active, _ compute: () -> T
  ) -> T {
    store.value(cacheKey(archive, name, period, options, formats: formats), compute)
  }

  /// `[did, rev, followRev || 0, nowMs, localeStamp(), name, period?.key, JSON.stringify(options || {})].join('|')`.
  static func cacheKey(
    _ archive: ReportArchive, _ name: String, _ period: AnalyticsPeriod?, _ options: [(String, JSONValue)],
    formats: ReportFormats
  ) -> String {
    let optionText = "{" + options.map { "\($0.0.jsJSONQuoted):\(jsonText($0.1))" }.joined(separator: ",") + "}"
    return [
      archive.did, String(archive.rev), String(archive.followRev), archive.nowMs.map(JSNumber.format) ?? "",
      formats.stamp, name, period?.key ?? "", optionText,
    ].joined(separator: "|")
  }

  static func jsonText(_ value: JSONValue) -> String {
    switch value {
    case .string(let s): return s.jsJSONQuoted
    case .number(let n): return n.isFinite ? JSNumber.format(n) : "null"
    case .null: return "null"
    case .bool(let b): return b ? "true" : "false"
    default: return (try? value.data()).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }
  }

  /// A unit as an option (`null` for none).
  static func option(_ unit: AnalyticsUnit?) -> JSONValue { unit.map { .string($0.rawValue) } ?? .null }

  /// Forgets every cached result.
  public static func clearCache() {
    cache.clear()
  }

  // MARK: - Windows

  /// The window's start, its length in days and the units it can be drawn in.
  struct Window {
    var t0: Double
    var spanDays: Double
    var units: [AnalyticsUnit]
    var unit: AnalyticsUnit
  }

  // Every model takes "now" and reads it as where its window ends: for a
  // preset that is now, for a custom range the close of its last day, which
  // is what the first line of each (`periodEnd`) swaps in.

  static func windowOf(_ period: AnalyticsPeriod, _ nowMs: Double, _ oldestMs: Double, _ unitPick: AnalyticsUnit?) -> Window {
    let t0 = Periods.periodStart(period, nowMs) ?? (oldestMs.isFinite ? oldestMs : nowMs)
    let spanDays = JSMath.max(1, ((nowMs - t0) / dayMs).jsRounded)
    let days = period.days.map(Double.init) ?? spanDays
    let units = Analytics.unitChoicesFor(days)
    let unit = unitPick.flatMap { units.contains($0) ? $0 : nil } ?? Analytics.defaultUnitFor(days)
    return Window(t0: t0, spanDays: spanDays, units: units, unit: unit)
  }

  /// `period.days || spanDays`.
  static func compareDays(_ period: AnalyticsPeriod, _ window: Window) -> Double {
    if let days = period.days, days != 0 { return Double(days) }
    return window.spanDays
  }

  /// The smallest of `pick` over `list`; Infinity for none.
  static func minOf<T>(_ list: [T], _ pick: (T) -> Double) -> Double {
    var min = Double.infinity
    for item in list {
      let v = pick(item)
      if v < min { min = v }
    }
    return min
  }

  /// `Date.parse(text || '')`.
  static func parse(_ text: String?, _ formats: ReportFormats) -> Double {
    JSDate.parse(text ?? "", timeZone: formats.timeZone)
  }

  /// `Date.parse(value)` for any value (`String(value)` first; undefined is NaN).
  static func parse(_ value: JSONValue?, _ formats: ReportFormats) -> Double {
    guard let value else { return .nan }
    return JSDate.parse(value.stringValue ?? value.jsString, timeZone: formats.timeZone)
  }

  static func series<T>(_ items: [T], _ w: Window, t1: Double, _ formats: ReportFormats, _ at: (T) -> Double) -> [SeriesPoint] {
    Analytics.bucketSeries(
      items, unit: w.unit, t0: w.t0, t1: t1, timeZone: formats.timeZone, weekStart: formats.weekStart,
      pickTime: { .number(at($0)) })
  }

  // MARK: - Followers

  public static func followersModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, unit unitPick: AnalyticsUnit? = nil,
    formats: ReportFormats = .active
  ) -> FollowersReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "followers", period, [("unitPick", option(unitPick))], formats: formats) {
      var dated: [DatedFollower] = []
      for f in archive.followers {
        let atMs = parse(f.followedAt, formats)
        if atMs.isFinite { dated.append(DatedFollower(row: f, atMs: atMs)) }
      }
      let undated = archive.followers.count - dated.count
      let w = windowOf(period, nowMs, minOf(dated, \.atMs), unitPick)
      let inWindow = dated.filter { $0.atMs >= w.t0 && $0.atMs <= nowMs }
      let counts = series(inWindow, w, t1: nowMs, formats, \.atMs)
      let baseline = dated.filter { $0.atMs < w.t0 }.count
      let datedBlocks = archive.blocks.map { parse($0.blockedAt, formats) }.filter(\.isFinite)
      let blockCounts = series(datedBlocks, w, t1: nowMs, formats) { $0 }
      let blockBaseline = datedBlocks.filter { $0 < w.t0 }.count
      let compare = Analytics.comparePeriods(
        dated, days: compareDays(period, w), now: nowMs, timeZone: formats.timeZone, pickTime: { .number($0.atMs) })
      let profileCount = archive.meta.followers?.profileCount
      return FollowersReport(
        total: archive.followers.count,
        undated: undated,
        unit: w.unit,
        units: w.units,
        counts: counts,
        cumulative: Analytics.cumulativeSeries(counts, Double(baseline)),
        blockCumulative: Analytics.cumulativeSeries(blockCounts, Double(blockBaseline)),
        gained: inWindow.count,
        perDay: Double(inWindow.count) / w.spanDays,
        compare: compare,
        spanDays: w.spanDays,
        profileCount: profileCount,
        counterGap: profileCount.map { $0 - archive.followers.count },
        newest: Array(JSSort.sort(inWindow) { $1.atMs - $0.atMs }.prefix(50)),
        biggestDays: biggestDays(inWindow, formats: formats))
    }
  }

  /// The days in a window with the most new followers, largest first.
  static func biggestDays(_ dated: [DatedFollower], limit: Int = 5, formats: ReportFormats) -> [DayCount] {
    var order: [Double] = []
    var byDay: [Double: Int] = [:]
    for f in dated {
      guard let d = JSDate.fields(f.atMs, timeZone: formats.timeZone) else { continue }
      let day = JSDate.local(Double(d.year), Double(d.month), Double(d.date), timeZone: formats.timeZone)
      if byDay[day] == nil { order.append(day) }
      byDay[day, default: 0] += 1
    }
    let days = order.map { DayCount(t: $0, n: byDay[$0]!) }
    let sorted = JSSort.sort(days) { a, b in
      let d = Double(b.n - a.n)
      return d != 0 ? d : b.t - a.t
    }
    return Array(sorted.prefix(limit))
  }

  // MARK: - Blocks

  public static func blocksModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, unit unitPick: AnalyticsUnit? = nil,
    formats: ReportFormats = .active
  ) -> BlocksReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "blocks", period, [("unitPick", option(unitPick))], formats: formats) {
      let reach = Analytics.blockReach(archive.blocks, timeZone: formats.timeZone)
      let dated = reach.people.map { (person: $0, atMs: parse($0.blockedAt, formats)) }.filter { $0.atMs.isFinite }
      let undated = reach.people.count - dated.count
      let w = windowOf(period, nowMs, minOf(dated, \.atMs), unitPick)
      let inWindow = dated.filter { $0.atMs >= w.t0 && $0.atMs <= nowMs }
      let counts = series(inWindow, w, t1: nowMs, formats, \.atMs)
      let baseline = dated.filter { $0.atMs < w.t0 }.count
      let direct = dated.filter { $0.person.source == "direct" }
      let viaLists = dated.filter { $0.person.source == "list" }
      let directCounts = series(direct, w, t1: nowMs, formats, \.atMs)
      let listCounts = series(viaLists, w, t1: nowMs, formats, \.atMs)
      let datedFollowers = archive.followers.map { parse($0.followedAt, formats) }.filter(\.isFinite)
      let followerCounts = series(datedFollowers, w, t1: nowMs, formats) { $0 }
      return BlocksReport(
        total: reach.people.count,
        directTotal: reach.directCount,
        listTotal: reach.listCount,
        overlap: reach.overlapCount,
        undated: undated,
        unit: w.unit,
        units: w.units,
        counts: counts,
        trend: Analytics.movingAverage(counts, 7),
        cumulative: Analytics.cumulativeSeries(counts, Double(baseline)),
        directCumulative: Analytics.cumulativeSeries(directCounts, Double(direct.filter { $0.atMs < w.t0 }.count)),
        listCumulative: Analytics.cumulativeSeries(listCounts, Double(viaLists.filter { $0.atMs < w.t0 }.count)),
        followerCumulative: Analytics.cumulativeSeries(followerCounts, Double(datedFollowers.filter { $0 < w.t0 }.count)),
        received: inWindow.count,
        perDay: Double(inWindow.count) / w.spanDays,
        compare: Analytics.comparePeriods(
          dated, days: compareDays(period, w), now: nowMs, timeZone: formats.timeZone, pickTime: { .number($0.atMs) }))
    }
  }

  // MARK: - Posts

  /// The archive's posts that have a readable time, each with it (`atMs`).
  static func datedPosts(_ archive: ReportArchive, formats: ReportFormats) -> [PostRow] {
    cached(archive, "datedPosts", nil, [], formats: formats) {
      archive.posts.compactMap { p in
        let atMs = JSDate.parse(p.at ?? "undefined", timeZone: formats.timeZone)
        guard atMs.isFinite else { return nil }
        var dated = p
        dated.atMs = atMs
        return dated
      }
    }
  }

  /// `p.atMs` of a dated post.
  static func at(_ p: PostRow) -> Double { p.atMs ?? .nan }

  public static func postsModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, unit unitPick: AnalyticsUnit? = nil,
    formats: ReportFormats = .active
  ) -> PostsReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "posts", period, [("unitPick", option(unitPick))], formats: formats) {
      let dated = datedPosts(archive, formats: formats)
      let w = windowOf(period, nowMs, minOf(dated, at), unitPick)
      let inWindow = dated.filter { at($0) >= w.t0 && at($0) <= nowMs }
      let counts = series(inWindow, w, t1: nowMs, formats, at)
      let replies = inWindow.filter { !($0.replyTo ?? "").isEmpty }.count
      let quotes = inWindow.filter { !($0.quoteOf ?? "").isEmpty }.count
      let withMedia = inWindow.filter { $0.hasMedia == true }.count
      return PostsReport(
        unit: w.unit,
        units: w.units,
        counts: counts,
        trend: Analytics.movingAverage(counts, 7),
        count: inWindow.count,
        perDay: Double(inWindow.count) / w.spanDays,
        replies: replies,
        quotes: quotes,
        originals: inWindow.count - replies,
        withMedia: withMedia,
        compare: Analytics.comparePeriods(
          dated, days: compareDays(period, w), now: nowMs, timeZone: formats.timeZone, pickTime: { .number(at($0)) }),
        spanDays: w.spanDays)
    }
  }

  // MARK: - Engagement received

  public static func engagementModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, kind: String = "all",
    unit unitPick: AnalyticsUnit? = nil, rateUnit ratePick: AnalyticsUnit? = nil, formats: ReportFormats = .active
  ) -> EngagementReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    let options: [(String, JSONValue)] = [("kind", .string(kind)), ("unitPick", option(unitPick)), ("ratePick", option(ratePick))]
    return cached(archive, "engagement", period, options, formats: formats) {
      let did = archive.did
      let dated = datedPosts(archive, formats: formats)
      let w = windowOf(period, nowMs, minOf(dated, at), unitPick)
      let inWindow = dated.filter { at($0) >= w.t0 && at($0) <= nowMs }
      let value = { (p: PostRow) in Analytics.engagementOf(p, kind) }
      let total = inWindow.reduce(0) { $0 + value($1) }
      let series = Analytics.bucketSeries(
        inWindow, unit: w.unit, t0: w.t0, t1: nowMs, timeZone: formats.timeZone, weekStart: formats.weekStart,
        pickTime: { .number(at($0)) }, pickValue: { Double(value($0)) })
      // The rate: engagement per post, over the owner's own voice only: top-
      // level posts and threads, never replies to other people.
      let own = dated.filter { Analytics.isOwnVoicePost($0, did) }
      let ownInWindow = own.filter { at($0) >= w.t0 && at($0) <= nowMs }
      let ownTotal = ownInWindow.reduce(0) { $0 + value($1) }
      let rateUnit = ratePick.flatMap { w.units.contains($0) ? $0 : nil } ?? (w.units.contains(.week) ? .week : w.unit)
      let rate = Analytics.rateSeries(
        ownInWindow, unit: rateUnit, t0: w.t0, t1: nowMs, kind: kind, timeZone: formats.timeZone,
        weekStart: formats.weekStart)
      let byKind = Analytics.engagementKinds.filter { $0.key != "all" }.map { k in
        KindValue(kind: k.key, label: k.label, value: inWindow.reduce(0) { $0 + Analytics.engagementOf($1, k.key) })
      }
      return EngagementReport(
        unit: w.unit,
        units: w.units,
        series: series,
        trend: Analytics.movingAverage(series, 7),
        total: total,
        byKind: byKind,
        posts: inWindow.count,
        // Twenty, for a dashboard card set to show that many; the report shows ten.
        top: Analytics.topPosts(inWindow, kind: kind, t0: w.t0, t1: nowMs, limit: 20, timeZone: formats.timeZone),
        compare: Analytics.comparePeriods(
          dated, days: compareDays(period, w), now: nowMs, timeZone: formats.timeZone, pickTime: { .number(at($0)) },
          pickValue: { Double(value($0)) }),
        rateUnit: rateUnit,
        rate: rate,
        rateTrend: Analytics.rollingRate(rate, 5),
        ownPosts: ownInWindow.count,
        ownRate: ownInWindow.isEmpty ? nil : Double(ownTotal) / Double(ownInWindow.count),
        rateCompare: period.days.flatMap { $0 == 0 ? nil : $0 }.map {
          Analytics.compareRates(own, days: Double($0), now: nowMs, kind: kind, timeZone: formats.timeZone)
        })
    }
  }

  // MARK: - Engagement given

  /// What a count of each kind given is called.
  public static let givenNoun: [(kind: String, noun: String)] = [
    ("like", "likes"), ("repost", "reposts"), ("reply", "replies"), ("quote", "quotes"),
  ]

  public static func givenModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, kind: String = "all",
    unit unitPick: AnalyticsUnit? = nil, formats: ReportFormats = .active
  ) -> GivenReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    let options: [(String, JSONValue)] = [("kind", .string(kind)), ("unitPick", option(unitPick))]
    return cached(archive, "given", period, options, formats: formats) {
      var all: [(event: EngagementEvent, atMs: Double)] = []
      for ev in Analytics.givenEvents(archive.outbound, archive.posts, archive.did) {
        let atMs = parse(ev.at, formats)
        if atMs.isFinite { all.append((ev, atMs)) }
      }
      let w = windowOf(period, nowMs, minOf(all, \.atMs), unitPick)
      let inWindowAll = all.filter { $0.atMs >= w.t0 && $0.atMs <= nowMs }
      let byKind = JSSort.sort(
        givenNoun.map { k in KindCount(kind: k.kind, count: inWindowAll.filter { $0.event.kind.jsEquals(k.kind) }.count) }
      ) { Double($1.count - $0.count) }
      let events = kind == "all" ? all : all.filter { $0.event.kind.jsEquals(kind) }
      let inWindow = kind == "all" ? inWindowAll : inWindowAll.filter { $0.event.kind.jsEquals(kind) }
      let series = series(inWindow, w, t1: nowMs, formats, \.atMs)
      return GivenReport(
        unit: w.unit,
        units: w.units,
        series: series,
        trend: Analytics.movingAverage(series, 7),
        total: inWindow.count,
        perDay: Double(inWindow.count) / w.spanDays,
        accounts: Set(inWindow.map { JSKey($0.event.did) }).count,
        byKind: byKind,
        compare: Analytics.comparePeriods(
          events, days: compareDays(period, w), now: nowMs, timeZone: formats.timeZone, pickTime: { .number($0.atMs) }))
    }
  }

  // MARK: - People

  /// Everyone who engaged with the account in the window (`inbound`), and
  /// everyone it engaged with (`outbound`), ranked, unfiltered. The People
  /// report filters these by relationship; the cards take the top few.
  public static func peopleModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, kind: String = "all",
    formats: ReportFormats = .active
  ) -> PeopleReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "people", period, [("kind", .string(kind))], formats: formats) {
      let zone = formats.timeZone
      let outboundAll = archive.outbound + Analytics.outboundFromPosts(archive.posts)
      let inT0 =
        Periods.periodStart(period, nowMs) ?? Analytics.oldestEventMs(archive.inbound, timeZone: zone) ?? nowMs
      let outT0 = Periods.periodStart(period, nowMs) ?? Analytics.oldestEventMs(outboundAll, timeZone: zone) ?? nowMs
      return PeopleReport(
        inbound: Analytics.topActors(
          archive.inbound, kind: kind, t0: inT0, t1: nowMs, limit: Int.max, excludeDid: archive.did, timeZone: zone),
        outbound: kind == "mention"
          ? []
          : Analytics.topActors(
            outboundAll, kind: kind, t0: outT0, t1: nowMs, limit: Int.max, excludeDid: archive.did, timeZone: zone),
        inOldest: Analytics.oldestEventMs(archive.inbound, timeZone: zone),
        inT0: inT0)
    }
  }

  /// Sets of who follows the account and whom it follows, by DID.
  public static func relationSets(_ archive: ReportArchive, formats: ReportFormats = .active) -> RelationSets {
    cached(archive, "relations", nil, [], formats: formats) {
      RelationSets(followers: archive.followers, following: archive.following)
    }
  }

  /// Followers who engage with the account and whom it doesn't follow back,
  /// most engaged first: the Follow-back queue.
  public static func followBackModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, formats: ReportFormats = .active
  ) -> [TopActor] {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "followBack", period, [], formats: formats) {
      let sets = relationSets(archive, formats: formats)
      let people = peopleModel(archive, period, nowMs, formats: formats)
      return people.inbound.filter { sets.isFollower($0.did) && !sets.isFollowed($0.did) }
    }
  }

  // MARK: - Atmosphere

  public static func atmosphereModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, unit unitPick: AnalyticsUnit? = nil,
    formats: ReportFormats = .active
  ) -> AtmosphereReport? {
    let nowMs = Periods.periodEnd(period, nowMs)
    return cached(archive, "atmosphere", period, [("unitPick", option(unitPick))], formats: formats) {
      () -> AtmosphereReport? in
      let atmosphere = archive.atmosphere
      if atmosphere.isEmpty { return nil }
      let w = windowOf(period, nowMs, minOf(atmosphere, \.at), unitPick)
      let inWindow = atmosphere.filter { $0.at >= w.t0 && $0.at <= nowMs }
      var order: [JSKey] = []
      var byCollection: [JSKey: Int] = [:]
      for r in inWindow {
        let key = JSKey(r.collection)
        if byCollection[key] == nil { order.append(key) }
        byCollection[key, default: 0] += 1
      }
      let ranked = JSSort.sort(order.map { CollectionCount(collection: $0.value, count: byCollection[$0]!) }) { a, b in
        let d = Double(b.count - a.count)
        if d != 0 { return d }
        return JSMath.less(a.collection, b.collection) ? -1 : 1
      }
      let series = series(inWindow, w, t1: nowMs, formats, \.at)
      return AtmosphereReport(
        unit: w.unit,
        units: w.units,
        series: series,
        trend: Analytics.movingAverage(series, 7),
        total: inWindow.count,
        collections: ranked.count,
        ranked: ranked,
        spanDays: w.spanDays,
        allTime: atmosphere.count)
    }
  }
}

/// JavaScript's Math and comparison operators where Swift's differ.
enum JSMath {
  /// `Math.max(a, b)`: NaN if either is; +0 over -0.
  static func max(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? b : a }
    return a > b ? a : b
  }

  /// `Math.min(a, b)`: NaN if either is; -0 under +0.
  static func min(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? a : b }
    return a < b ? a : b
  }

  /// `a < b` for strings: by UTF-16 code unit.
  static func less(_ a: String, _ b: String) -> Bool {
    a.utf16.lexicographicallyPrecedes(b.utf16)
  }

  /// `x || y` for comparator terms: the first that is neither 0 nor NaN.
  static func or(_ terms: Double...) -> Double {
    for term in terms where term != 0 && !term.isNaN { return term }
    return terms.last ?? 0
  }
}
