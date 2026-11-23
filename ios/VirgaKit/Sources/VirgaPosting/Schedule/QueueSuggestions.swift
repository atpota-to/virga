// Ports src/posting/schedule/queueSuggestions.js
//
// Suggested posting times for the weekly schedule, from the account's own
// best times to post (reports/models.js bestTimeModel: the hours its typical
// post did best, in this device's zone). Never applied without asking: a
// week still at the shipped default may be replaced by them, any other week
// only has them added. Pure.
//
// Schedules are loose JSON, as the composer's are (`{ timezone, slots }`).
// A best-times cell and a suggestion are read as the web reads the objects:
// `DAY_KEYS[cell.day]` by property key ('1' and [1] name Tuesday), the
// column and block through Number(). A day whose times are neither a list
// nor a string throws the web's TypeError (`….includes is not a function`),
// and a suggestion without a time adds one `undefined` (null in JSON), which
// sorts last and isn't added twice. The typed overloads read such a day as
// empty instead of throwing. Not reproduced (corrupt input only): `cell.day`
// 'length' (the array's own length, 7) and the inherited array methods
// ('map'), which the web takes for a day key.

import Foundation
import VirgaCore

/// A time to add to the week: `{ dayKey, time }` ('mon', '09:00').
public struct QueueSuggestion: Codable, Hashable, Sendable {
  public var dayKey: String
  public var time: String

  public init(dayKey: String, time: String) {
    self.dayKey = dayKey
    self.time = time
  }

  public var json: JSONValue { ["dayKey": .string(dayKey), "time": .string(time)] }
}

/// What the web throws when it can't walk or filter a value.
public struct QueueSuggestionsError: Error, LocalizedError, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

public enum QueueSuggestions {
  static let dayKeys = PostingQueue.weekdays.map(\.key)

  /// `DAY_KEYS[key]`: the day a property key names ('0'…'6'), or nil.
  static func dayKey(_ value: JSONValue?) -> String? {
    guard let value else { return nil }
    let key = value.jsString
    guard let index = Int(key), String(index) == key, index >= 0, index < dayKeys.count else { return nil }
    return dayKeys[index]
  }

  /// `for (const x of value || [])`: an array's elements, a string's
  /// characters (as one-unit strings), nothing for a falsy value; anything
  /// else throws as V8 does.
  static func iterate(_ value: JSONValue?, _ name: String) throws -> [JSONValue] {
    guard let value, value.isTruthy else { return [] }
    switch value {
    case .array(let items): return items
    case .string(let text): return text.unicodeScalars.map { .string(String($0)) }
    default: throw QueueSuggestionsError("(\(name) || []) is not iterable")
    }
  }

  /// bestTimeModel's `best` cells as schedule times: `[{ dayKey, time }]`,
  /// one per cell, at the start of its block of hours. `day` is 0 for
  /// Monday; `block` is hours per column, as the model was built.
  public static func suggestionsFromBestTimes(_ best: JSONValue? = [], _ block: JSONValue? = 1) throws
    -> [QueueSuggestion]
  {
    var out: [QueueSuggestion] = []
    var seen = Set<JSKey>()
    for cell in try iterate(best, "best") {
      let key = dayKey(cell["day"])
      let hour = cell["col"].jsNumber * (block ?? 1).jsNumber
      guard let key, hour.isFinite, hour == hour.rounded(.towardZero), hour >= 0, hour <= 23 else { continue }
      let digits = JSNumber.format(hour)
      let time = "\(digits.count < 2 ? "0" + digits : digits):00"
      guard seen.insert(JSKey("\(key) \(time)")).inserted else { continue }
      out.append(QueueSuggestion(dayKey: key, time: time))
    }
    return out
  }

  /// suggestionsFromBestTimes for typed cells (`day` 0 for Monday, `col`).
  public static func suggestionsFromBestTimes(_ best: [(day: Int, col: Int)], _ block: Int = 1) -> [QueueSuggestion] {
    let cells = JSONValue.array(best.map { ["day": .number(Double($0.day)), "col": .number(Double($0.col))] })
    return (try? suggestionsFromBestTimes(cells, .number(Double(block)))) ?? []
  }

  /// `(list || []).includes(value)` for an array or a string (a substring).
  /// `holdsUndefined` says whether the array holds an `undefined` this call
  /// put there (JSON has none, so it is null in `items`). Any other truthy
  /// value has no `includes`: `strict` throws V8's TypeError, naming the
  /// receiver as the web's source does (`receiver`); otherwise it holds
  /// nothing.
  static func includes(
    _ list: JSONValue?, _ value: JSONValue?, holdsUndefined: Bool = false, strict: Bool = false,
    receiver: String = "list"
  ) throws -> Bool {
    switch list {
    case .array(let items)?:
      guard let value else { return holdsUndefined }
      return items.contains { ComposerJS.sameValueZero($0, value) }
    case .string(let text)?:
      return text.jsIndexOf(value.map(\.jsString) ?? "undefined") >= 0
    case let other? where strict && other.isTruthy:
      throw QueueSuggestionsError("\(receiver).includes is not a function")
    default:
      return false
    }
  }

  /// `schedule?.slots || {}`.
  static func slotsOf(_ schedule: JSONValue?) -> JSONValue {
    ComposerJS.or(ComposerJS.truthy(schedule) ? schedule?["slots"] : nil, [:]) ?? [:]
  }

  /// `slots[key]` for a key read off a suggestion (its String form).
  static func slot(_ slots: JSONValue, _ key: JSONValue?) -> JSONValue? {
    let name = key.map(\.jsString) ?? "undefined"
    switch slots {
    case .object(let members): return members.jsValue(name)
    case .array(let items):
      guard let i = Int(name), String(i) == name, i >= 0, i < items.count else { return nil }
      return items[i]
    case .string(let text):
      let units = Array(text.utf16)
      guard let i = Int(name), String(i) == name, i >= 0, i < units.count else { return nil }
      return .string(String(decoding: [units[i]], as: UTF16.self))
    default: return nil
    }
  }

  /// A suggestion's members (`s.dayKey`); a null suggestion throws as the
  /// web's does.
  static func member(_ s: JSONValue, _ name: String) throws -> JSONValue? {
    if s.isNull { throw QueueSuggestionsError("Cannot read properties of null (reading '\(name)')") }
    return s.objectValue?[name]
  }

  /// The suggestions the week doesn't have yet.
  public static func missingSuggestions(_ schedule: JSONValue?, _ suggestions: JSONValue? = []) throws -> [JSONValue] {
    let slots = slotsOf(schedule)
    guard let suggestions, suggestions.isTruthy else { return [] }
    guard case .array(let items) = suggestions else {
      throw QueueSuggestionsError("(suggestions || []).filter is not a function")
    }
    return try items.filter { s in
      let held = slot(slots, try member(s, "dayKey"))
      return !(try includes(
        ComposerJS.or(held, nil), try member(s, "time"), strict: true, receiver: "(slots[s.dayKey] || [])"))
    }
  }

  /// missingSuggestions for typed suggestions; a day whose times aren't a
  /// list or a string reads as holding none.
  public static func missingSuggestions(_ schedule: JSONValue?, _ suggestions: [QueueSuggestion]) -> [QueueSuggestion] {
    let slots = slotsOf(schedule)
    return suggestions.filter {
      !((try? includes(ComposerJS.or(slot(slots, .string($0.dayKey)), nil), .string($0.time))) ?? false)
    }
  }

  /// The week with the suggested times added; nothing already there moves.
  public static func mergeSuggestionsIntoSchedule(_ schedule: JSONValue?, _ suggestions: JSONValue? = []) throws
    -> JSONValue
  {
    try merge(schedule, suggestions, strict: true)
  }

  /// mergeSuggestionsIntoSchedule for typed suggestions; a day whose times
  /// aren't a list or a string is replaced by the suggested ones.
  public static func mergeSuggestionsIntoSchedule(_ schedule: JSONValue?, _ suggestions: [QueueSuggestion]) -> JSONValue {
    (try? merge(schedule, .array(suggestions.map(\.json)), strict: false)) ?? [:]
  }

  static func merge(_ schedule: JSONValue?, _ suggestions: JSONValue?, strict: Bool) throws -> JSONValue {
    let base: JSONValue = TimerJS.isObject(schedule) ? schedule! : [:]
    var slots = ComposerJS.spread(ComposerJS.or(base["slots"], [:]))
    // The days this call gave an `undefined` time (a suggestion without
    // one): null in JSON, last in the day's sort, and found by
    // `includes(undefined)`.
    var holdsUndefined = Set<JSKey>()
    for s in try iterate(suggestions, "suggestions") {
      let key = canonicalKey(slots, (try member(s, "dayKey")).map(\.jsString) ?? "undefined")
      let time = try member(s, "time")
      let existing = ComposerJS.or(slots.jsValue(key), nil)
      let undefinedHeld = holdsUndefined.contains(JSKey(key))
      if try !includes(existing, time, holdsUndefined: undefinedHeld, strict: strict, receiver: "existing") {
        var items: [JSONValue]
        switch existing {
        case .array(let list)?: items = undefinedHeld ? list.dropLast() : list
        case .string(let text)?: items = text.unicodeScalars.map { .string(String($0)) }
        default: items = []
        }
        // `sort()` puts undefined after everything else.
        var sorted = PostingQueue.defaultSorted(time.map { items + [$0] } ?? items)
        if time == nil || undefinedHeld {
          sorted.append(.null)
          holdsUndefined.insert(JSKey(key))
        }
        slots[key] = .array(sorted)
      }
    }
    var out = ComposerJS.spread(base)
    out["timezone"] = .string(base["timezone"]?.stringValue ?? "")
    out["slots"] = .object(slots)
    return .object(out)
  }

  /// The key a member is already held under, when one matches `key` by
  /// code unit, else `key` itself: an object's keys are compared by code
  /// unit, Swift's dictionary keys by canonical equivalence.
  static func canonicalKey(_ members: [String: JSONValue], _ key: String) -> String {
    members.keys.first { $0.jsEquals(key) } ?? key
  }

  /// A week of the suggested times alone, set in `timezone`, else this
  /// device's zone (`localZone`, nil for the active one): the zone the best
  /// times were read in.
  public static func scheduleFromSuggestions(
    _ suggestions: JSONValue? = [], _ timezone: JSONValue? = nil, localZone: TimeZone? = nil
  ) throws -> JSONValue {
    var empty: [String: JSONValue] = [:]
    for key in dayKeys { empty[key] = [] }
    let zone: JSONValue = ComposerJS.or(timezone, .string(PostingQueue.resolveTimezone(nil, localZone: localZone)))!
    return try mergeSuggestionsIntoSchedule(["timezone": zone, "slots": .object(empty)], suggestions)
  }

  public static func scheduleFromSuggestions(
    _ suggestions: [QueueSuggestion], _ timezone: String? = nil, localZone: TimeZone? = nil
  ) -> JSONValue {
    (try? scheduleFromSuggestions(
      .array(suggestions.map(\.json)), timezone.map(JSONValue.string), localZone: localZone)) ?? [:]
  }
}
