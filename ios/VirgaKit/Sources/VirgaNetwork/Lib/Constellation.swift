// Ports src/lib/constellation.js
//
// The Constellation backlinks service (https://constellation.microcosm.blue):
// who links to a record or an account, by collection and path. Every call
// swallows network and HTTP failures and answers nil, so the app can show
// "Unavailable" without wrapping each call. The public instance is
// best-effort and rate-limited, so a 429, 502, 503 or 504 (or a network
// failure) is retried after 1, 2.5, 5 and 10 seconds, or after the
// Retry-After it asks for (at most 15 seconds), and each attempt has a
// deadline of its own. Cancelling the task stops it, answering nil.

import Foundation
import VirgaCore

/// A row of flattenSources: one source (collection and path) that links to
/// the target, with Constellation's counts.
public struct BacklinkSource: Codable, Sendable, Hashable {
  public var collection: String
  /// The path as `/links/all` gives it, with its leading dot.
  public var path: String
  /// `<collection>:<path without the dot>`, as getBacklinks takes it.
  public var source: String
  /// The count as Constellation gave it (normally a number).
  public var count: JSONValue
  public var distinctDids: JSONValue

  /// `Number(count)`.
  public var countNumber: Double { count.jsNumber }
}

public enum Constellation {
  public static let constellationBase = "https://constellation.microcosm.blue"
  public static let retryDelaysMs: [Double] = [1000, 2500, 5000, 10_000]
  /// The longest a Retry-After is taken at its word.
  public static let maxRetryDelayMs: Double = 15_000

  /// `fetchJsonOrNull(url, init)`: the parsed answer, or nil once the
  /// retries are spent or the task is cancelled.
  static func fetchJsonOrNull<T: Sendable>(
    _ url: String,
    transport: any HTTPTransport,
    clock: NetworkClock,
    parse: (HTTPResponse) throws -> T
  ) async -> T? {
    for attempt in 0...retryDelaysMs.count {
      if Task.isCancelled { return nil }
      do {
        let response = try await Atproto.fetchWithTimeout(
          HTTPRequest(url: url, headers: ["Accept": "application/json"]), transport: transport)
        if response.ok { return try parse(response) }
        let retryable = [429, 502, 503, 504].contains(response.status)
        if !retryable || attempt == retryDelaysMs.count { return nil }
        await clock.sleep(retryDelayMs(response, attempt: attempt, now: clock.now()))
      } catch {
        if Task.isCancelled || attempt == retryDelaysMs.count { return nil }
        await clock.sleep(retryDelaysMs[attempt])
      }
    }
    return nil
  }

  /// How long to wait before the next attempt: the Retry-After, in seconds
  /// or as a date, held to 0…15 s, else the back-off for this attempt.
  static func retryDelayMs(_ response: HTTPResponse, attempt: Int, now: Double) -> Double {
    if let raw = response.headers.get("retry-after"), !raw.isEmpty {
      let seconds = JSNumber.toNumber(raw)
      if seconds.isFinite { return clampDelay(seconds * 1000) }
      let date = JSDate.parse(raw, timeZone: AppLocale.activeTimeZone())
      if date.isFinite { return clampDelay(date - now) }
    }
    return retryDelaysMs[attempt]
  }

  static func clampDelay(_ ms: Double) -> Double {
    min(maxRetryDelayMs, max(0, ms))
  }

  /// `getBacklinkSources(target)`: every source that links to `target` (an
  /// AT URI, or a bare DID for follows and blocks) with its counts, from
  /// `/links/all`, in the order Constellation listed them:
  /// `{ links: { "app.bsky.feed.like": { ".subject.uri": { records,
  /// distinct_dids } } } }`.
  public static func getBacklinkSources(
    _ target: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> OrderedJSON? {
    guard let target, !target.isEmpty else { return nil }
    let url = "\(constellationBase)/links/all?target=\(JSURI.encodeURIComponent(target))"
    return await fetchJsonOrNull(url, transport: transport, clock: clock) { try OrderedJSON.parse($0.body) }
  }

  /// `getBacklinkCount(target, source)`: the count for one source
  /// (`app.bsky.feed.like:subject.uri`).
  public static func getBacklinkCount(
    _ target: String?,
    _ source: String?,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> JSONValue? {
    guard let target, !target.isEmpty, let source, !source.isEmpty else { return nil }
    let params = JSURI.searchParams([("subject", target), ("source", source)])
    let url = "\(constellationBase)/xrpc/blue.microcosm.links.getBacklinksCount?\(params)"
    return await fetchJsonOrNull(url, transport: transport, clock: clock) { try $0.json() }
  }

  /// `getBacklinks(target, source, { limit, cursor, dids })`: a page of
  /// backlinks; read its rows with backlinkRows. `dids` keeps only links
  /// made by those accounts.
  public static func getBacklinks(
    _ target: String?,
    _ source: String?,
    limit: Int = 25,
    cursor: String? = nil,
    dids: [String]? = nil,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> JSONValue? {
    guard let target, !target.isEmpty, let source, !source.isEmpty else { return nil }
    var pairs = [("subject", target), ("source", source), ("limit", String(limit))]
    if let cursor, !cursor.isEmpty { pairs.append(("cursor", cursor)) }
    for did in dids ?? [] { pairs.append(("did", did)) }
    let url = "\(constellationBase)/xrpc/blue.microcosm.links.getBacklinks?\(JSURI.searchParams(pairs))"
    return await fetchJsonOrNull(url, transport: transport, clock: clock) { try $0.json() }
  }

  /// `getManyToMany(subject, source, pathToOther, { limit, cursor,
  /// otherSubject })`: records that link to `subject` through `source` and to
  /// a second target through `pathToOther` (a list item and its list):
  /// `{ items: [{ linkRecord: { did, collection, rkey }, otherSubject }], cursor }`.
  public static func getManyToMany(
    _ subject: String?,
    _ source: String?,
    _ pathToOther: String?,
    limit: Int = 100,
    cursor: String? = nil,
    otherSubject: String? = nil,
    transport: any HTTPTransport = HTTP.transport,
    clock: NetworkClock = HTTP.clock
  ) async -> JSONValue? {
    guard let subject, !subject.isEmpty, let source, !source.isEmpty, let pathToOther, !pathToOther.isEmpty else {
      return nil
    }
    var pairs = [("subject", subject), ("source", source), ("pathToOther", pathToOther), ("limit", String(limit))]
    if let otherSubject, !otherSubject.isEmpty { pairs.append(("otherSubject", otherSubject)) }
    if let cursor, !cursor.isEmpty { pairs.append(("cursor", cursor)) }
    let url = "\(constellationBase)/xrpc/blue.microcosm.links.getManyToMany?\(JSURI.searchParams(pairs))"
    return await fetchJsonOrNull(url, transport: transport, clock: clock) { try $0.json() }
  }

  /// `backlinkRows(page)`: the rows of a getBacklinks page, which the XRPC
  /// route calls `records` and the older `/links` route `linking_records`
  /// (`page?.records || page?.linking_records || []`, as it is).
  public static func backlinkRows(_ page: JSONValue?) -> JSONValue {
    if let records = page?["records"], records.isTruthy { return records }
    if let records = page?["linking_records"], records.isTruthy { return records }
    return .array([])
  }

  /// `flattenSources(raw)`: getBacklinkSources as rows, busiest first (ties
  /// in Constellation's order), or nil when the call failed. Takes either
  /// shape (`{ links: {…} }` or the links alone).
  public static func flattenSources(_ raw: OrderedJSON?) -> [BacklinkSource]? {
    guard let raw, raw.isTruthy else { return nil }
    var links = raw
    if let held = raw["links"], held.isTruthy { links = held }
    var out: [BacklinkSource] = []
    for (collection, paths) in links.entries {
      guard paths.isTruthy, paths.isObjectLike else { continue }
      for (path, info) in paths.entries {
        let infoValue = info.value
        let records: JSONValue? = infoValue["records"]
        let counted: JSONValue? = infoValue["count"]
        let count: JSONValue = records.nonNull ?? counted.nonNull ?? .number(0)
        let distinct: JSONValue? = infoValue["distinct_dids"]
        let distinctCamel: JSONValue? = infoValue["distinctDids"]
        let distinctDids: JSONValue = distinct.nonNull ?? distinctCamel.nonNull ?? .null
        let sourcePath = path.hasPrefix(".") ? String(path.dropFirst()) : path
        out.append(
          BacklinkSource(collection: collection, path: path, source: "\(collection):\(sourcePath)", count: count, distinctDids: distinctDids))
      }
    }
    return JSSort.sort(out) { a, b in b.count.jsNumber - a.count.jsNumber }
  }

  /// `flattenSources` of a value without its order: equal counts then
  /// follow key order, not the answer's.
  public static func flattenSources(_ raw: JSONValue?) -> [BacklinkSource]? {
    flattenSources(raw.map(OrderedJSON.init))
  }
}
