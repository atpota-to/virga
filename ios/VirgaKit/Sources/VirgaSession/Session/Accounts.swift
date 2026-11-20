// Ports src/session/accounts.js
//
// The accounts this device has signed in with, which one is open, and what
// each one keeps here. Pure: every function takes its storage, and fails soft
// when storage is missing or refuses, so a full disk just means a shorter
// memory.
//
//   key-value store  virga:accounts             [{ did, handle, displayName, avatar, mode, lastUsed, addedAt, signedOut?, scope? }]
//                    virga:account              the open account's DID
//   secret store     virga:backend-token:<did>  a long session's token, one per account
//
// The web keeps the token in localStorage beside the rest; the app keeps it
// in the Keychain (SecretStore), under the same key. A row stays after its
// account signs out (signedOut: true), so it can come back without the
// handle being typed again. "Remove from this device" deletes the row.
// DIDs are compared by code unit, as the web compares them.

import Foundation
import VirgaCore
import VirgaNetwork

/// One remembered account, as `virga:accounts` keeps it.
public struct AccountRow: Sendable, Hashable, Codable, AccountLike {
  public var did: String
  public var handle: String?
  public var displayName: String?
  public var avatar: String?
  /// 'browser' or 'backend' (a long session through Virga's server).
  public var mode: String
  public var lastUsed: Double
  public var addedAt: Double
  /// True when the account signed out; never false (the key is left out).
  public var signedOut: Bool?
  /// The scope the session was granted, once read.
  public var scope: String?

  public init(
    did: String,
    handle: String? = nil,
    displayName: String? = nil,
    avatar: String? = nil,
    mode: String = "browser",
    lastUsed: Double = 0,
    addedAt: Double = 0,
    signedOut: Bool? = nil,
    scope: String? = nil
  ) {
    self.did = did
    self.handle = handle
    self.displayName = displayName
    self.avatar = avatar
    self.mode = mode
    self.lastUsed = lastUsed
    self.addedAt = addedAt
    self.signedOut = signedOut
    self.scope = scope
  }

  public var isSignedOut: Bool { signedOut == true }

  enum CodingKeys: String, CodingKey { case did, handle, displayName, avatar, mode, lastUsed, addedAt, signedOut, scope }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(did, forKey: .did)
    try c.encode(handle, forKey: .handle)
    try c.encode(displayName, forKey: .displayName)
    try c.encode(avatar, forKey: .avatar)
    try c.encode(mode, forKey: .mode)
    try c.encode(lastUsed, forKey: .lastUsed)
    try c.encode(addedAt, forKey: .addedAt)
    if signedOut == true { try c.encode(true, forKey: .signedOut) }
    try c.encodeIfPresent(scope, forKey: .scope)
  }

  /// The row as `JSON.stringify` writes it, keys in the web's order.
  var jsonText: String {
    func text(_ value: String?) -> String { value.map(JSONStringify.quote) ?? "null" }
    var out = "{\"did\":\(JSONStringify.quote(did)),\"handle\":\(text(handle)),\"displayName\":\(text(displayName)),\"avatar\":\(text(avatar)),\"mode\":\(JSONStringify.quote(mode)),\"lastUsed\":\(JSNumber.format(lastUsed)),\"addedAt\":\(JSNumber.format(addedAt))"
    if signedOut == true { out += ",\"signedOut\":true" }
    if let scope { out += ",\"scope\":\(JSONStringify.quote(scope))" }
    return out + "}"
  }
}

/// What the naming functions read off an account: a row, the session's
/// account entry, or an identity found at sign-in.
public protocol AccountLike {
  var did: String { get }
  var handle: String? { get }
  var displayName: String? { get }
  var avatar: String? { get }
}

/// What a sign-in says of the account's scope: nothing (`undefined`: the
/// row keeps what it had, unless its kind of sign-in changed), nothing known
/// (`null`: whatever the row said is dropped), or the grant.
public enum SignInScope: Sendable, Hashable {
  case unsaid
  case cleared
  case granted(String)
}

/// `makeReauthRequiredError(did)`: an account that can only be used again
/// after a fresh sign-in. Its code is REAUTH_REQUIRED.
public struct ReauthRequiredError: Error, Sendable, Hashable, LocalizedError, JSErrorConvertible {
  public var did: String?
  /// What stood in the way (a restore the library refused), if anything.
  public var cause: String?

  public init(did: String? = nil, cause: String? = nil) {
    self.did = did
    self.cause = cause
  }

  public var errorDescription: String? { "This account needs to sign in again." }
  public var jsFields: JSErrorFields {
    JSErrorFields(message: "This account needs to sign in again.", code: .string(Accounts.reauthRequiredCode))
  }
}

public enum Accounts {
  public static let accountsKey = "virga:accounts"
  public static let activeKey = "virga:account"
  static let tokenPrefix = "virga:backend-token:"
  static let dayMs: Double = 86_400_000

  public static let modes = ["browser", "backend"]

  /// Posted when an account's sign-in turns out to have ended (not when
  /// someone signs out on purpose), so the open account's reader can be sent
  /// to sign in again (SessionEvents).
  public static let sessionExpiredEvent = "virga:session-expired"

  /// `isDid(value)`: `/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/`.
  public static func isDid(_ value: String?) -> Bool { DID.isDid(value) }

  public static func backendTokenKey(_ did: String) -> String { "\(tokenPrefix)\(did)" }

  // MARK: Rows

  /// `typeof v === 'string' && v.trim() ? v.trim() : null`.
  static func text(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.jsTrimmed()
    return trimmed.isEmpty ? nil : trimmed
  }

  static func text(_ value: JSONValue?) -> String? {
    guard case .string(let string)? = value else { return nil }
    return text(string)
  }

  /// `cleanRow(row)` for a row read back from storage: the fields a row may
  /// carry, anything malformed dropped; nil for a row without a DID.
  static func cleanRow(_ row: JSONValue?) -> AccountRow? {
    guard let row, case .string(let did)? = row["did"], isDid(did) else { return nil }
    func finite(_ value: JSONValue?) -> Double? {
      guard case .number(let n)? = value, n.isFinite else { return nil }
      return n
    }
    var mode = "browser"
    if case .string(let m)? = row["mode"], modes.jsIncludes(m) { mode = m }
    let lastUsed = finite(row["lastUsed"]) ?? 0
    return AccountRow(
      did: did,
      handle: text(row["handle"]),
      displayName: text(row["displayName"]),
      avatar: text(row["avatar"]),
      mode: mode,
      lastUsed: lastUsed,
      addedAt: finite(row["addedAt"]) ?? finite(row["lastUsed"]) ?? 0,
      signedOut: row["signedOut"] == .bool(true) ? true : nil,
      scope: row["scope"]?.stringValue)
  }

  /// `cleanRow(row)` for a row this code built.
  static func cleanRow(_ row: AccountRow) -> AccountRow? {
    guard isDid(row.did) else { return nil }
    var out = row
    out.handle = text(row.handle)
    out.displayName = text(row.displayName)
    out.avatar = text(row.avatar)
    if !modes.jsIncludes(row.mode) { out.mode = "browser" }
    out.lastUsed = row.lastUsed.isFinite ? row.lastUsed : 0
    out.addedAt = row.addedAt.isFinite ? row.addedAt : out.lastUsed
    out.signedOut = row.signedOut == true ? true : nil
    return out
  }

  /// Most recently used first; equal times keep their order.
  static func byRecent(_ rows: [AccountRow]) -> [AccountRow] {
    JSSort.sort(rows) { a, b in b.lastUsed - a.lastUsed }
  }

  /// `readAccounts(storage)`: every remembered account, most recently used
  /// first. Never throws.
  public static func readAccounts(_ storage: (any KeyValueStore)?) -> [AccountRow] {
    guard let raw = storage?.getItem(accountsKey), let list = try? JSONValue.parse(raw), case .array(let rows) = list else {
      return []
    }
    var seen = Set<JSKey>()
    var out: [AccountRow] = []
    for row in rows {
      guard let clean = cleanRow(row), seen.insert(JSKey(clean.did)).inserted else { continue }
      out.append(clean)
    }
    return byRecent(out)
  }

  /// `writeAccounts(storage, list)`: the rows cleaned and sorted, kept, and
  /// returned.
  @discardableResult
  public static func writeAccounts(_ storage: (any KeyValueStore)?, _ list: [AccountRow]) -> [AccountRow] {
    let rows = byRecent(list.compactMap { cleanRow($0) })
    try? storage?.setItem(accountsKey, "[\(rows.map(\.jsonText).joined(separator: ","))]")
    return rows
  }

  public static func findAccount<A: AccountLike>(_ list: [A]?, _ did: String?) -> A? {
    guard let did else { return nil }
    return (list ?? []).first { $0.did.jsEquals(did) }
  }

  /// `recordSignIn(storage, { did, mode, handle, displayName, avatar, scope }, now)`:
  /// a new row, or the existing one brought back. A fresh sign-in always
  /// clears `signedOut` and moves the row to the top. Display fields that
  /// come back empty keep what was known.
  @discardableResult
  public static func recordSignIn(
    _ storage: (any KeyValueStore)?,
    did: String,
    mode: String,
    handle: String? = nil,
    displayName: String? = nil,
    avatar: String? = nil,
    scope: SignInScope = .unsaid,
    now: Double
  ) -> [AccountRow] {
    let list = readAccounts(storage)
    let old = findAccount(list, did)
    func either(_ given: String?, _ known: String?) -> String? {
      if let given, !given.isEmpty { return given }
      if let known, !known.isEmpty { return known }
      return nil
    }
    var row = old ?? AccountRow(did: did)
    row.did = did
    row.mode = mode
    row.handle = either(handle, old?.handle)
    row.displayName = either(displayName, old?.displayName)
    row.avatar = either(avatar, old?.avatar)
    row.lastUsed = now
    row.addedAt = (old?.addedAt).flatMap { $0 != 0 && !$0.isNaN ? $0 : nil } ?? now
    row.signedOut = nil
    switch scope {
    case .granted(let granted): row.scope = granted
    case .cleared: row.scope = nil
    case .unsaid: if let old, !old.mode.jsEquals(mode) { row.scope = nil }
    }
    return writeAccounts(storage, [row] + list.filter { !$0.did.jsEquals(did) })
  }

  /// `updateAccount(storage, did, fields)`: merge into one row, keeping the
  /// rest. A row that isn't there stays absent.
  @discardableResult
  public static func updateAccount(_ storage: (any KeyValueStore)?, _ did: String, _ change: (inout AccountRow) -> Void) -> [AccountRow] {
    let list = readAccounts(storage)
    guard findAccount(list, did) != nil else { return list }
    return writeAccounts(
      storage,
      list.map { row in
        guard row.did.jsEquals(did) else { return row }
        var merged = row
        change(&merged)
        merged.did = row.did
        return merged
      })
  }

  /// `touchAccount(storage, did, now)`: mark an account as opened now.
  @discardableResult
  public static func touchAccount(_ storage: (any KeyValueStore)?, _ did: String, now: Double) -> [AccountRow] {
    updateAccount(storage, did) { $0.lastUsed = now }
  }

  @discardableResult
  public static func markSignedOut(_ storage: (any KeyValueStore)?, _ did: String) -> [AccountRow] {
    updateAccount(storage, did) { $0.signedOut = true }
  }

  /// `forgetAccount(storage, did)`: its row, its token, and the open pointer
  /// if it named it.
  @discardableResult
  public static func forgetAccount(_ storage: (any KeyValueStore)?, _ did: String, secrets: (any SecretStore)?) -> [AccountRow] {
    let list = readAccounts(storage).filter { !$0.did.jsEquals(did) }
    writeAccounts(storage, list)
    removeBackendToken(secrets, did)
    if readActiveDid(storage).jsEquals(did) { storage?.removeItem(activeKey) }
    return list
  }

  public static func readActiveDid(_ storage: (any KeyValueStore)?) -> String? {
    let did = storage?.getItem(activeKey)
    return isDid(did) ? did : nil
  }

  public static func writeActiveDid(_ storage: (any KeyValueStore)?, _ did: String?) {
    if let did, isDid(did) {
      try? storage?.setItem(activeKey, did)
    } else {
      storage?.removeItem(activeKey)
    }
  }

  // MARK: The account open when a sign-in again started

  /// The account a window had open when it left to sign one in again, kept
  /// in that window's own store (the web's sessionStorage). Signing a
  /// different account back in brings this one back open rather than
  /// switching to the one that signed in.
  public static let openAtSignInKey = "virga:signin-open"

  public static func writeOpenAtSignIn(_ tabStorage: (any KeyValueStore)?, _ did: String?) {
    if let did, isDid(did) {
      try? tabStorage?.setItem(openAtSignInKey, did)
    } else {
      tabStorage?.removeItem(openAtSignInKey)
    }
  }

  /// The account recorded by writeOpenAtSignIn, once.
  public static func takeOpenAtSignIn(_ tabStorage: (any KeyValueStore)?) -> String? {
    let did = tabStorage?.getItem(openAtSignInKey)
    tabStorage?.removeItem(openAtSignInKey)
    return isDid(did) ? did : nil
  }

  // MARK: Long-session tokens

  /// `/^vg_[0-9a-f]{64}$/`, as Virga's server mints them.
  public static func isBackendToken(_ token: String?) -> Bool {
    guard let token else { return false }
    return BackendClient.isToken(token)
  }

  public static func readBackendToken(_ secrets: (any SecretStore)?, _ did: String) -> String? {
    let token = secrets?.secret(for: backendTokenKey(did))
    return isBackendToken(token) ? token : nil
  }

  @discardableResult
  public static func writeBackendToken(_ secrets: (any SecretStore)?, _ did: String?, _ token: String?) -> Bool {
    guard let did, let token, isBackendToken(token), isDid(did) else { return false }
    // With no store, the web's write() writes nothing and still says it did.
    guard let secrets else { return true }
    do {
      try secrets.setSecret(token, for: backendTokenKey(did))
      return true
    } catch {
      return false
    }
  }

  public static func removeBackendToken(_ secrets: (any SecretStore)?, _ did: String) {
    secrets?.removeSecret(for: backendTokenKey(did))
  }

  // MARK: Which account

  /// Accounts that are signed in here (not signed out).
  public static func signedInAccounts(_ list: [AccountRow]?) -> [AccountRow] {
    (list ?? []).filter { !$0.isSignedOut }
  }

  /// Which account to open: the remembered one if it's still signed in, else
  /// the most recently used account that is.
  public static func pickActiveAccount(_ list: [AccountRow]?, _ activeDid: String?) -> AccountRow? {
    let live = signedInAccounts(list)
    return findAccount(live, activeDid) ?? live.first
  }

  /// Where to go after `did` stops being usable: the most recently used
  /// other account that is signed in and not known to need a sign-in.
  public static func nextReadyAccount(
    _ list: [AccountRow]?, _ did: String?, statusOf: (String) -> String = { _ in "ready" }
  ) -> AccountRow? {
    signedInAccounts(list).first { !Optional($0.did).jsEquals(did) && statusOf($0.did) != "needsSignIn" }
  }

  // MARK: Naming

  /// The name to show: display name, else @handle, else a shortened DID.
  public static func accountName(_ account: (any AccountLike)?) -> String {
    if let name = account?.displayName, !name.isEmpty, !isDid(name) { return name }
    if let handle = account?.handle, !handle.isEmpty, !isDid(handle) { return "@\(handle)" }
    return shortDid(account?.did)
  }

  /// "@handle", or nil when only a DID is known.
  public static func accountHandle(_ account: (any AccountLike)?) -> String? {
    guard let handle = account?.handle, !handle.isEmpty, !isDid(handle) else { return nil }
    return "@\(handle)"
  }

  /// What to sign in with: the handle when known, else the DID.
  public static func accountSignInId(_ account: (any AccountLike)?) -> String {
    if let handle = account?.handle, !handle.isEmpty, !isDid(handle) { return handle }
    return account?.did ?? ""
  }

  /// Whether a row's label is worth refreshing from the public profile.
  public static func needsRefresh(_ account: (any AccountLike)?) -> Bool {
    guard let handle = account?.handle, !handle.isEmpty, !isDid(handle) else { return true }
    return (account?.avatar ?? "").isEmpty
  }

  /// `shortDid(did)`: up to 24 code units as it is, else the first 12, an
  /// ellipsis and the last 6.
  public static func shortDid(_ did: String?) -> String {
    guard let did, !did.isEmpty else { return "" }
    return did.jsLength <= 24 ? did : "\(did.jsSlice(0, 12))…\(did.jsSlice(-6))"
  }

  /// The label for the "signing you in again" notice: @handle, else the
  /// name, else the DID.
  public static func reauthNoticeLabel(_ account: (any AccountLike)?) -> String {
    guard let account else { return "This account" }
    if let handle = account.handle, !handle.isEmpty, !isDid(handle) { return "@\(handle)" }
    if let name = account.displayName, !name.isEmpty, !isDid(name) { return name }
    return account.did.isEmpty ? "This account" : account.did
  }

  /// `lastOpenedLabel(lastUsed, now)`: when this device last opened the
  /// account, for the front page ("Last opened today", "Last opened 3 days
  /// ago", …). By calendar day in `timeZone`, so late last night reads as
  /// yesterday.
  public static func lastOpenedLabel(_ lastUsed: Double?, now: Double, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String? {
    guard let lastUsed, lastUsed != 0, lastUsed.isFinite else { return nil }
    // startOfToday.setHours(0, 0, 0, 0); an invalid `now` stays invalid.
    var startOfToday = Double.nan
    if let f = JSDate.fields(now, timeZone: timeZone) {
      let wall = JSDate.makeDate(JSDate.makeDay(Double(f.year), Double(f.month), Double(f.date)), 0)
      startOfToday = JSDate.timeClip(JSDate.localToUTC(wall, timeZone: timeZone))
    }
    // Math.max(0, NaN) is NaN, which reads as over a year below.
    let raw = ((startOfToday - lastUsed) / dayMs).rounded(.up)
    let days = raw.isNaN ? raw : max(0, raw)
    let when: String
    if days == 0 {
      when = "today"
    } else if days == 1 {
      when = "yesterday"
    } else if days < 7 {
      when = "\(JSNumber.format(days)) days ago"
    } else if days < 30 {
      let weeks = (days / 7).jsRounded
      when = weeks == 1 ? "a week ago" : "\(JSNumber.format(weeks)) weeks ago"
    } else if days < 365 {
      let months = max(1, (days / 30).jsRounded)
      when = months == 1 ? "a month ago" : "\(JSNumber.format(months)) months ago"
    } else {
      when = "over a year ago"
    }
    return "Last opened \(when)"
  }

  // MARK: Re-authorization

  public static let reauthRequiredCode = "REAUTH_REQUIRED"

  /// `makeReauthRequiredError(did)`.
  public static func makeReauthRequiredError(_ did: String? = nil) -> ReauthRequiredError {
    ReauthRequiredError(did: did?.isEmpty == false ? did : nil)
  }

  /// `isReauthRequiredError(error)`: recognized by its code and nothing else.
  public static func isReauthRequiredError(_ error: (any Error)?) -> Bool {
    JSErrorFields(error)?.codeString == reauthRequiredCode
  }

  // MARK: What an account keeps here

  /// Per-account keys, by the module that owns each.
  static let localKeys: [@Sendable (String) -> String] = [
    { "virga:dashboards:\($0)" },  // src/dashboards/DashboardsContext.jsx
    { "virga:posting:\($0)" },  // src/posting/settings.js
    { "virga:annotations:\($0)" },  // src/reports/annotations.js
    { "virga:composer-autosave:\($0)" },  // src/posting/autosave.js
    { "virga:templates:\($0)" },  // src/posting/templates
    { "virga:template-usage:\($0)" },
    { "virga:adviser-usage:\($0)" },  // src/posting/adviser/usage.js
    { "virga:terms-accepted:\($0)" },  // src/legal/acceptance.js
  ]

  /// `localDataKeys(storage, did)`: every key holding `did`'s data on this
  /// device: the fixed ones, plus each `virga:keep:<name>:<did>` list, found
  /// by scanning (in code-unit order; the web takes the browser's order).
  /// Never the token, and never per-device keys such as `virga:preferences`.
  public static func localDataKeys(_ storage: (any KeyValueStore)?, _ did: String) -> [String] {
    guard isDid(did) else { return [] }
    var keys = localKeys.map { $0(did) }
    let suffix = ":\(did)".units
    let scanned = (storage?.allKeys() ?? []).filter { key in
      let units = key.units
      return units.hasPrefix("virga:keep:") && units.count >= suffix.count && Array(units.suffix(suffix.count)) == suffix
    }
    for key in scanned.sorted(by: { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }) where !keys.jsIncludes(key) {
      keys.append(key)
    }
    return keys
  }

  /// The databases holding `did`'s data (the archive's and the posting
  /// store's), by the names the web gives them.
  public static func localDatabases(_ did: String) -> [String] {
    isDid(did) ? ["virga-analytics:\(did)", "virga-posting:\(did)"] : []
  }

  /// Remove every key `localDataKeys` names.
  @discardableResult
  public static func removeLocalData(_ storage: (any KeyValueStore)?, _ did: String) -> [String] {
    let keys = localDataKeys(storage, did)
    for key in keys { storage?.removeItem(key) }
    return keys
  }
}
