// Ports harness/harness.js
//
// What the harness decides about the worlds it builds: the scope each
// account's session was granted, from the address flags (`?scope=read`,
// `?defense=on`, `?defense=lists`), and the helpers behind it. DemoWorld
// puts the scope and the PDS on each world as createHarness does, and
// holds grantOf and regrant. The other flags (readFlags) and the rest of
// createHarness (DemoHarness: the server, the agents, the network) are in
// Harness+Flags.swift.

import Foundation
import VirgaCore

public enum Harness {
  /// What a session granted before Virga could post: reading, and
  /// follow/unfollow (`READ_ONLY_SCOPE`).
  public static let readOnlyScope: String = AppConfig.oauthScope.jsSplit(" ")
    .filter { token in
      token == "atproto" || token.jsContains("getFollowers") || token.jsContains("listNotifications")
        || token.jsHasPrefix("repo:app.bsky.graph.follow")
    }
    .joined(separator: " ")

  /// How much of Defense's permission a granted scope carries: none (the
  /// web's `false`), the read (`true` or `'scan'`, as after Turn on
  /// Defense), or the read and the list writes (`'lists'`).
  public enum DefenseLevel: String, Codable, Hashable, Sendable, CaseIterable {
    case none
    case scan
    case lists
  }

  /// `withDefense(scope, level)`: the scope's own tokens, less any of
  /// Defense's and the list writes, then those the level grants. A missing
  /// scope is an empty one.
  public static func withDefense(_ scope: String?, _ level: DefenseLevel) -> String {
    let defense = AppConfig.defenseTokens
    let lists = AppConfig.listTokens
    let tokens = (scope ?? "").jsSplit(" ").filter { token in
      !token.isEmpty && !defense.contains { $0.jsEquals(token) } && !lists.contains { $0.jsEquals(token) }
    }
    let added: [String]
    switch level {
    case .none: added = []
    case .scan: added = defense
    case .lists: added = defense + lists
    }
    return (tokens + added).joined(separator: " ")
  }

  /// `readFlags(search).scope` from the two flags it reads: `scope`
  /// (`"read"` starts from `readOnlyScope`, anything else from Virga's
  /// whole scope) and `defense` (`"on"` or `"lists"`; anything else grants
  /// none of Defense's). Values compare exactly, as `===` does.
  public static func grantedScope(scope: String?, defense: String?) -> String {
    let level: DefenseLevel = defense == "lists" ? .lists : defense == "on" ? .scan : .none
    return withDefense(scope == "read" ? readOnlyScope : AppConfig.oauthScope, level)
  }

  /// The scope the harness grants with no flags: Virga's whole scope,
  /// without Defense's permission.
  public static let defaultScope = grantedScope(scope: nil, defense: nil)
}
