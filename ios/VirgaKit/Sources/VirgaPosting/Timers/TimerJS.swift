// Ports src/posting/timers/selfDestruct.js
//
// The pieces of JavaScript's semantics the timer ports lean on: what
// `new Date(value).getTime()` makes of a loose value (and the one local
// zone it reads a date-time without an offset in), `raw && typeof raw ===
// 'object'`, `x.toLocaleString(locale)` on a loose value, and (in
// TimerJS+Sort.swift) `Array.prototype.sort` exactly as V8 runs it, for
// comparators that aren't a consistent order (compareTimers calls two
// unreadable times equal to everything). Internal.

import Foundation
import VirgaCore

enum TimerJS {
  /// The zone a date-time without an offset is read in while a function
  /// that was given a `timeZone` runs: the web has one local zone, so a
  /// rule's pin (read by normalizeTimer, however deep) and the sentence
  /// about it must read the same wall clock. Unbound, the active zone.
  static let localZone = TaskLocal<TimeZone?>(wrappedValue: nil)

  /// `explicit`, else the zone a caller bound, else the active one.
  static func zone(_ explicit: TimeZone? = nil) -> TimeZone {
    explicit ?? localZone.get() ?? AppLocale.activeTimeZone()
  }

  /// Runs `body` with `zone` as the local zone (the one already in force
  /// when nil).
  static func inZone<T>(_ zone: TimeZone?, _ body: () throws -> T) rethrows -> T {
    guard let zone else { return try body() }
    return try localZone.withValue(zone, operation: body)
  }

  /// `new Date(value).getTime()`: a number is clipped, a string parsed (a
  /// date-time without an offset in `timeZone`, else the local zone), null
  /// is the epoch, a boolean 0 or 1, an array its joined text, an object
  /// and undefined NaN.
  static func dateMs(_ value: JSONValue?, timeZone: TimeZone? = nil) -> Double {
    let zone = zone(timeZone)
    switch value {
    case .none: return .nan
    case .null: return 0
    case .bool(let flag): return flag ? 1 : 0
    case .number(let n): return VirgaCore.JSDate.timeClip(n)
    case .string(let text): return VirgaCore.JSDate.timeClip(VirgaCore.JSDate.parse(text, timeZone: zone))
    case .array: return VirgaCore.JSDate.timeClip(VirgaCore.JSDate.parse(value!.jsString, timeZone: zone))
    case .object: return .nan
    }
  }

  /// `raw && typeof raw === 'object' ? raw : {}`: the members of an object
  /// (an array is an object with none of the members asked for).
  static func members(_ raw: JSONValue?) -> [String: JSONValue] {
    raw?.objectValue ?? [:]
  }

  /// The value when it is truthy, else nil: `a || b` reads as
  /// `truthy(a) ?? b`. (Not `x.flatMap { $0.isTruthy ? $0 : nil }`:
  /// JSONValue is ExpressibleByNilLiteral, so that `nil` is `.null` and
  /// nothing is ever dropped.)
  static func truthy(_ value: JSONValue?) -> JSONValue? {
    guard let value, value.isTruthy else { return nil }
    return value
  }

  /// The value unless it is null or absent: `a ?? b` reads as
  /// `present(a) ?? b`.
  static func present(_ value: JSONValue?) -> JSONValue? {
    guard let value, !value.isNull else { return nil }
    return value
  }

  /// `raw && typeof raw === 'object'`.
  static func isObject(_ raw: JSONValue?) -> Bool {
    switch raw {
    case .object, .array: return true
    default: return false
    }
  }

  /// `value.toLocaleString(locale)` for a loose value: a number in the
  /// locale's format, an array its elements' joined by ",", anything else
  /// as `String(value)`.
  static func toLocaleString(_ value: JSONValue, locale: String?) -> String {
    switch value {
    case .number(let n): return AppLocale.formatNumber(n, locale: locale)
    case .array(let items):
      return items.map { $0.isNull ? "" : toLocaleString($0, locale: locale) }.joined(separator: ",")
    default: return value.jsString
    }
  }

  /// An element of `[a, b].join('|')`: undefined and null are empty.
  static func joinPiece(_ value: JSONValue?) -> String {
    guard let value, !value.isNull else { return "" }
    return value.jsString
  }

  /// Whether two values would `JSON.stringify` the same: compared by their
  /// JSON with every string by code unit, as `===` on the two texts does.
  static func sameJSON<T: Encodable>(_ a: T, _ b: T) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let x = try? encoder.encode(a), let y = try? encoder.encode(b) else { return false }
    return x == y
  }
}
