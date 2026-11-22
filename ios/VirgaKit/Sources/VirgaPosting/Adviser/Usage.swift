// Ports src/posting/adviser/usage.js
//
// What this device has seen of an account's free AI allowance this month.
//
// Virga's server counts and enforces it (per account, per calendar month in
// UTC). It answers each counted request with `usage: { used, limit }`, and a
// request over the allowance with `{ error: 'monthly_limit', limit }`.
// Accounts whose allowance is unlimited get no `usage` at all, so an answer
// without it clears what was kept.
//
// This copy is a hint, never a gate on its own: it lets the composer skip
// the automatic check once the month's reads are used up, and lets a page
// say how many are left.
//
// Stored at `virga:adviser-usage:<did>` (the web's localStorage, here a
// KeyValueStore) as `{ month, used, limit }` for adviser reads, with the
// same shape under `altText` and `style` for the other two allowances.

import Foundation
import VirgaCore
import VirgaNetwork

/// One of the three allowances (USAGE_FEATURES).
public enum AdviserUsageFeature: String, CaseIterable, Codable, Hashable, Sendable {
  case adviser
  case altText
  case style

  /// `checkFeature(feature)`: the allowance a name names, or the web's
  /// TypeError for one it doesn't know.
  public static func checked(_ name: String?) throws -> AdviserUsageFeature {
    guard let name, let feature = allCases.first(where: { $0.rawValue.jsEquals(name) }) else {
      throw AdviserUsageError(message: "Not an AI allowance: \(name ?? "undefined")")
    }
    return feature
  }
}

/// The TypeError usage.js throws for an allowance it doesn't know.
public struct AdviserUsageError: Error, LocalizedError, Hashable, Sendable {
  public var name = "TypeError"
  public var message: String
  public var errorDescription: String? { message }
}

/// This month's count for one allowance: `{ month, used, limit }`. The
/// counts are whole numbers (Math.floor of what the server said).
public struct AdviserUsage: Codable, Hashable, Sendable {
  public var month: String
  public var used: Double
  public var limit: Double

  public init(month: String, used: Double, limit: Double) {
    self.month = month
    self.used = used
    self.limit = limit
  }

  /// The usage as the web's object.
  public var json: JSONValue {
    ["month": .string(month), "used": .number(used), "limit": .number(limit)]
  }
}

public enum AdviserUsageStore {
  public static let adviserUsageKeyPrefix = "virga:adviser-usage:"

  public static let usageFeatures = AdviserUsageFeature.allCases.map(\.rawValue)

  /// What Virga's server allows each account a month by default. Shown only
  /// until the server has said; its own `limit` replaces it.
  public static let freeMonthlyLimits: [AdviserUsageFeature: Double] = [.adviser: 30, .altText: 15, .style: 3]

  public static func adviserUsageKey(_ did: String) -> String {
    "\(adviserUsageKeyPrefix)\(did)"
  }

  /// The month the server counts in: `YYYY-MM`, UTC ("NaN-NaN" for an
  /// invalid time, as the web writes it).
  public static func currentMonthKey(now: Double) -> String {
    guard let f = JSDate.utcFields(now) else { return "NaN-NaN" }
    let month = String(f.month + 1)
    return "\(f.year)-\(month.count < 2 ? "0" + month : month)"
  }

  /// When the allowance starts again: the first of next month, 00:00 UTC,
  /// in epoch milliseconds (NaN for an invalid time).
  public static func usageResetsAt(now: Double) -> Double {
    guard let f = JSDate.utcFields(now) else { return .nan }
    return JSDate.utc(Double(f.year), Double(f.month + 1), 1)
  }

  /// `typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null`.
  static func count(_ value: JSONValue?) -> Double? {
    guard case .number(let n)? = value, n.isFinite, n >= 0 else { return nil }
    return n.rounded(.down)
  }

  /// `!x` for a count (null and 0 are falsy).
  static func falsy(_ n: Double?) -> Bool { n == nil || n == 0 }

  /// Everything kept for the account, or `{}`.
  static func readAll(_ did: String?, _ store: (any KeyValueStore)?) -> [String: JSONValue] {
    guard let did, !did.isEmpty, let store else { return [:] }
    let raw = store.getItem(adviserUsageKey(did))
    guard let parsed = try? JSONValue.parse(raw?.isEmpty == false ? raw! : "null") else { return [:] }
    return parsed.objectValue ?? [:]
  }

  static func entryOf(_ all: [String: JSONValue], _ feature: AdviserUsageFeature) -> JSONValue? {
    if feature == .adviser {
      var entry: [String: JSONValue] = [:]
      for key in ["month", "used", "limit"] {
        if let value = all.jsValue(key) { entry[key] = value }
      }
      return .object(entry)
    }
    return all.jsValue(feature.rawValue)
  }

  static func write(_ did: String, _ value: [String: JSONValue], _ store: any KeyValueStore) {
    // Storage full or refused: the count is only a hint.
    try? store.setItem(adviserUsageKey(did), JSONStringify.stringify(.object(value)))
  }

  /// This month's count for `feature`, or nil when this device hasn't seen
  /// one (a new month, an unlimited account, nothing used yet).
  public static func readAdviserUsage(
    _ did: String?, feature: AdviserUsageFeature = .adviser, now: Double, store: (any KeyValueStore)?
  ) -> AdviserUsage? {
    guard let entry = entryOf(readAll(did, store), feature), entry.isTruthy,
      let month = entry["month"]?.stringValue, month.jsEquals(currentMonthKey(now: now))
    else { return nil }
    let used = count(entry["used"])
    let limit = count(entry["limit"])
    guard let used, let limit, limit != 0 else { return nil }
    return AdviserUsage(month: month, used: used, limit: limit)
  }

  /// Keep the count the server answered with (`{ used, limit }`). Ignores
  /// anything else, so an answer without usage changes nothing. Returns what
  /// is stored now.
  @discardableResult
  public static func recordAdviserUsage(
    _ did: String?, _ usage: JSONValue?, feature: AdviserUsageFeature = .adviser, now: Double,
    store: (any KeyValueStore)?
  ) -> AdviserUsage? {
    let used = count(usage?["used"])
    let limit = count(usage?["limit"])
    guard let did, !did.isEmpty, let store, let used, let limit, limit != 0 else { return nil }
    let entry = AdviserUsage(month: currentMonthKey(now: now), used: used, limit: limit)
    var next = readAll(did, store)
    if feature == .adviser {
      next["month"] = .string(entry.month)
      next["used"] = .number(used)
      next["limit"] = .number(limit)
    } else {
      next[feature.rawValue] = entry.json
    }
    write(did, next, store)
    return entry
  }

  /// Forget `feature`'s count for the account: the server answered a request
  /// for it without `usage`, which it does only for an unlimited allowance.
  public static func clearAdviserUsage(
    _ did: String?, feature: AdviserUsageFeature = .adviser, store: (any KeyValueStore)?
  ) {
    guard let did, !did.isEmpty, let store else { return }
    var next = readAll(did, store)
    if feature == .adviser {
      next.removeValue(forKey: "month")
      next.removeValue(forKey: "used")
      next.removeValue(forKey: "limit")
    } else {
      next.removeValue(forKey: feature.rawValue)
    }
    if next.isEmpty {
      store.removeItem(adviserUsageKey(did))
    } else {
      write(did, next, store)
    }
  }

  /// The server refused a request as over the month's allowance: remember
  /// it as used up. `limit` is what it said, else the last one seen, else
  /// the free one.
  @discardableResult
  public static func markAdviserLimitReached(
    _ did: String?, _ limit: JSONValue?, feature: AdviserUsageFeature = .adviser, now: Double,
    store: (any KeyValueStore)?
  ) -> AdviserUsage? {
    var known = count(limit)
    if falsy(known) {
      let seen = readAdviserUsage(did, feature: feature, now: now, store: store)?.limit
      known = falsy(seen) ? freeMonthlyLimits[feature]! : seen
    }
    let n = JSONValue.number(known!)
    return recordAdviserUsage(did, ["used": n, "limit": n], feature: feature, now: now, store: store)
  }

  /// Whether this month's allowance for `feature` is known to be used up.
  public static func isAdviserAtLimit(
    _ did: String?, feature: AdviserUsageFeature = .adviser, now: Double, store: (any KeyValueStore)?
  ) -> Bool {
    guard let usage = readAdviserUsage(did, feature: feature, now: now, store: store) else { return false }
    return usage.used >= usage.limit
  }

  /// How many are left this month, or nil when unknown (or unlimited).
  public static func adviserUsesLeft(
    _ did: String?, feature: AdviserUsageFeature = .adviser, now: Double, store: (any KeyValueStore)?
  ) -> Double? {
    guard let usage = readAdviserUsage(did, feature: feature, now: now, store: store) else { return nil }
    return Swift.max(0, usage.limit - usage.used)
  }

  static let nouns: [AdviserUsageFeature: (String, String)] = [
    .adviser: ("check", "checks"),
    .altText: ("description", "descriptions"),
    .style: ("style reading", "style readings"),
  ]

  /// The allowance in a sentence, or '' when nothing is known:
  /// "12 of 30 free checks left this month." or "No free checks left this
  /// month. They start again on December 1." (the date in `locale`, by
  /// default the active one).
  public static func adviserUsageLine(
    _ usage: JSONValue?, feature: AdviserUsageFeature = .adviser, now: Double, locale: String? = nil
  ) -> String {
    guard let usage, usage.isTruthy, !falsy(count(usage["limit"])), count(usage["used"]) != nil,
      case .number(let limit)? = usage["limit"], case .number(let used)? = usage["used"]
    else { return "" }
    let (one, many) = nouns[feature]!
    let left = Swift.max(0, limit - used)
    if left == 0 {
      let resets = AppLocale.toLocaleDateString(
        usageResetsAt(now: now), DateFormatOptions(month: "long", day: "numeric"),
        locale: locale ?? AppLocale.activeLocale(), timeZone: TimeZone(identifier: "UTC")!)
      return "No free \(many) left this month. They start again on \(resets)."
    }
    return "\(JSNumber.format(left)) of \(JSNumber.format(limit)) free \(limit == 1 ? one : many) left this month."
  }

  /// `adviserUsageLine` for a usage this module keeps.
  public static func adviserUsageLine(
    _ usage: AdviserUsage?, feature: AdviserUsageFeature = .adviser, now: Double, locale: String? = nil
  ) -> String {
    adviserUsageLine(usage?.json, feature: feature, now: now, locale: locale)
  }
}
