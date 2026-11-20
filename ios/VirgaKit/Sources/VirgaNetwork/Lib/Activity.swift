// Ports src/lib/activity.js
//
// When an account last did anything in public: the newest item in its
// author feed (a post, a reply or a repost), one request per account, six at
// a time, from the public AppView. Follow cleanup uses it to find the
// accounts you follow that have gone quiet. An account the AppView can't
// find (deleted, deactivated, taken down) comes back `gone`.

import Foundation
import VirgaCore

public struct ActivityResult: Codable, Sendable, Hashable {
  public var did: String
  /// The newest item's time, as an ISO string, or nil.
  public var lastActiveAt: String?
  public var gone: Bool

  public init(did: String, lastActiveAt: String?, gone: Bool) {
    self.did = did
    self.lastActiveAt = lastActiveAt
    self.gone = gone
  }

  enum CodingKeys: String, CodingKey { case did, lastActiveAt, gone }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(did, forKey: .did)
    try container.encode(lastActiveAt, forKey: .lastActiveAt)
    try container.encode(gone, forKey: .gone)
  }
}

public struct ActivityProgress: Sendable, Hashable {
  public var done: Int
  public var total: Int
}

public enum Activity {
  static let concurrency = 6

  /// `feedItemTime(item)`: a repost by when it was reposted, a post by when
  /// it was written (or else indexed), as an ISO string; nil when there is
  /// no readable time. A time written without a zone is read in `timeZone`
  /// (`Date.parse` reads it in the browser's local time).
  public static func feedItemTime(_ item: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String? {
    guard let item, item.isTruthy else { return nil }
    let candidates = [item["reason"]?["indexedAt"], item["post"]?["record"]?["createdAt"], item["post"]?["indexedAt"]]
    let at = candidates.lazy.compactMap { $0 }.first { $0.isTruthy }
    let ms = JSDate.parse(at.map(\.jsString) ?? "", timeZone: timeZone)
    return ms.isFinite ? JSDate.toISOString(ms) : nil
  }

  /// `value?.[0]`: an array's first element, an object's member "0", a
  /// string's first code unit; nothing for anything else.
  static func firstElement(_ value: JSONValue?) -> JSONValue? {
    switch value {
    case .array(let items)?: return items.first
    case .object?: return value?["0"]
    case .string(let text)?: return text.isEmpty ? nil : .string(String(jsUnits: text.utf16.prefix(1)))
    default: return nil
    }
  }

  struct HTTPStatusError: Error, LocalizedError {
    let status: Int
    var errorDescription: String? { "HTTP \(status)" }
  }

  /// `lastActive(did)`: one account's newest feed item. A 400 or 404 says
  /// why: a missing, deactivated or taken-down actor is gone; anything else
  /// (blocked, a bad DID) is just unknown.
  static func lastActive(_ did: String, transport: any HTTPTransport, timeZone: TimeZone) async throws -> ActivityResult {
    let params = JSURI.searchParams([("actor", did), ("limit", "1"), ("filter", "posts_with_replies")])
    let response = try await transport.send(HTTPRequest(url: "\(AppConfig.appview)/xrpc/app.bsky.feed.getAuthorFeed?\(params)"))
    if response.status == 400 || response.status == 404 {
      let body = response.jsonOrNull()
      func part(_ name: String) -> String {
        guard let value = body?[name], value.isTruthy else { return "" }
        return value.jsString
      }
      return ActivityResult(did: did, lastActiveAt: nil, gone: isGoneReason("\(part("error")) \(part("message"))"))
    }
    if !response.ok { throw HTTPStatusError(status: response.status) }
    let body = try response.json()
    return ActivityResult(did: did, lastActiveAt: feedItemTime(firstElement(body["feed"]), timeZone: timeZone), gone: false)
  }

  /// `/not ?found|deactivated|suspended|takendown/i`, over code units (no
  /// `u` flag, so only A–Z fold).
  static func isGoneReason(_ text: String) -> Bool {
    let lowered = text.asciiLowercased
    return ["notfound", "not found", "deactivated", "suspended", "takendown"].contains { lowered.jsIncludes($0) }
  }

  /// `checkActivity(dids, { onProgress })`: when each account was last
  /// active, reporting `{ done, total }` as it goes. An account that fails to
  /// read is left out rather than recorded as quiet (a timeout says nothing
  /// about the account). Cancelling the task stops the reading; what was
  /// read is returned.
  ///
  /// The web lists results in the order its reads finished, which with the
  /// answers in order is the order of `dids`; this always gives that order.
  public static func checkActivity(
    _ dids: [String?]?,
    onProgress: (@Sendable (ActivityProgress) -> Void)? = nil,
    transport: any HTTPTransport = HTTP.transport,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) async -> [ActivityResult] {
    // `Array.from(new Set(dids)).filter(Boolean)`: by code unit.
    var list: [String] = []
    var seen = Set<JSKey>()
    for did in dids ?? [] {
      guard let did, !did.isEmpty, seen.insert(JSKey(did)).inserted else { continue }
      list.append(did)
    }
    let total = list.count
    onProgress?(ActivityProgress(done: 0, total: total))
    let state = Locked((next: 0, done: 0))
    let collected = Locked([(Int, ActivityResult)]())
    let items = list
    await withTaskGroup(of: Void.self) { group in
      for _ in 0..<min(concurrency, total) {
        group.addTask {
          while true {
            if Task.isCancelled { return }
            let index: Int? = state.withLock { s in
              guard s.next < items.count else { return nil }
              defer { s.next += 1 }
              return s.next
            }
            guard let index else { return }
            if let result = try? await lastActive(items[index], transport: transport, timeZone: timeZone) {
              collected.withLock { $0.append((index, result)) }
            }
            // Counted and reported under the lock, so the reports climb one
            // at a time as the web's do (its workers share one thread), and
            // never go back when two reads finish together.
            state.withLock { s in
              s.done += 1
              onProgress?(ActivityProgress(done: s.done, total: total))
            }
          }
        }
      }
    }
    return collected.withLock { $0 }.sorted { $0.0 < $1.0 }.map(\.1)
  }
}
