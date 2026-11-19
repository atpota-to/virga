// DIDs and handles: the checks the web app makes before it uses one. As with
// AT-URIs, the web has several, each a regular expression in the module that
// needs it; each check here is one of them exactly, matched by hand rather
// than with NSRegularExpression (whose `$` also matches before a final line
// break, where JavaScript's doesn't). ios/parity/cases/core.identity.js
// holds them to the web functions.

import Foundation

public enum DID {
  public static let plcPrefix = "did:plc:"
  public static let webPrefix = "did:web:"

  /// `^did:[a-z]+:[a-zA-Z0-9._:%-]+$` (src/session/accounts.js `isDid`): a
  /// method of lower-case letters and an identifier of letters, digits and
  /// `._:%-`.
  public static func isDid(_ value: String?) -> Bool {
    guard let (_, identifier) = split(value) else { return false }
    return !identifier.isEmpty
  }

  /// The DID syntax spec (`DID_SYNTAX` in src/defense/harvest.js and
  /// command.js): as `isDid`, but the identifier may not end in `:` or `%`.
  public static func isValidDid(_ value: String?) -> Bool {
    guard let (_, identifier) = split(value), let last = identifier.last else { return false }
    return last != 0x3A && last != 0x25
  }

  /// `^did:(plc|web):[A-Za-z0-9._:%-]+$` (src/tools/interactionModel.js):
  /// one of the two methods atproto accounts use.
  public static func isAtprotoDid(_ value: String?) -> Bool {
    guard let (method, identifier) = split(value) else { return false }
    return (method == "plc" || method == "web") && !identifier.isEmpty
  }

  /// The method of a DID-shaped string ('plc', 'web'), or nil.
  public static func method(_ value: String?) -> String? {
    guard let (method, identifier) = split(value), !identifier.isEmpty else { return nil }
    return method
  }

  /// `did:` + method + `:` + identifier, with the identifier's characters
  /// checked; the identifier as code units (possibly empty).
  static func split(_ value: String?) -> (String, [UInt8])? {
    guard let value else { return nil }
    let bytes = Array(value.utf8)
    let prefix = Array("did:".utf8)
    guard bytes.count > prefix.count, Array(bytes[0..<prefix.count]) == prefix else { return nil }
    var i = prefix.count
    let methodStart = i
    while i < bytes.count, bytes[i] >= 0x61 && bytes[i] <= 0x7A { i += 1 }
    guard i > methodStart, i < bytes.count, bytes[i] == 0x3A else { return nil }
    let method = String(decoding: bytes[methodStart..<i], as: UTF8.self)
    let identifier = Array(bytes[(i + 1)...])
    guard identifier.allSatisfy(isIdentifierByte) else { return nil }
    return (method, identifier)
  }

  static func isIdentifierByte(_ b: UInt8) -> Bool {
    (b >= 0x61 && b <= 0x7A) || (b >= 0x41 && b <= 0x5A) || (b >= 0x30 && b <= 0x39)
      || b == 0x2E || b == 0x5F || b == 0x3A || b == 0x25 || b == 0x2D
  }
}

public enum Handle {
  /// What the AppView calls an account whose handle doesn't verify.
  public static let invalid = "handle.invalid"

  /// Handle syntax (src/posting/lib/mentions.js `isValidHandle`, the AT
  /// Protocol handle spec): two or more dot-separated segments of 1–63
  /// ASCII letters, digits and hyphens, none starting or ending with a
  /// hyphen, the last not starting with a digit, at most 253 in all.
  public static func isValidHandle(_ handle: String?) -> Bool {
    guard let handle, !handle.isEmpty, handle.utf16.count <= 253 else { return false }
    // Split on the byte, as JavaScript's split('.') does on the code unit.
    let segments = Array(handle.utf8).split(separator: 0x2E, omittingEmptySubsequences: false).map(Array.init)
    guard segments.count >= 2, segments.allSatisfy(isSegment) else { return false }
    let lastFirst = segments.last![0]
    return !(lastFirst >= 0x30 && lastFirst <= 0x39)
  }

  /// `^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`
  static func isSegment(_ bytes: [UInt8]) -> Bool {
    guard (1...63).contains(bytes.count) else { return false }
    func alnum(_ b: UInt8) -> Bool {
      (b >= 0x61 && b <= 0x7A) || (b >= 0x41 && b <= 0x5A) || (b >= 0x30 && b <= 0x39)
    }
    guard alnum(bytes.first!), alnum(bytes.last!) else { return false }
    return bytes.allSatisfy { alnum($0) || $0 == 0x2D }
  }

  /// A handle as the web keeps it: without a leading `@`, lower-cased
  /// (postLink.js: `.replace(/^@/, '').toLowerCase()`).
  public static func normalize(_ handle: String) -> String {
    (handle.hasPrefix("@") ? String(handle.dropFirst()) : handle).lowercased()
  }

  /// The handle to show for an account: nil for none or `handle.invalid`.
  public static func displayable(_ handle: String?) -> String? {
    guard let handle, !handle.isEmpty, handle != invalid else { return nil }
    return handle
  }
}
