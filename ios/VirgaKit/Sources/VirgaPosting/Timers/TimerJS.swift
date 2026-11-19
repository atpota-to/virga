// Ports src/posting/timers/selfDestruct.js
//
// The pieces of JavaScript's semantics the timer ports lean on: what
// `new Date(value).getTime()` makes of a loose value, `raw && typeof raw ===
// 'object'`, `x.toLocaleString(locale)` on a loose value, and
// `Array.prototype.sort` exactly as V8 runs it, for comparators that aren't
// a consistent order (compareTimers calls two unreadable times equal to
// everything). Internal.

import Foundation
import VirgaCore

enum TimerJS {
  /// `new Date(value).getTime()`: a number is clipped, a string parsed (a
  /// date-time without an offset in `timeZone`), null is the epoch, a
  /// boolean 0 or 1, an array its joined text, an object and undefined NaN.
  static func dateMs(_ value: JSONValue?, timeZone: TimeZone? = nil) -> Double {
    let zone = timeZone ?? AppLocale.activeTimeZone()
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

  /// `[...items].sort(compare)` as V8 sorts it (TimSort). Under 64
  /// elements, a run is counted from the start and the rest binary-inserted,
  /// comparison for comparison as V8 makes them, so even an inconsistent
  /// comparator gives V8's order. A comparator's NaN is 0. Longer arrays,
  /// which V8 merges, are sorted stably (the same order for any consistent
  /// comparator).
  static func v8Sorted<T>(_ items: [T], by compare: (T, T) -> Double) -> [T] {
    var a = items
    let n = a.count
    if n < 2 { return a }
    func cmp(_ x: T, _ y: T) -> Double {
      let v = compare(x, y)
      return v.isNaN ? 0 : v
    }
    guard n < 64 else {
      return a.enumerated()
        .sorted { x, y in
          let c = cmp(x.element, y.element)
          if c < 0 { return true }
          if c > 0 { return false }
          return x.offset < y.offset
        }
        .map(\.element)
    }
    // CountAndMakeRun(0, n).
    var run = 2
    let descending = cmp(a[1], a[0]) < 0
    var previous = a[1]
    var index = 2
    while index < n {
      let current = a[index]
      let order = cmp(current, previous)
      if descending ? order >= 0 : order < 0 { break }
      previous = current
      run += 1
      index += 1
    }
    if descending { a[0..<run].reverse() }
    // BinaryInsertionSort(0, run, n).
    var start = run
    while start < n {
      var left = 0
      var right = start
      let pivot = a[start]
      while left < right {
        let mid = left + ((right - left) >> 1)
        if cmp(pivot, a[mid]) < 0 { right = mid } else { left = mid + 1 }
      }
      var p = start
      while p > left {
        a[p] = a[p - 1]
        p -= 1
      }
      a[left] = pivot
      start += 1
    }
    return a
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
