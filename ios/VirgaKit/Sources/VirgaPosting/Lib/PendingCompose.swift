// Ports src/lib/pendingCompose.js
//
// A compose link (/intent/compose?text=…, or /posting/compose) opened
// while signed out has to survive the sign-in: the sign-in leaves the app's
// screen and comes back to Virga's return address, not to the link. The
// link is kept for this session (the web's sessionStorage: a key-value
// store the app clears at launch) and for a while, then taken once.

import Foundation
import VirgaCore
import VirgaNetwork

public enum PendingCompose {
  public static let pendingComposeKey = "virga:pending-compose"

  /// Long enough to sign in, including a slow authorization server and a
  /// password manager; short enough that a link from yesterday doesn't open
  /// the composer on some later sign-in.
  public static let pendingComposeTtlMs: Double = 30 * 60 * 1000

  static let composePaths = ["/intent/compose", "/posting/compose"]

  /// `String(path || '').replace(/\/+$/, '')`.
  static func trimmed(_ path: JSONValue?) -> String {
    let text = ComposerJS.truthy(path) ? path!.jsString : ""
    var units = Array(text.utf16)
    while units.last == 0x2F { units.removeLast() }
    return String(decoding: units, as: UTF16.self)
  }

  /// True for the addresses that open the composer.
  public static func isComposePath(_ path: JSONValue?) -> Bool {
    composePaths.jsIncludes(trimmed(path))
  }

  public static func isComposePath(_ path: String?) -> Bool { isComposePath(path.map(JSONValue.string)) }

  /// Keep a compose link to reopen after the sign-in. Anything else is ignored.
  @discardableResult
  public static func rememberPendingCompose(
    _ path: JSONValue?, _ search: JSONValue? = "", store: (any KeyValueStore)?, now: Double
  ) -> Bool {
    guard let store, isComposePath(path) else { return false }
    let query = search?.stringValue.flatMap { PostingJS.hasPrefix($0, "?") ? $0 : nil } ?? ""
    let kept: JSONValue = ["path": .string(trimmed(path)), "search": .string(query), "at": .number(now)]
    do {
      try store.setItem(pendingComposeKey, JSONStringify.stringify(kept))
      return true
    } catch {
      return false
    }
  }

  @discardableResult
  public static func rememberPendingCompose(_ path: String, _ search: String = "", store: (any KeyValueStore)?, now: Double)
    -> Bool
  {
    rememberPendingCompose(.string(path), .string(search), store: store, now: now)
  }

  /// The address to reopen, once: the link kept before the sign-in, or nil
  /// when there is none, it has gone stale or it doesn't read back as one.
  public static func takePendingCompose(store: (any KeyValueStore)?, now: Double) -> String? {
    guard let store else { return nil }
    let raw = store.getItem(pendingComposeKey)
    store.removeItem(pendingComposeKey)
    guard let raw, !raw.isEmpty, let kept = try? JSONValue.parse(raw), kept.isTruthy else { return nil }
    guard isComposePath(kept["path"]) else { return nil }
    guard let at = kept["at"]?.doubleValue, !(now - at > pendingComposeTtlMs), !(now < at) else { return nil }
    let search = kept["search"]?.stringValue.flatMap { PostingJS.hasPrefix($0, "?") ? $0 : nil } ?? ""
    return "\(kept["path"]!.jsString)\(search)"
  }
}
