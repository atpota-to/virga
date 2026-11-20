// Ports src/legal/acceptance.js
//
// Whether an account has agreed to the current Terms of Service and Privacy
// Policy, as this device knows it, and what the agreement screen should do.
// Pure: storage is passed in, and the network is TermsService's.
//
// A note is kept per account (`virga:terms-accepted:<did>`), so an account
// that has agreed here is never asked again on this device, nor made to wait
// while the server is asked. It is a convenience, not the record: the record
// is the row on Virga's server.
//
//   { version, at, recorded, tries, identity }
//
// `identity` is how the server knows the agreement: 'session' (a long
// session's own, written only once the server has answered), 'claimed' (a
// browser session's, reported on its word) or null (not reported yet).

import Foundation
import VirgaCore
import VirgaNetwork

/// The note that an account agreed, as `readAcceptance` reads it.
public struct TermsAcceptanceNote: Sendable, Hashable, Codable {
  public var version: Int
  public var at: String?
  public var recorded: Bool
  public var tries: Int
  /// 'session', 'claimed' or nil.
  public var identity: String?

  public init(version: Int = LegalVersion.termsVersion, at: String? = nil, recorded: Bool = false, tries: Int = 0, identity: String? = nil) {
    self.version = version
    self.at = at
    self.recorded = recorded
    self.tries = tries
    self.identity = identity
  }

  enum CodingKeys: String, CodingKey { case version, at, recorded, tries, identity }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(version, forKey: .version)
    if let at { try c.encode(at, forKey: .at) } else { try c.encodeNil(forKey: .at) }
    try c.encode(recorded, forKey: .recorded)
    try c.encode(tries, forKey: .tries)
    if let identity { try c.encode(identity, forKey: .identity) } else { try c.encodeNil(forKey: .identity) }
  }
}

/// Where the agreement screen is for an account.
public enum TermsStatus: String, Sendable, Hashable, Codable {
  /// Go on into the app.
  case accepted
  /// A long session with no note here: asking the server.
  case checking
  /// Show the agreement screen.
  case needs
}

/// `acceptFailure(error)`: the words for an agreement that couldn't be
/// recorded, and whether the fix is to load the documents again.
public struct TermsAcceptFailure: Sendable, Hashable, Codable {
  public var text: String
  public var reload: Bool
}

public enum Acceptance {
  public static let termsAcceptedPrefix = "virga:terms-accepted:"

  /// How many visits an unreported agreement is offered to the server
  /// before it is left alone.
  public static let maxReportTries = 5

  public static func termsKey(_ did: String) -> String { "\(termsAcceptedPrefix)\(did)" }

  /// `Number.isInteger(value)`.
  static func integer(_ value: JSONValue?) -> Int? {
    guard case .number(let n)? = value, n.isFinite, n.rounded(.towardZero) == n else { return nil }
    return Int(exactly: n) ?? (n > 0 ? Int.max : Int.min)
  }

  /// `readAcceptance(storage, did)`: the note for `did`, or nil when there
  /// is none (or it can't be read).
  public static func readAcceptance(_ storage: (any KeyValueStore)?, _ did: String?) -> TermsAcceptanceNote? {
    guard let did, !did.isEmpty else { return nil }
    let raw = storage?.getItem(termsKey(did)) ?? ""
    guard let value = try? JSONValue.parse(raw.isEmpty ? "null" : raw), value.isTruthy else { return nil }
    guard let version = integer(value["version"]), version >= 1 else { return nil }
    let tries = integer(value["tries"]).flatMap { $0 > 0 ? $0 : nil } ?? 0
    var identity: String?
    if case .string(let text)? = value["identity"], text == "session" || text == "claimed" { identity = text }
    return TermsAcceptanceNote(
      version: version,
      at: value["at"]?.stringValue,
      recorded: value["recorded"] == .bool(true),
      tries: tries,
      identity: identity)
  }

  /// `writeAcceptance(storage, did, { version, at, recorded, tries, identity })`.
  /// Fails soft: without storage the account is simply asked again next time.
  /// `at` is whatever the caller has (the server's `acceptedAt` as it came).
  public static func writeAcceptance(
    _ storage: (any KeyValueStore)?,
    _ did: String?,
    version: Int = LegalVersion.termsVersion,
    at: JSONValue = .null,
    recorded: Bool = false,
    tries: Int = 0,
    identity: String? = nil
  ) {
    guard let did, !did.isEmpty else { return }
    let text =
      "{\"version\":\(version),\"at\":\(JSONStringify.stringify(at)),\"recorded\":\(recorded),\"tries\":\(tries),\"identity\":\(identity.map(JSONStringify.quote) ?? "null")}"
    try? storage?.setItem(termsKey(did), text)
  }

  /// `writeAcceptance(storage, did, entry)` for a note as read.
  public static func writeAcceptance(_ storage: (any KeyValueStore)?, _ did: String?, _ entry: TermsAcceptanceNote) {
    writeAcceptance(
      storage, did, version: entry.version, at: entry.at.map(JSONValue.string) ?? .null, recorded: entry.recorded,
      tries: entry.tries, identity: entry.identity)
  }

  /// Whether a note covers the documents as they are now. A later version
  /// covers an earlier one.
  public static func coversCurrent(_ entry: TermsAcceptanceNote?, version: Int = LegalVersion.termsVersion) -> Bool {
    guard let entry else { return false }
    return entry.version >= version
  }

  /// Whether an agreement made on a browser session still has to be
  /// reported to the server.
  public static func needsReport(_ entry: TermsAcceptanceNote?, version: Int = LegalVersion.termsVersion) -> Bool {
    guard let entry, coversCurrent(entry, version: version) else { return false }
    return !entry.recorded && entry.tries < maxReportTries
  }

  /// Whether a note lets the account past the agreement screen. On a long
  /// session only the server's own word does; on a browser session the note
  /// is all there is.
  public static func opensGate(_ entry: TermsAcceptanceNote?, mode: String?) -> Bool {
    guard coversCurrent(entry) else { return false }
    return mode == "backend" ? entry?.identity == "session" : true
  }

  /// Where the agreement screen starts for an account, before anything is
  /// asked of the network.
  public static func startingStatus(entry: TermsAcceptanceNote?, mode: String?, canAsk: Bool) -> TermsStatus {
    if opensGate(entry, mode: mode) { return .accepted }
    return mode == "backend" && canAsk ? .checking : .needs
  }

  /// `statusFromAnswer(answer)`: what the server's answer to "has this
  /// account agreed?" means. An answer for other documents isn't an
  /// agreement to these.
  public static func statusFromAnswer(_ answer: JSONValue?, version: Int = LegalVersion.termsVersion) -> TermsStatus {
    guard answer?["accepted"] == .bool(true), case .number(let n)? = answer?["version"], n == Double(version) else {
      return .needs
    }
    return .accepted
  }

  /// `statusFromAnswer(answer)` for TermsService.fetchTermsStatus's answer.
  public static func statusFromAnswer(_ answer: TermsStatusAnswer?, version: Int = LegalVersion.termsVersion) -> TermsStatus {
    statusFromAnswer(answer?.json, version: version)
  }

  /// `acceptFailure(error)`: the words for an agreement that couldn't be
  /// recorded. Never the server's own text.
  public static func acceptFailure(_ error: (any Error)?) -> TermsAcceptFailure {
    acceptFailure(JSErrorFields(error))
  }

  public static func acceptFailure(_ fields: JSErrorFields?) -> TermsAcceptFailure {
    let code = fields?.code.truthy?.stringValue
    if code == "TERMS_VERSION_MISMATCH" {
      return TermsAcceptFailure(
        text: "The Terms of Service and Privacy Policy have changed since this page loaded. Reload to read the current ones.",
        reload: true)
    }
    if code == "NETWORK_ERROR" || code == "TIMEOUT" {
      return TermsAcceptFailure(
        text: "Couldn’t reach Virga’s server, so your agreement isn’t recorded yet. Check your connection and try again.",
        reload: false)
    }
    if code == "RATE_LIMITED" {
      return TermsAcceptFailure(text: "Virga’s server is busy with this account. Wait a minute and try again.", reload: false)
    }
    if code == "FRONTEND_SESSION_INVALID" || fields?.status == 401 {
      return TermsAcceptFailure(
        text:
          "Virga’s server didn’t recognise this account’s sign-in, so your agreement isn’t recorded yet. Try again; if it keeps happening, the account needs to sign in again.",
        reload: false)
    }
    return TermsAcceptFailure(
      text: "Virga’s server couldn’t record your agreement just now. Try again in a little while.", reload: false)
  }
}
