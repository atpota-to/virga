// Ports src/posting/lib/recordCid.js
//
// Local record CIDs, so the posts of a thread written in one applyWrites can
// name their parent's { uri, cid } before anything is written. A record's
// CID is deterministic: CIDv1 (base32) of its DAG-CBOR encoding hashed with
// SHA-256, as the PDS computes it.
//
// The encoder takes the data model's JSON form ({ $link }, { $bytes }), so
// every value is brought to that form first. On the web that means turning
// CID and BlobRef instances and Uint8Arrays into it; in Swift it means
// encoding a value with the JSON-shape encoder below: `Data` as
// `{ $bytes }`, a `CID` as `{ $link }`, a `Date` as its ISO string, nil
// members left out (DAG-CBOR has no undefined). VirgaCore's BlobRef already
// encodes as `{ $type: 'blob', ref: { $link }, mimeType, size }`.
//
// The web rebuilds every object with `out[key] = …`, so a member named
// "__proto__" is dropped and becomes the object's prototype instead, which
// the encoder then reads through: such a record's CID is the web's (not the
// PDS's), as Support/JSObjects.swift explains.

import Foundation
import VirgaCore

public enum RecordCid {
  /// A value in JSON form is already in the JSON shape, but for a member
  /// named "__proto__", which the web's rebuilt object doesn't keep (at any
  /// depth): what JSON.stringify writes of the web's result.
  public static func toJsonShape(_ value: JSONValue) -> JSONValue {
    JSShaped(shaping: value).jsonValue
  }

  /// A decoded value in JSON form: links as `{ $link }`, bytes as
  /// `{ $bytes }` (unpadded base64).
  public static func toJsonShape(_ value: DagCborValue) -> JSONValue {
    toJsonShape(value.jsonValue)
  }

  /// Any Encodable value in JSON form, as the web's `toJsonShape` brings a
  /// record to it: bytes (`Data`) as `{ $bytes }`, CIDs as `{ $link }`,
  /// dates as ISO strings, nil members dropped.
  public static func toJsonShape<T: Encodable>(_ value: T) throws -> JSONValue {
    toJsonShape(try encodedJSON(value))
  }

  /// The CID string the PDS will assign to `record`. The record must include
  /// its `$type`, or the CID won't match.
  public static func computeRecordCid(_ record: JSONValue) throws -> String {
    CID.create(codec: CID.codecDagCbor, data: try DagCbor.encode(JSShaped(shaping: record))).string
  }

  public static func computeRecordCid<T: Encodable>(_ record: T) throws -> String {
    try computeRecordCid(encodedJSON(record))
  }

  /// A Swift value in JSON form, before `toJsonShape`. JSON text can't hold
  /// NaN or ±Infinity, but the web's `toJsonShape` passes them through (and
  /// its encoder then refuses them), so they cross the text as marker
  /// strings and come back as numbers.
  static func encodedJSON<T: Encodable>(_ value: T) throws -> JSONValue {
    let encoder = jsonShapeEncoder()
    encoder.nonConformingFloatEncodingStrategy = .convertToString(
      positiveInfinity: NonFinite.positiveInfinity, negativeInfinity: NonFinite.negativeInfinity, nan: NonFinite.nan)
    return NonFinite.restore(try JSONValue.parse(encoder.encode(value)))
  }

  /// The markers: private-use characters around a name, which no record
  /// holds and JSON needs no escapes for (JSONEncoder doesn't escape these
  /// strings inside arrays, so a control character would break the text).
  private enum NonFinite {
    static let positiveInfinity = "\u{F8FF}virga.recordCid:+Infinity\u{F8FF}"
    static let negativeInfinity = "\u{F8FF}virga.recordCid:-Infinity\u{F8FF}"
    static let nan = "\u{F8FF}virga.recordCid:NaN\u{F8FF}"

    static func restore(_ value: JSONValue) -> JSONValue {
      switch value {
      case .string(positiveInfinity): return .number(.infinity)
      case .string(negativeInfinity): return .number(-.infinity)
      case .string(nan): return .number(.nan)
      case .array(let values): return .array(values.map(restore))
      case .object(let members): return .object(members.mapValues(restore))
      default: return value
      }
    }
  }

  /// A JSONEncoder that writes the data model's JSON form.
  public static func jsonShapeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    encoder.dataEncodingStrategy = .custom { data, encoder in
      var container = encoder.container(keyedBy: ShapeKey.self)
      try container.encode(Multibase.toBase64(data), forKey: ShapeKey(stringValue: "$bytes"))
    }
    encoder.dateEncodingStrategy = .custom { date, encoder in
      // `JSON.stringify(new Date(ms))`: its ISO string, or null for an
      // invalid date. A JavaScript date holds whole milliseconds, cut toward
      // zero (TimeClip, which toISOString applies): round away the float
      // error of seconds-since-1970 first, then let it cut.
      var container = encoder.singleValueContainer()
      let micros = (date.timeIntervalSince1970 * 1_000_000).rounded()
      if let text = JSDate.toISOString(micros / 1000) {
        try container.encode(text)
      } else {
        try container.encodeNil()
      }
    }
    return encoder
  }

  private struct ShapeKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }
}
