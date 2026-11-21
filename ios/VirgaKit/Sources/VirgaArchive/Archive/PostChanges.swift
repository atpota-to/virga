// Ports src/archive/postChanges.js
//
// What a post made or deleted in Virga does to the archive before the next
// sync sees it: a made post appears with zero counts (the sync's refresh of
// recent posts fills them in), a deleted one leaves at once.

import Foundation
import VirgaCore

/// One post just made: `{ uri, cid, record }`.
public struct PostedItem: Codable, Hashable, Sendable {
  public var uri: String?
  public var cid: String?
  public var record: JSONValue?

  public init(uri: String?, cid: String? = nil, record: JSONValue?) {
    self.uri = uri
    self.cid = cid
    self.record = record
  }

  public init(json: JSONValue) {
    uri = json["uri"]?.stringValue
    cid = json["cid"]?.stringValue
    record = json["record"]
  }
}

public enum PostChanges {
  static let post = "app.bsky.feed.post"

  /// Whether `uri` is a post in `did`'s own repo
  /// (`/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/`, by code unit).
  public static func isOwnPostUri(_ did: String?, _ uri: String?) -> Bool {
    guard let did, !did.isEmpty, let uri else { return false }
    let units = Array(uri.utf16)
    let prefix = Array("at://".utf16)
    guard units.count > prefix.count, Array(units[0..<prefix.count]) == prefix else { return false }
    let parts = units[prefix.count...].split(separator: 0x2F, omittingEmptySubsequences: false)
    guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty }) else { return false }
    return String(jsUnits: parts[0]).jsEquals(did) && String(jsUnits: parts[1]).jsEquals(post)
  }

  /// The archive rows for posts `did` just made; anything that isn't the
  /// account's own post, or has no readable record, is left out.
  public static func postRowsFor(_ did: String?, _ added: [PostedItem]?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> [PostRow] {
    var rows: [PostRow] = []
    for item in added ?? [] {
      guard isOwnPostUri(did, item.uri) else { continue }
      if let row = Analytics.compactPostFromRecord(item.uri, item.record, timeZone: timeZone) { rows.append(row) }
    }
    return rows
  }

  /// `posts` with `rows` added (a row already held replaces it in place,
  /// keeping the counts the archive has) and the `removed` URIs gone. Nil
  /// when nothing changed, so a caller can skip the write (the web returns
  /// the same array).
  public static func applyPostChanges(_ posts: [PostRow]?, rows: [PostRow] = [], removed: [String] = []) -> [PostRow]? {
    let list = posts ?? []
    let gone = Set(removed.map(JSKey.init))
    var byUri: [JSKey: PostRow] = [:]
    var order: [JSKey] = []
    for r in rows {
      let key = JSKey(r.uri)
      if byUri[key] == nil { order.append(key) }
      byUri[key] = r
    }
    var changed = false
    var next: [PostRow] = []
    for post in list {
      let key = JSKey(post.uri)
      if gone.contains(key) {
        changed = true
        continue
      }
      if let fresh = byUri[key] {
        byUri[key] = nil
        var merged = fresh
        merged.likes = post.likes
        merged.reposts = post.reposts
        merged.replies = post.replies
        merged.quotes = post.quotes
        if !sameRow(merged, post) { changed = true }
        next.append(merged)
      } else {
        next.append(post)
      }
    }
    for key in order {
      guard let row = byUri[key], !gone.contains(key) else { continue }
      next.append(row)
      changed = true
    }
    return changed ? next : nil
  }

  /// `applyPostChanges`, giving back `posts` itself when nothing changed.
  public static func applyPostChanges(_ posts: [PostRow], changes rows: [PostRow], removed: [String]) -> [PostRow] {
    applyPostChanges(posts, rows: rows, removed: removed) ?? posts
  }

  /// Every member the same (strings by code unit).
  static func sameRow(_ a: PostRow, _ b: PostRow) -> Bool {
    let x = a.json.objectValue ?? [:]
    let y = b.json.objectValue ?? [:]
    for key in Set(x.keys).union(y.keys) {
      if !strictEqual(x[key], y[key]) { return false }
    }
    return true
  }

  /// `a === b` for the values a row holds. The web compares a row's lists
  /// by reference, so a held row noted again with equal but separate lists
  /// reads as changed there; values have no identity here, so lists compare
  /// by value. The rows that come back are the same either way.
  static func strictEqual(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    switch (a, b) {
    case (.none, .none): return true
    case (.some(let x), .some(let y)): return JSONSameValue.same(x, y)
    default: return false
    }
  }
}

/// Deep equality of JSON values, strings by code unit.
enum JSONSameValue {
  static func same(_ a: JSONValue, _ b: JSONValue) -> Bool {
    var stack: [(JSONValue, JSONValue)] = [(a, b)]
    while let (x, y) = stack.popLast() {
      switch (x, y) {
      case (.null, .null): continue
      case (.bool(let p), .bool(let q)): if p != q { return false }
      case (.number(let p), .number(let q)): if p != q { return false }
      case (.string(let p), .string(let q)): if !p.jsEquals(q) { return false }
      case (.array(let p), .array(let q)):
        guard p.count == q.count else { return false }
        stack.append(contentsOf: zip(p, q).map { ($0, $1) })
      case (.object(let p), .object(let q)):
        guard p.count == q.count else { return false }
        for (key, value) in p {
          guard let other = q.jsValue(key) else { return false }
          stack.append((value, other))
        }
      default: return false
      }
    }
    return true
  }
}
