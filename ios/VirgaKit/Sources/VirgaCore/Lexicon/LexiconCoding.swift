// How the lexicon models encode, so they round-trip atproto JSON exactly.
//
// The rules every model in Lexicon/ follows:
//
// - Field names are the lexicon's, so a model encodes to the JSON the web
//   reads and writes. Fields the lexicon requires are non-optional; the rest
//   are optional and left out when nil.
// - A record (something written to a repo) always writes its `$type`, and
//   keeps the fields this version doesn't know in `extra`, so a record read
//   from a repo and written back loses nothing (the web spreads
//   `{ ...existing, field }`). A field it knows but can't read (the wrong
//   type) is kept in `extra` too, as it was, rather than failing the record.
// - A union is an enum with a case per member and `.unknown(JSONValue)` for a
//   member this version doesn't know, decided by `$type` (as FacetFeature
//   is). A member that fails to decode is kept as `.unknown` too.
// - A view that can be a union member (PostView, ListView, GeneratorView, …)
//   keeps the `$type` it came with in `lexiconType`; the union writes its
//   member's `$type` when it has none.
// - Decoding a model whose required fields are missing throws: a malformed
//   record isn't that kind of record. Where the web reads a possibly
//   malformed record field by field, read it as JSONValue and decode the
//   parts that matter, as the web does.

import Foundation

/// A coding key for any field name.
public struct LexiconKey: CodingKey, Hashable, Sendable, ExpressibleByStringLiteral {
  public let stringValue: String
  public var intValue: Int? { nil }
  public init(_ string: String) { stringValue = string }
  public init(stringValue: String) { self.stringValue = stringValue }
  public init?(intValue: Int) { nil }
  public init(stringLiteral value: String) { stringValue = value }
}

/// Reads a model's fields, keeping what it can't read for the round trip.
///
///     var r = try LexiconReader(decoder, recordType: Self.nsid)
///     text = try r.required("text")
///     facets = r.optional("facets")
///     extra = try r.extra()
public struct LexiconReader {
  public let container: KeyedDecodingContainer<LexiconKey>
  private var known: Set<String> = ["$type"]
  private var kept: [String: JSONValue] = [:]

  /// - Parameter recordType: a record's collection: decoding fails when the
  ///   object's `$type` names another (a missing `$type` is allowed).
  public init(_ decoder: Decoder, recordType: String? = nil) throws {
    container = try decoder.container(keyedBy: LexiconKey.self)
    if let recordType, let type = try container.decodeIfPresent(String.self, forKey: "$type"), type != recordType {
      throw DecodingError.dataCorruptedError(
        forKey: "$type", in: container, debugDescription: "A \(type) record is not a \(recordType)")
    }
  }

  /// The object's `$type`, if it has one.
  public var type: String? { try? container.decodeIfPresent(String.self, forKey: "$type") }

  /// A field the lexicon requires: decoding fails without it.
  public mutating func required<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> T {
    known.insert(key)
    return try container.decode(T.self, forKey: LexiconKey(key))
  }

  /// An optional field: nil when absent. A value that isn't a `T` (or is
  /// null) reads as nil and is kept, as it was, in `extra()`.
  public mutating func optional<T: Decodable>(_ key: String, as type: T.Type = T.self) -> T? {
    known.insert(key)
    let codingKey = LexiconKey(key)
    guard container.contains(codingKey) else { return nil }
    if let value = try? container.decodeIfPresent(T.self, forKey: codingKey) { return value }
    kept[key] = try? container.decode(JSONValue.self, forKey: codingKey)
    return nil
  }

  /// The fields the model doesn't read, and the ones it couldn't.
  public func extra() throws -> [String: JSONValue] {
    var out = kept
    for key in container.allKeys where !known.contains(key.stringValue) {
      out[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
    }
    return out
  }
}

/// Writes a model's fields: its kept fields first, then `$type`, then the
/// fields it has, so a field set since it was read wins over the copy kept.
public struct LexiconWriter {
  public var container: KeyedEncodingContainer<LexiconKey>

  public init(_ encoder: Encoder, type: String? = nil, extra: [String: JSONValue] = [:]) throws {
    container = encoder.container(keyedBy: LexiconKey.self)
    for (key, value) in extra { try container.encode(value, forKey: LexiconKey(key)) }
    if let type { try container.encode(type, forKey: "$type") }
  }

  public mutating func put<T: Encodable>(_ value: T, _ key: String) throws {
    try container.encode(value, forKey: LexiconKey(key))
  }

  /// Writes the field when it has a value.
  public mutating func put<T: Encodable>(_ value: T?, _ key: String) throws {
    if let value { try container.encode(value, forKey: LexiconKey(key)) }
  }
}

/// A record type: written to a repo under its collection, `$type` and all.
public protocol LexiconRecord: Codable, Hashable, Sendable {
  /// The collection NSID, which is also the record's `$type`.
  static var nsid: String { get }
  /// Fields this version doesn't model, kept for the round trip.
  var extra: [String: JSONValue] { get set }
}

/// A union member that knows its `$type`.
public protocol LexiconTyped {
  static var type: String { get }
}

/// A view that keeps the `$type` it was read with, so it can be written back
/// as it came, and is given its type when written as a union member.
public protocol LexiconTypedObject: Codable, LexiconTyped {
  var lexiconType: String? { get set }
}

public enum Lexicon {
  /// The `$type` of the object `decoder` holds, if any.
  public static func type(in decoder: Decoder) -> String? {
    guard let container = try? decoder.container(keyedBy: LexiconKey.self) else { return nil }
    return try? container.decodeIfPresent(String.self, forKey: "$type")
  }

  /// A union member: `T` from the decoder, wrapped, or the raw JSON when it
  /// isn't a `T` after all.
  public static func member<T: Decodable, U>(
    _ decoder: Decoder, _ type: T.Type, _ wrap: (T) -> U, unknown: (JSONValue) -> U
  ) throws -> U {
    if let value = try? T(from: decoder) { return wrap(value) }
    return unknown(try JSONValue(from: decoder))
  }

  /// Writes a view as a union member: with its `$type`, the member's own if
  /// it came with none.
  public static func encodeMember<T: LexiconTypedObject>(_ value: T, to encoder: Encoder) throws {
    var typed = value
    if typed.lexiconType == nil { typed.lexiconType = T.type }
    try typed.encode(to: encoder)
  }
}
