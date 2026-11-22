// Ports src/posting/lib/composerModel.js
//
// The bits of JavaScript the composer's modules lean on for loosely typed
// values: `plainObject(v)`, `typeof v === 'string' ? v : ''`, truthiness,
// `Number.isInteger`, `array.slice` with negative ends, `list.includes(v)`
// and `new Set(strings)` by code unit, `x?.length`, `{ ...v }` and `a === b`.
// Internal to VirgaPosting; the composer, autosave, settings and schedule
// ports share them.

import Foundation
import VirgaCore

enum ComposerJS {
  /// `v !== null && typeof v === 'object' && !Array.isArray(v)`.
  static func isObject(_ value: JSONValue?) -> Bool {
    if case .object? = value { return true }
    return false
  }

  /// `typeof v === 'string' ? v : ''`.
  static func str(_ value: JSONValue?) -> String {
    value?.stringValue ?? ""
  }

  /// Whether a value is truthy (absent is not).
  static func truthy(_ value: JSONValue?) -> Bool {
    value?.isTruthy ?? false
  }

  /// `a || b` for members: the first when truthy.
  static func or(_ a: JSONValue?, _ b: @autoclosure () -> JSONValue?) -> JSONValue? {
    truthy(a) ? a : b()
  }

  /// `a ?? b`: the first unless null or absent.
  static func coalesce(_ a: JSONValue?, _ b: @autoclosure () -> JSONValue?) -> JSONValue? {
    if let a, !a.isNull { return a }
    return b()
  }

  /// `Number.isInteger(value)`.
  static func isInteger(_ value: JSONValue?) -> Bool { PostingJS.isInteger(value) }

  /// An integer the way the web compares one: `value` when it is an
  /// integer, clamped far past any array's length so the comparisons the web
  /// makes with it come out the same; nil when it isn't an integer.
  static func integer(_ value: JSONValue?) -> Int? {
    guard isInteger(value), case .number(let n)? = value else { return nil }
    return Int(Swift.max(Swift.min(n, 1e15), -1e15))
  }

  /// `a === b`: primitives by value (strings by code unit), absent only
  /// equal to absent, objects and arrays never equal.
  static func strictEquals(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    TemplateJS.strictEquals(a, b)
  }

  /// SameValueZero (`Set.has`, `includes`): `===`, except NaN equals NaN.
  static func sameValueZero(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    if case .number(let x)? = a, case .number(let y)? = b, x.isNaN, y.isNaN { return true }
    return strictEquals(a, b)
  }

  /// `{ ...v }`'s members.
  static func spread(_ value: JSONValue?) -> [String: JSONValue] {
    TemplateJS.spread(value)
  }

  /// `Array.isArray(v) ? v : []`.
  static func list(_ value: JSONValue?) -> [JSONValue] {
    value?.arrayValue ?? []
  }

  /// `Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s) : []`.
  static func stringList(_ value: JSONValue?) -> [String] {
    list(value).compactMap { item in
      guard let text = item.stringValue, !text.isEmpty else { return nil }
      return text
    }
  }

  /// `[...new Set(strings)]`: the first of each, by code unit.
  static func unique(_ strings: [String]) -> [String] {
    var seen = Set<JSKey>()
    return strings.filter { seen.insert(JSKey($0)).inserted }
  }

  /// `list.includes(value)` for a list of strings and a value of any type.
  static func includes(_ list: [String], _ value: JSONValue?) -> Bool {
    guard let text = value?.stringValue else { return false }
    return list.jsIncludes(text)
  }

  /// `array.slice(start, end)` with JavaScript's negative indexes.
  static func slice<T>(_ items: [T], _ start: Int, _ end: Int? = nil) -> [T] {
    let count = items.count
    let from = start < 0 ? Swift.max(count + start, 0) : Swift.min(start, count)
    let upper = end ?? count
    let to = upper < 0 ? Swift.max(count + upper, 0) : Swift.min(upper, count)
    return from < to ? Array(items[from..<to]) : []
  }

  /// `value?.length` as a number, for an array or a string (0 otherwise),
  /// where the web tests `x?.length` for truthiness.
  static func length(_ value: JSONValue?) -> Int {
    switch value {
    case .array(let items)?: return items.count
    case .string(let text)?: return text.utf16.count
    default: return 0
    }
  }

  /// `typeof v?.trim === 'function' ? v.trim() : ''` for the web's
  /// `v?.trim()` on a value that should be a string: a non-string reads as
  /// empty (where the web would throw calling `trim` on it).
  static func trimmed(_ value: JSONValue?) -> String {
    value?.stringValue?.jsTrimmed() ?? ""
  }

  /// `String(v ?? '')`.
  static func string(_ value: JSONValue?) -> String {
    guard let value, !value.isNull else { return "" }
    return value.jsString
  }

  /// `obj[key]` over an object's own members, by code unit, where `key` is
  /// any value (`String(key)`, so a missing key is "undefined").
  static func member(_ object: [String: JSONValue], _ key: JSONValue?) -> JSONValue? {
    object.jsValue(key.map(\.jsString) ?? "undefined")
  }

  /// An object's members with `keys` taken out (`const { a, b, ...rest } = v`).
  static func without(_ value: JSONValue, _ keys: [String]) -> JSONValue {
    var members = spread(value)
    for key in keys { members[key] = nil }
    return .object(members)
  }
}
