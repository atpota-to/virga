// A JSON value, for the places the web app works with loosely typed data:
// records from arbitrary collections, XRPC bodies, stored settings, and the
// parity fixtures (ios/parity/) that hold the Swift ports to the web app's
// output.

import Foundation

public enum JSONValue: Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])
}

// MARK: - Accessors

extension JSONValue {
  public var isNull: Bool {
    if case .null = self { return true }
    return false
  }

  public var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var boolValue: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var doubleValue: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  /// The number as an Int when it is integral and in range.
  public var intValue: Int? {
    guard case .number(let value) = self, value.rounded() == value, abs(value) < 9.2e18 else { return nil }
    return Int(value)
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }

  public var objectValue: [String: JSONValue]? {
    if case .object(let value) = self { return value }
    return nil
  }

  /// A member of an object, or nil (not `.null`) when absent or not an object.
  public subscript(key: String) -> JSONValue? {
    get { objectValue?[key] }
    set {
      guard case .object(var object) = self else { return }
      object[key] = newValue
      self = .object(object)
    }
  }

  /// An element of an array, or nil when out of range or not an array.
  public subscript(index: Int) -> JSONValue? {
    guard case .array(let array) = self, array.indices.contains(index) else { return nil }
    return array[index]
  }

  /// JavaScript truthiness: false, 0, NaN, "" and null are falsy.
  public var isTruthy: Bool {
    switch self {
    case .null: return false
    case .bool(let value): return value
    case .number(let value): return value != 0 && !value.isNaN
    case .string(let value): return !value.isEmpty
    case .array, .object: return true
    }
  }
}

// MARK: - Codable

extension JSONValue: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a JSON value")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null:
      try container.encodeNil()
    case .bool(let value):
      try container.encode(value)
    case .number(let value):
      // JSON.stringify writes NaN and Infinity as null, and integral numbers
      // without a fraction; matching both keeps the output byte-comparable.
      if !value.isFinite {
        try container.encodeNil()
      } else if value.rounded() == value, abs(value) < 9.007_199_254_740_992e15 {
        try container.encode(Int64(value))
      } else {
        try container.encode(value)
      }
    case .string(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    }
  }
}

// MARK: - Conversions

extension JSONValue {
  /// Parses JSON text.
  public static func parse(_ data: Data) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: data)
  }

  public static func parse(_ text: String) throws -> JSONValue {
    try parse(Data(text.utf8))
  }

  /// Any Encodable as a JSONValue, through JSONEncoder.
  public init<T: Encodable>(encoding value: T, encoder: JSONEncoder = JSONEncoder()) throws {
    let data = try encoder.encode(value)
    self = try JSONDecoder().decode(JSONValue.self, from: data)
  }

  /// This value decoded as `T`, through JSONDecoder.
  public func decode<T: Decodable>(_ type: T.Type, decoder: JSONDecoder = JSONDecoder()) throws -> T {
    try decoder.decode(T.self, from: data())
  }

  /// JSON text. Sorted keys by default, so output is stable.
  public func data(sortedKeys: Bool = true, pretty: Bool = false) throws -> Data {
    let encoder = JSONEncoder()
    var formatting: JSONEncoder.OutputFormatting = [.withoutEscapingSlashes]
    if sortedKeys { formatting.insert(.sortedKeys) }
    if pretty { formatting.insert(.prettyPrinted) }
    encoder.outputFormatting = formatting
    return try encoder.encode(self)
  }

  public func jsonString(sortedKeys: Bool = true, pretty: Bool = false) -> String {
    guard let data = try? data(sortedKeys: sortedKeys, pretty: pretty) else { return "null" }
    return String(decoding: data, as: UTF8.self)
  }
}

// MARK: - Literals

extension JSONValue: ExpressibleByNilLiteral {
  public init(nilLiteral: ()) { self = .null }
}

extension JSONValue: ExpressibleByBooleanLiteral {
  public init(booleanLiteral value: Bool) { self = .bool(value) }
}

extension JSONValue: ExpressibleByIntegerLiteral {
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
}

extension JSONValue: ExpressibleByFloatLiteral {
  public init(floatLiteral value: Double) { self = .number(value) }
}

extension JSONValue: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) { self = .string(value) }
}

extension JSONValue: ExpressibleByArrayLiteral {
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
}

extension JSONValue: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
  }
}

extension JSONValue: CustomStringConvertible {
  public var description: String { jsonString() }
}
