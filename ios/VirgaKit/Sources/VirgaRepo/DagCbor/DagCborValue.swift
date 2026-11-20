// A DAG-CBOR value as @atcute/cbor's decoder hands it back: JSON's values,
// plus bytes and CID links. Numbers are doubles, as in JavaScript: an
// integer and the same value written as a float decode alike.
//
// `jsonValue` is the data model's JSON form, which is how the web's records
// look once decoded and serialized: a link is `{ "$link": "bafy…" }` and
// bytes are `{ "$bytes": "<unpadded base64>" }`.

import Foundation
import VirgaCore

public indirect enum DagCborValue: Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case bytes([UInt8])
  case link(CID)
  case array([DagCborValue])
  case map([String: DagCborValue])
}

extension DagCborValue {
  /// The data model's JSON form.
  public var jsonValue: JSONValue {
    switch self {
    case .null: return .null
    case .bool(let value): return .bool(value)
    case .number(let value): return .number(value)
    case .string(let value): return .string(value)
    case .bytes(let value): return .object(["$bytes": .string(Multibase.toBase64(value))])
    case .link(let cid): return .object(["$link": .string(cid.string)])
    case .array(let values): return .array(values.map(\.jsonValue))
    case .map(let members): return .object(members.mapValues(\.jsonValue))
    }
  }

  /// A member of a map, or nil.
  public subscript(key: String) -> DagCborValue? {
    if case .map(let members) = self { return members[key] }
    return nil
  }

  public var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var linkValue: CID? {
    if case .link(let cid) = self { return cid }
    return nil
  }

  public var bytesValue: [UInt8]? {
    if case .bytes(let value) = self { return value }
    return nil
  }
}

extension DagCborValue: Codable {
  /// Decodes the JSON form; a link or bytes object becomes `.link` or
  /// `.bytes` when it holds a valid CID or canonical base64.
  public init(from decoder: Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  /// Encodes the JSON form.
  public func encode(to encoder: Encoder) throws {
    try jsonValue.encode(to: encoder)
  }

  /// The value a JSON form stands for, reading `{ "$link" }` and
  /// `{ "$bytes" }` objects as the encoder does (only when that is the
  /// object's one member). One that doesn't parse stays a plain map.
  public init(json: JSONValue) {
    switch json {
    case .null: self = .null
    case .bool(let value): self = .bool(value)
    case .number(let value): self = .number(value)
    case .string(let value): self = .string(value)
    case .array(let values): self = .array(values.map(DagCborValue.init(json:)))
    case .object(let members):
      if members.count == 1, let text = members["$link"]?.stringValue, let cid = try? CID.fromString(text) {
        self = .link(cid)
      } else if members.count == 1, let text = members["$bytes"]?.stringValue,
        let bytes = try? DagCbor.fromBytesString(text)
      {
        self = .bytes(bytes)
      } else {
        self = .map(members.mapValues(DagCborValue.init(json:)))
      }
    }
  }
}
