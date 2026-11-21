// Ports src/defense/harvest.js
//
// Everyone who touched a post, and how, from Constellation rather than the
// AppView's getLikes and getRepostedBy: the AppView answers as a viewer and
// leaves out the accounts behind blocks and mutes already in place, so it
// would hide the people already acted on. Constellation indexes the
// firehose and answers the same for everyone.
//
// Sources are discovered, not declared: a counts call (`/links/all`)
// returns every (collection, path) pair pointing at the post, so a like is
// found the same way as engagement from a lexicon this code has never heard
// of. Nothing here judges anyone; bands and the veto live in score.js and
// veto.js and run over this output.
//
// The functions live on the `Harvest` struct (Harvest+Types.swift), which is
// what `harvestPost` resolves to. The web's AbortSignal is task
// cancellation: Constellation's client answers nil once the task is
// cancelled, a failed page isn't asked for again, and no further source is
// started.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// How far a harvest has got: `done` of `total` sources read.
public struct HarvestProgress: Codable, Hashable, Sendable {
  public var done: Int
  public var total: Int

  public init(done: Int, total: Int) {
    self.done = done
    self.total = total
  }
}

/// How a harvest reports its progress: awaited, one report at a time, in
/// the order they were counted.
public typealias HarvestProgressHandler = @Sendable (HarvestProgress) async -> Void

/// The harvest couldn't start: Constellation didn't answer the counts call.
public struct HarvestError: Error, LocalizedError, Hashable, Sendable, CustomStringConvertible {
  public var message: String

  public init(message: String) {
    self.message = message
  }

  public var errorDescription: String? { message }
  public var description: String { message }
}

extension Harvest {
  /// PAGE: Constellation pages at 100; anything larger is clamped.
  static let page = 100

  /// MAX_PAGES: pages read from one source before stopping. The cap is per
  /// source, so a post with 20k likes still yields every reply and quote;
  /// `truncated` says when it applied.
  public static let maxPages = 60

  /// MAX_OTHER_SOURCES: sources outside Bluesky's own kinds one harvest
  /// reads, largest first. Anyone can add sources to a post.
  static let maxOtherSources = 10

  /// SOURCE_CONCURRENCY: sources paged at once (the public instance is shared).
  static let sourceConcurrency = 3

  /// KIND_ORDER: engagement kinds loudest first. Says nothing about how
  /// hostile any of them is.
  public static let kindOrder = ["quote", "reply", "threadReply", "repost", "like", "gate"]

  /// The sentence harvestPost throws when Constellation didn't answer.
  public static let constellationDown =
    "Constellation didn't answer. It's the only complete record of who engaged with a post, so there's nothing to scan without it. Try again in a minute."

  /// `isDid(value)`: whether a string is DID syntax and nothing else
  /// (`/^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/`; the `$` is the end
  /// of the string, never before a final line break).
  public static func isDid(_ value: String?) -> Bool {
    guard let value else { return false }
    let units = Array(value.utf16)
    let prefix: [UInt16] = Array("did:".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return false }
    var i = prefix.count
    let methodStart = i
    while i < units.count, units[i] >= 0x61, units[i] <= 0x7A { i += 1 }
    guard i > methodStart, i < units.count, units[i] == 0x3A else { return false }
    i += 1
    guard i < units.count else { return false }
    func idUnit(_ u: UInt16) -> Bool {
      (u >= 0x61 && u <= 0x7A) || (u >= 0x41 && u <= 0x5A) || (u >= 0x30 && u <= 0x39) || u == 0x2E || u == 0x5F
        || u == 0x2D
    }
    for u in units[i...] where !(idUnit(u) || u == 0x3A || u == 0x25) { return false }
    return idUnit(units[units.count - 1])
  }

  /// `isDid(value)` for a value of any type: only a string can be one.
  public static func isDid(_ value: JSONValue?) -> Bool {
    isDid(value?.stringValue)
  }

  /// `engagementKind({ collection, path })`: Bluesky's own verbs by exact
  /// path, anything else `other` (its collection name is chosen by whoever
  /// wrote the record, so it is never shown). `reply` answers the post
  /// itself; `threadReply` is anyone in the thread it starts.
  public static func engagementKind(collection: String, path: String) -> String {
    let p = path.utf16.first == 0x2E ? path.jsSlice(1) : path
    if collection.jsEquals("app.bsky.feed.like") && p.jsEquals("subject.uri") { return "like" }
    if collection.jsEquals("app.bsky.feed.repost") && p.jsEquals("subject.uri") { return "repost" }
    if collection.jsEquals("app.bsky.feed.post") {
      if p.jsEquals("reply.parent.uri") { return "reply" }
      if p.jsEquals("reply.root.uri") { return "threadReply" }
      if p.jsEquals("embed.record.uri") || p.jsEquals("embed.record.record.uri") { return "quote" }
    }
    if collection.jsEquals("app.bsky.feed.threadgate") && p.jsEquals("post") { return "gate" }
    return "other"
  }

  /// `engagementKind(source)` for a row of Constellation's flattenSources.
  public static func engagementKind(_ source: BacklinkSource) -> String {
    engagementKind(collection: source.collection, path: source.path)
  }

  /// `primaryKind(engagements)`: the loudest kind there is, else the first
  /// one counted (the web's first key), nil for none. `kinds` are in the
  /// order they were first counted.
  static func primaryKind(_ kinds: [String], counts: [String: Int]) -> String? {
    for kind in kindOrder where (counts[kind] ?? 0) != 0 { return kind }
    return kinds.first
  }

  /// One source paged: its rows, and whether it was cut short or never
  /// answered.
  struct Drained: Sendable {
    var rows: [JSONValue]
    var truncated: Bool
    var failed: Bool
  }

  /// `rows.push(...backlinkRows(page))`: the rows of a page, spread as
  /// JavaScript spreads them. A string spreads to its characters, which name
  /// nobody; an object, a number or true isn't iterable, and V8 throws.
  static func spread(_ rows: JSONValue) throws -> [JSONValue] {
    switch rows {
    case .array(let items): return items
    case .string: return []
    case .null, .bool(false): return []
    case .number(let n) where n == 0 || n.isNaN: return []
    default:
      throw JSError(name: "TypeError", message: "Spread syntax requires ...iterable[Symbol.iterator] to be a function")
    }
  }

  /// `drainSource(uri, source, { signal, maxPages })`: page one source. One
  /// that fails outright comes back empty and `failed`, so one dead lexicon
  /// doesn't cost the likes; one that fails part way comes back `truncated`,
  /// never complete. A failed page is asked for once more first.
  static func drainSource(
    _ uri: String,
    _ source: String,
    maxPages: Int,
    transport: any HTTPTransport,
    clock: NetworkClock
  ) async throws -> Drained {
    var rows: [JSONValue] = []
    var cursor: String?
    var pages = 0
    while pages < maxPages {
      let asked = cursor
      let first = await Constellation.getBacklinks(uri, source, limit: page, cursor: asked, transport: transport, clock: clock)
      // `(await read()) ?? (signal?.aborted ? null : await read())`: only a
      // missing answer (or JSON null) is asked for again.
      let answer: JSONValue?
      if let first, !first.isNull {
        answer = first
      } else if Task.isCancelled {
        answer = nil
      } else {
        answer = await Constellation.getBacklinks(uri, source, limit: page, cursor: asked, transport: transport, clock: clock)
      }
      guard let answer, answer.isTruthy else {
        return Drained(rows: rows, truncated: pages > 0, failed: pages == 0)
      }
      rows.append(contentsOf: try spread(Constellation.backlinkRows(answer)))
      pages += 1
      guard let next = answer["cursor"], next.isTruthy else {
        return Drained(rows: rows, truncated: false, failed: false)
      }
      cursor = next.jsString
    }
    return Drained(rows: rows, truncated: true, failed: false)
  }

  /// A count as a whole number: harvest.js keeps Constellation's count as it
  /// came, which is always a whole number of records.
  static func wholeCount(_ n: Double) -> Int {
    guard n.isFinite else { return n > 0 ? Int.max : 0 }
    return Int(Swift.max(-9e15, Swift.min(9e15, n)))
  }

  /// `harvestPost(uri, { signal, maxPages, onProgress, only })`: every
  /// account that interacted with `uri`.
  ///
  /// `truncated` is true when anything was left out: a source cut at the
  /// page cap, a source that never answered, or a source past the cap on
  /// others. `unread` names the kinds of the sources that never answered,
  /// with Constellation's count of their records. `onProgress` hears
  /// `{ done, total }` sources, from 0, one report at a time and counting
  /// up, every one before this returns or throws. `now` is when the harvest
  /// is stamped (`harvestedAt`). Throws HarvestError when Constellation
  /// didn't answer the counts call, and CancellationError when the task was
  /// cancelled before it did.
  public static func harvestPost(
    _ uri: String,
    maxPages: Int = Harvest.maxPages,
    only: [String]? = nil,
    onProgress: HarvestProgressHandler? = nil,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock,
    now: @escaping @Sendable () -> Date = { Date() }
  ) async throws -> Harvest {
    let answered = await Constellation.getBacklinkSources(uri, transport: transport, clock: clock)
    guard let flat = Constellation.flattenSources(answered) else {
      try Task.checkCancellation()
      throw HarvestError(message: constellationDown)
    }

    let wanted = flat.filter { s in
      s.countNumber > 0 && (only.map { $0.jsIncludes(engagementKind(s)) } ?? true)
    }
    let known = wanted.filter { engagementKind($0) != "other" }
    let others = wanted.filter { engagementKind($0) == "other" }
    let live = known + others.jsSlice(0, maxOtherSources)

    // The web calls onProgress synchronously as each source drains, so its
    // reports only count up. Sources drain side by side here, so each report
    // is queued as it is counted and handed over in that order.
    let (reports, queue) = AsyncStream.makeStream(of: HarvestProgress.self)
    let reporter = Task {
      for await progress in reports { await onProgress?(progress) }
    }
    let total = live.count
    let done = Locked(0)
    queue.yield(HarvestProgress(done: 0, total: total))
    let drained: [Drained]
    do {
      drained = try await Limit.mapLimit(live, sourceConcurrency) { src, _ in
        let out = try await drainSource(uri, src.source, maxPages: maxPages, transport: transport, clock: clock)
        done.withLock { n in
          n += 1
          queue.yield(HarvestProgress(done: n, total: total))
        }
        return out
      }
    } catch {
      queue.finish()
      await reporter.value
      throw error
    }
    queue.finish()
    await reporter.value

    // Folded in the order the sources were listed, so participants come out
    // the same however the reads finished.
    struct Entry {
      var did: String
      var kinds: [String] = []
      var counts: [String: Int] = [:]
      var records: [EngagementRecord] = []
      var total = 0
    }
    var entries: [Entry] = []
    var index: [JSKey: Int] = [:]
    var unread: [UnreadKind] = []
    var sources: [HarvestSource] = []
    var records = 0
    for (i, src) in live.enumerated() {
      let kind = engagementKind(src)
      let result = drained[i]
      for row in result.rows {
        // A DID comes from whoever wrote the backlinked record. One that
        // isn't DID syntax is nobody to block, and kept, it would reach the
        // page as text someone chose.
        guard let did = row["did"]?.stringValue, isDid(did) else { continue }
        records += 1
        let key = JSKey(did)
        let at: Int
        if let found = index[key] {
          at = found
        } else {
          at = entries.count
          index[key] = at
          entries.append(Entry(did: did))
        }
        if entries[at].counts[kind] == nil { entries[at].kinds.append(kind) }
        entries[at].counts[kind, default: 0] += 1
        entries[at].total += 1
        let collection = row["collection"].nonNull.map(\.jsString) ?? src.collection
        entries[at].records.append(EngagementRecord(kind: kind, rkey: row["rkey"].nonNull.map(\.jsString), collection: collection))
      }
      sources.append(
        HarvestSource(
          collection: src.collection, path: src.path, source: src.source, count: wholeCount(src.countNumber),
          distinctDids: src.distinctDids.isNull ? nil : wholeCount(src.distinctDids.jsNumber), kind: kind,
          truncated: result.truncated, failed: result.failed))
      if result.failed {
        let count = wholeCount(src.countNumber)
        if let at = unread.firstIndex(where: { $0.kind.jsEquals(kind) }) {
          unread[at].count += count
        } else {
          unread.append(UnreadKind(kind: kind, count: count))
        }
      }
    }

    let unsorted = entries.map { e in
      Participant(
        did: e.did, engagements: e.counts, records: e.records, total: e.total,
        primary: primaryKind(e.kinds, counts: e.counts))
    }
    // Loudest engagement first, then most engagements.
    func rank(_ kind: String?) -> Int {
      kind.flatMap { k in kindOrder.firstIndex { $0.jsEquals(k) } } ?? kindOrder.count
    }
    let participants = unsorted.jsSorted { a, b in
      let byKind = rank(a.primary) - rank(b.primary)
      return Double(byKind != 0 ? byKind : b.total - a.total)
    }

    var engagements: [String: Int] = [:]
    for p in participants {
      for (kind, n) in p.engagements { engagements[kind, default: 0] += n }
    }

    let stamped = (now().timeIntervalSince1970 * 1000).rounded()
    return Harvest(
      uri: uri,
      harvestedAt: JSDate.toISOString(stamped),
      sources: sources,
      participants: participants,
      totals: HarvestTotals(participants: participants.count, engagements: engagements, records: records),
      truncated: sources.contains(where: \.truncated) || !unread.isEmpty || others.count > maxOtherSources,
      unread: unread)
  }
}
