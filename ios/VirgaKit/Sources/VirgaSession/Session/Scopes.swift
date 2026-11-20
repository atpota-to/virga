// Ports src/session/scopes.js
//
// Reading atproto permission strings: what a token says, whether it is well
// formed, and whether what a session was granted covers what Virga asks for.
// The grammar is https://atproto.com/specs/permission:
//
//   resource[:positional][?name=value&name=value…]
//
// An authorization server may hand back the granted scope in its own
// spelling (the positional as a parameter, parameters in another order, a
// broader token than the one asked for), so comparisons are made on parsed
// tokens, never on the raw strings. The web's patterns are matched by hand
// (each splits on a separator its characters can't hold, so the match is
// the regex's exactly); session.scopes holds them to the web.

import Foundation
import VirgaCore

/// One parsed token: `{ resource: 'atproto' }`, `{ resource: 'transition',
/// kind }`, `{ resource: 'repo', collection, actions }`, `{ resource:
/// 'rpc', lxm, aud }` or `{ resource: 'blob', accept }`.
public enum ScopeToken: Sendable, Hashable, Encodable {
  case atproto
  case transition(kind: String)
  case repo(collection: String, actions: [String])
  case rpc(lxm: String, aud: String)
  case blob(accept: [String])

  public var resource: String {
    switch self {
    case .atproto: return "atproto"
    case .transition: return "transition"
    case .repo: return "repo"
    case .rpc: return "rpc"
    case .blob: return "blob"
    }
  }

  enum CodingKeys: String, CodingKey { case resource, kind, collection, actions, lxm, aud, accept }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(resource, forKey: .resource)
    switch self {
    case .atproto: break
    case .transition(let kind): try c.encode(kind, forKey: .kind)
    case .repo(let collection, let actions):
      try c.encode(collection, forKey: .collection)
      try c.encode(actions, forKey: .actions)
    case .rpc(let lxm, let aud):
      try c.encode(lxm, forKey: .lxm)
      try c.encode(aud, forKey: .aud)
    case .blob(let accept): try c.encode(accept, forKey: .accept)
    }
  }
}

/// A scope as the web passes one: a space-separated string or a list.
public enum ScopeList: Sendable, Hashable, ExpressibleByStringLiteral, ExpressibleByArrayLiteral {
  case text(String?)
  case list([String])

  public init(stringLiteral value: String) { self = .text(value) }
  public init(arrayLiteral elements: String...) { self = .list(elements) }

  /// `(Array.isArray(v) ? v : String(v || '').split(/\s+/)).filter(Boolean)`.
  var tokens: [String] {
    switch self {
    case .list(let items): return items.filter { !$0.isEmpty }
    case .text(let text): return Scopes.splitOnWhitespace(text ?? "")
    }
  }
}

public enum Scopes {
  static let repoActions = ["create", "delete", "update"]
  static let transitionKinds = ["generic", "email", "chat.bsky"]

  /// `str.split(/\s+/)`, empty pieces dropped.
  static func splitOnWhitespace(_ text: String) -> [String] {
    var out: [String] = []
    var piece: Units = []
    for unit in text.utf16 {
      if Unit.isWhitespace(unit) {
        if !piece.isEmpty { out.append(piece.string) }
        piece = []
      } else {
        piece.append(unit)
      }
    }
    if !piece.isEmpty { out.append(piece.string) }
    return out
  }

  static func isAlnum(_ u: UInt16) -> Bool { Unit.isUpper(u) || Unit.isLower(u) || Unit.isDigit(u) }

  /// `/^[a-zA-Z](?:[a-zA-Z0-9-]{0,62})(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62})?)+\.[a-zA-Z][a-zA-Z0-9]{0,62}$/`.
  static func isNsid(_ value: String) -> Bool {
    let segments = value.utf16.split(separator: Unit.dot, omittingEmptySubsequences: false).map(Array.init)
    guard segments.count >= 3 else { return false }
    for (index, segment) in segments.enumerated() {
      guard (1...63).contains(segment.count) else { return false }
      let first = segment[0]
      let rest = segment.dropFirst()
      if index == 0 {
        guard Unit.isUpper(first) || Unit.isLower(first), rest.allSatisfy({ isAlnum($0) || $0 == Unit.hyphen }) else { return false }
      } else if index == segments.count - 1 {
        guard Unit.isUpper(first) || Unit.isLower(first), rest.allSatisfy(isAlnum) else { return false }
      } else {
        guard isAlnum(first), rest.allSatisfy({ isAlnum($0) || $0 == Unit.hyphen }) else { return false }
      }
    }
    return true
  }

  static func isNsidOrStar(_ value: String) -> Bool { value == "*" || isNsid(value) }

  /// `/^did:[a-z]+:[a-zA-Z0-9._:%-]+#[a-zA-Z0-9_-]+$/`: a DID, then `#` and
  /// the service id.
  static func isServiceRef(_ value: String) -> Bool {
    let units = value.units
    guard let hash = units.firstIndex(of: Unit.hash) else { return false }
    let fragment = units[(hash + 1)...]
    guard !fragment.isEmpty, fragment.allSatisfy({ isAlnum($0) || $0 == Unit.underscore || $0 == Unit.hyphen }) else { return false }
    return DID.isDid(Array(units[..<hash]).string)
  }

  /// `/^(?:\*\/\*|[a-z0-9][a-z0-9.+-]*\/(?:\*|[a-z0-9][a-z0-9.+-]*))$/i`.
  static func isMimePattern(_ value: String) -> Bool {
    if value == "*/*" { return true }
    let parts = value.utf16.split(separator: Unit.slash, omittingEmptySubsequences: false).map(Array.init)
    guard parts.count == 2 else { return false }
    func name(_ part: [UInt16]) -> Bool {
      guard let first = part.first, isAlnum(first) else { return false }
      return part.dropFirst().allSatisfy { isAlnum($0) || $0 == Unit.dot || $0 == Unit.plus || $0 == Unit.hyphen }
    }
    return name(parts[0]) && (parts[1] == [Unit.star] || name(parts[1]))
  }

  /// `parseScopeToken(token)`: a normalized description, or nil when the
  /// token doesn't follow the grammar (or names a resource Virga has no
  /// reading for, which for these purposes is the same thing).
  public static func parseScopeToken(_ token: String?) -> ScopeToken? {
    guard let token, !token.isEmpty else { return nil }
    let units = token.units
    if units.contains(where: Unit.isWhitespace) { return nil }
    // A raw `#` would end a URL's query; the spec writes it as %23.
    if units.contains(Unit.hash) { return nil }
    let q = units.firstIndex(of: 0x3F)
    let head = q.map { Array(units[..<$0]) } ?? units
    let params = JSURI.parseSearchParams(q.map { Array(units[($0 + 1)...]).string } ?? "")
    let colon = head.firstIndex(of: Unit.colon)
    let resource = colon.map { Array(head[..<$0]).string } ?? head.string
    var positional: String?
    if let colon {
      guard let decoded = try? JSURI.decodeURIComponent(Array(head[(colon + 1)...]).string) else { return nil }
      positional = decoded
    }
    var names: [String] = []
    for (name, _) in params where !names.jsIncludes(name) { names.append(name) }
    func only(_ allowed: String...) -> Bool { names.allSatisfy { allowed.jsIncludes($0) } }
    func getAll(_ name: String) -> [String] { params.filter { $0.0.jsEquals(name) }.map(\.1) }
    func has(_ name: String) -> Bool { names.jsIncludes(name) }

    switch resource {
    case "atproto":
      return positional == nil && names.isEmpty ? .atproto : nil

    case "transition":
      guard let kind = positional, transitionKinds.jsIncludes(kind), names.isEmpty else { return nil }
      return .transition(kind: kind)

    case "repo":
      guard only("collection", "action") else { return nil }
      let collections = positional.map { [$0] } ?? getAll("collection")
      if positional != nil && has("collection") { return nil }
      guard collections.count == 1, isNsidOrStar(collections[0]) else { return nil }
      let actions = getAll("action")
      if actions.contains(where: { !repoActions.jsIncludes($0) }) { return nil }
      var unique: [String] = []
      for action in actions where !unique.contains(action) { unique.append(action) }
      return .repo(collection: collections[0], actions: actions.isEmpty ? repoActions : unique.sorted())

    case "rpc":
      guard only("lxm", "aud") else { return nil }
      let lxms = positional.map { [$0] } ?? getAll("lxm")
      if positional != nil && has("lxm") { return nil }
      let auds = getAll("aud")
      guard lxms.count == 1, isNsidOrStar(lxms[0]), auds.count == 1 else { return nil }
      let aud = auds[0]
      if aud != "*" && !isServiceRef(aud) { return nil }
      // A token that reaches every method of every service is refused by
      // the spec; it would be a blank cheque.
      if aud == "*" && lxms[0] == "*" { return nil }
      return .rpc(lxm: lxms[0], aud: aud)

    case "blob":
      guard only("accept") else { return nil }
      let accept = positional.map { [$0] } ?? getAll("accept")
      if positional != nil && has("accept") { return nil }
      guard !accept.isEmpty, accept.allSatisfy(isMimePattern) else { return nil }
      return .blob(accept: accept.map { $0.jsLowercased() })

    default:
      return nil
    }
  }

  /// Whether a token follows the permission grammar.
  public static func isValidScopeToken(_ token: String?) -> Bool {
    parseScopeToken(token) != nil
  }

  static func mimeCovers(_ have: String, _ want: String) -> Bool {
    if have == "*/*" { return true }
    let h = have.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    let w = want.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard h.first == w.first else { return false }
    let hs = h.count > 1 ? h[1] : nil
    let ws = w.count > 1 ? w[1] : nil
    return hs == "*" || hs == ws
  }

  /// Does one granted (parsed) token cover one wanted (parsed) token?
  static func tokenCovers(_ have: ScopeToken, _ want: ScopeToken) -> Bool {
    if case .transition("generic") = have {
      // The broad transitional grant reaches repo writes, blobs and service
      // calls, though Virga never asks for it.
      switch want {
      case .repo, .blob, .rpc: return true
      default: return false
      }
    }
    switch (have, want) {
    case (.atproto, .atproto):
      return true
    case (.repo(let hc, let ha), .repo(let wc, let wa)):
      return (hc == "*" || hc == wc) && wa.allSatisfy { ha.contains($0) }
    case (.rpc(let hl, let haud), .rpc(let wl, let waud)):
      return (hl == "*" || hl == wl) && (haud == "*" || haud == waud)
    case (.blob(let ha), .blob(let wa)):
      return wa.allSatisfy { w in ha.contains { mimeCovers($0, w) } }
    case (.transition(let hk), .transition(let wk)):
      return hk == wk
    default:
      return false
    }
  }

  /// `missingScopes(granted, wanted)`: the tokens in `wanted` that
  /// `granted` doesn't cover. Only well-formed wanted tokens are
  /// considered; granted tokens that don't parse are ignored.
  public static func missingScopes(_ granted: ScopeList, _ wanted: ScopeList) -> [String] {
    let have = granted.tokens.compactMap(parseScopeToken)
    return wanted.tokens.filter { token in
      guard let want = parseScopeToken(token) else { return false }
      return !have.contains { tokenCovers($0, want) }
    }
  }

  /// `missingScopes(granted, wanted)` with a scope string and a token list.
  public static func missingScopes(_ granted: String?, _ wanted: [String]) -> [String] {
    missingScopes(.text(granted), .list(wanted))
  }

  /// `missingScopes(granted, wanted)` with two scope strings.
  public static func missingScopes(_ granted: String?, _ wanted: String) -> [String] {
    missingScopes(.text(granted), .text(wanted))
  }

  /// `isMissingScopeError(err)`: a write refused because the session wasn't
  /// granted the permission for it (`err.error` and `err.message` read for
  /// /missing required scope|insufficient.?scope|ScopeMissing/i).
  public static func isMissingScopeError(_ error: (any Error)?) -> Bool {
    guard let fields = JSErrorFields(error) else { return false }
    return isMissingScopeError(error: fields.error, message: fields.message)
  }

  /// The same over the two fields the web reads.
  public static func isMissingScopeError(error: String?, message: String?) -> Bool {
    let text = "\(error ?? "") \(message ?? "")".units.map(Unit.asciiLower)
    if contains(text, "missing required scope") || contains(text, "scopemissing") { return true }
    let insufficient = Array("insufficient".utf16)
    let scope = Array("scope".utf16)
    var i = 0
    while i + insufficient.count <= text.count {
      if Array(text[i..<(i + insufficient.count)]) == insufficient {
        let after = i + insufficient.count
        if starts(text, scope, at: after) { return true }
        if after < text.count, !Unit.isLineTerminator(text[after]), starts(text, scope, at: after + 1) { return true }
      }
      i += 1
    }
    return false
  }

  static func starts(_ text: [UInt16], _ word: [UInt16], at index: Int) -> Bool {
    index + word.count <= text.count && Array(text[index..<(index + word.count)]) == word
  }

  static func contains(_ text: [UInt16], _ word: String) -> Bool {
    let w = Array(word.utf16)
    guard w.count <= text.count else { return false }
    for i in 0...(text.count - w.count) where starts(text, w, at: i) { return true }
    return false
  }
}
