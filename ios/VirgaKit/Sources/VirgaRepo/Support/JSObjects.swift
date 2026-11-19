// What recordCid.js's `toJsonShape` hands the encoder, as JavaScript holds
// it. It builds each object with `out[key] = toJsonShape(value)`, and an
// assignment to a member named "__proto__" doesn't make a member: it sets
// the new object's prototype (to an object, an array or null; any other
// value is ignored). So a record holding a "__proto__" member loses it, and
// @atcute/cbor's encoder, which reads `val.constructor`, `'$link' in val`,
// `val.$bytes` and `String(val)` through the prototype, may then take the
// object for a link, for bytes, or for something it can't encode.
//
// JSON never shows a prototype: `jsonValue` is the object's own members,
// what JSON.stringify writes. The encoder (DagCborEncoder.swift) reads
// through the whole chain with `get`.
//
// No record a person writes has such a member; this is here so the port
// computes what the web computes for any input, as the parity fixtures
// check.

import Foundation
import VirgaCore

/// A value after `toJsonShape`, with each object's prototype.
indirect enum JSShaped: Sendable, Hashable {
  /// null, a boolean, a number or a string.
  case primitive(JSONValue)
  case array([JSShaped])
  case object(JSShapedObject)

  /// `toJsonShape(value)` for a value in JSON form.
  init(shaping value: JSONValue) {
    switch value {
    case .array(let values):
      self = .array(values.map(JSShaped.init(shaping:)))
    case .object(let members):
      var own: [String: JSShaped] = [:]
      var prototype: JSPrototype = .objectPrototype
      for (key, member) in members {
        let shaped = JSShaped(shaping: member)
        guard key == "__proto__" else {
          own[key] = shaped
          continue
        }
        // `out.__proto__ = shaped`: the prototype, when it can be one.
        switch shaped {
        case .object(let object): prototype = .object(object)
        case .array(let elements): prototype = .array(elements)
        case .primitive(.null): prototype = .null
        case .primitive: break
        }
      }
      self = .object(JSShapedObject(members: own, prototype: prototype))
    default:
      self = .primitive(value)
    }
  }

  /// The value as JSON carries it: each object's own members.
  var jsonValue: JSONValue {
    switch self {
    case .primitive(let value): return value
    case .array(let values): return .array(values.map(\.jsonValue))
    case .object(let object): return .object(object.members.mapValues(\.jsonValue))
    }
  }
}

/// An object `toJsonShape` built: its own members and its prototype.
struct JSShapedObject: Sendable, Hashable {
  var members: [String: JSShaped]
  var prototype: JSPrototype
}

/// An object's prototype.
indirect enum JSPrototype: Sendable, Hashable {
  /// Object.prototype, as for any object literal.
  case objectPrototype
  /// None.
  case null
  /// Another object `toJsonShape` built.
  case object(JSShapedObject)
  /// An array (its elements), and Array.prototype behind it.
  case array([JSShaped])
}

/// What a property read finds.
enum JSProperty: Sendable, Hashable {
  case undefined
  /// A member holding a value.
  case data(JSShaped)
  /// The `Object` function (Object.prototype.constructor).
  case objectConstructor
  /// The `Array` function (Array.prototype.constructor).
  case arrayConstructor
  /// A built-in method the encoder's reads can reach.
  case objectToString, objectValueOf, arrayToString, arrayJoin
}

enum JSObjects {
  /// V8's String::kMaxLength: a longer string throws "Invalid string length".
  static let maxStringLength = 536_870_888

  // MARK: Property reads

  /// `value[key]`, through the prototype chain.
  static func get(_ value: JSShaped, _ key: String) -> JSProperty {
    switch value {
    case .primitive: return .undefined
    case .array(let elements): return getFromArray(elements, key)
    case .object(let object): return get(object, key)
    }
  }

  static func get(_ object: JSShapedObject, _ key: String) -> JSProperty {
    if let own = object.members[key] { return .data(own) }
    switch object.prototype {
    case .objectPrototype: return fromObjectPrototype(key)
    case .null: return .undefined
    case .object(let parent): return get(parent, key)
    case .array(let elements): return getFromArray(elements, key)
    }
  }

  /// A read from an array: its elements and length, then Array.prototype.
  private static func getFromArray(_ elements: [JSShaped], _ key: String) -> JSProperty {
    if key == "length" { return .data(.primitive(.number(Double(elements.count)))) }
    if let index = arrayIndex(key), index < elements.count { return .data(elements[index]) }
    switch key {
    case "constructor": return .arrayConstructor
    case "toString": return .arrayToString
    case "join": return .arrayJoin
    default: return fromObjectPrototype(key)
    }
  }

  /// The members of Object.prototype the encoder's reads can reach.
  private static func fromObjectPrototype(_ key: String) -> JSProperty {
    switch key {
    case "constructor": return .objectConstructor
    case "toString": return .objectToString
    case "valueOf": return .objectValueOf
    default: return .undefined
    }
  }

  /// A canonical array index ("0", "1", … below 2^32 - 1), or nil.
  private static func arrayIndex(_ key: String) -> Int? {
    let digits = Array(key.utf8)
    guard !digits.isEmpty, digits.count <= 10, digits.allSatisfy({ (48...57).contains($0) }) else { return nil }
    if digits.count > 1, digits[0] == 48 { return nil }
    guard let index = Int(key), index < 4_294_967_295 else { return nil }
    return index
  }

  // MARK: Conversions

  /// `String(value)`.
  static func toString(_ value: JSShaped) throws -> String {
    switch try toPrimitive(value) {
    case .string(let text): return text
    case let primitive: return try JS.toString(primitive)
    }
  }

  /// ToPrimitive. Either hint gives the same here: the only callable
  /// `valueOf` an object can reach is Object.prototype's, which returns the
  /// object itself, so `toString` decides. A member named `toString` or
  /// `valueOf` holds data and can't be called; with nothing callable left
  /// the conversion throws.
  static func toPrimitive(_ value: JSShaped) throws -> JSONValue {
    if case .primitive(let primitive) = value { return primitive }
    for method in ["toString", "valueOf"] {
      switch get(value, method) {
      case .objectToString:
        return .string("[object Object]")
      case .arrayToString:
        // Array.prototype.toString calls `this.join`, or falls back to
        // Object.prototype.toString when that isn't callable.
        if case .arrayJoin = get(value, "join") { return .string(try join(value)) }
        return .string("[object Object]")
      default:
        continue
      }
    }
    throw RepoError.type("Cannot convert object to primitive value")
  }

  /// `Number(value)` for what a read found.
  static func toNumber(_ property: JSProperty) throws -> Double {
    switch property {
    case .undefined: return .nan
    case .data(let value): return try JS.toNumber(toPrimitive(value))
    default: return .nan  // a function
    }
  }

  /// Array.prototype.join with "," over any object, as V8 runs it: the
  /// length read and clamped, refused past 2^32 - 1, each element read in
  /// turn (undefined and null are empty), and a result longer than a
  /// string can be refused.
  static func join(_ this: JSShaped) throws -> String {
    let rawLength = JS.toIntegerOrInfinity(try toNumber(get(this, "length")))
    let length = rawLength <= 0 ? 0 : Swift.min(rawLength, 9_007_199_254_740_991)
    guard length <= 4_294_967_295 else { throw RepoError.type("Invalid array length") }
    let count = Int(length)
    // Elements past the last one any object in the chain holds are all
    // undefined: read only up to there, and count the rest.
    let held = Swift.min(count, heldElements(this))
    var parts: [String] = []
    parts.reserveCapacity(held)
    var total = Swift.max(count - 1, 0)
    for index in 0..<held {
      let part: String
      switch get(this, String(index)) {
      case .undefined, .data(.primitive(.null)): part = ""
      case .data(let element): part = try toString(element)
      default: part = "function"  // unreachable: no index names a built-in
      }
      total += part.utf16.count
      if total > maxStringLength { throw RepoError.range("Invalid string length") }
      parts.append(part)
    }
    if total > maxStringLength { throw RepoError.range("Invalid string length") }
    var text = parts.joined(separator: ",")
    if count > held { text += String(repeating: ",", count: count - Swift.max(held, 1)) }
    return text
  }

  /// One past the highest index any object in `value`'s chain holds.
  private static func heldElements(_ value: JSShaped) -> Int {
    switch value {
    case .primitive: return 0
    case .array(let elements): return elements.count
    case .object(var object):
      var most = 0
      while true {
        for key in object.members.keys {
          if let index = arrayIndex(key) { most = Swift.max(most, index + 1) }
        }
        switch object.prototype {
        case .objectPrototype, .null: return most
        case .array(let elements): return Swift.max(most, elements.count)
        case .object(let parent): object = parent
        }
      }
    }
  }

  /// `${prefix}${text}`, which throws when the result is too long a string.
  static func concat(_ prefix: String, _ text: String) throws -> String {
    guard prefix.utf16.count + text.utf16.count <= maxStringLength else {
      throw RepoError.range("Invalid string length")
    }
    return prefix + text
  }
}
