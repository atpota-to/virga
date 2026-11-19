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

import Foundation
import VirgaCore

public enum RecordCid {
  /// A value already in JSON form is its own JSON shape.
  public static func toJsonShape(_ value: JSONValue) -> JSONValue {
    value
  }

  /// A decoded value in JSON form: links as `{ $link }`, bytes as
  /// `{ $bytes }` (unpadded base64).
  public static func toJsonShape(_ value: DagCborValue) -> JSONValue {
    value.jsonValue
  }

  /// Any Encodable value in JSON form, as the web's `toJsonShape` brings a
  /// record to it: bytes (`Data`) as `{ $bytes }`, CIDs as `{ $link }`,
  /// dates as ISO strings, nil members dropped.
  public static func toJsonShape<T: Encodable>(_ value: T) throws -> JSONValue {
    let data = try jsonShapeEncoder().encode(value)
    return try JSONValue.parse(data)
  }

  /// The CID string the PDS will assign to `record`. The record must include
  /// its `$type`, or the CID won't match.
  public static func computeRecordCid(_ record: JSONValue) throws -> String {
    CID.create(codec: CID.codecDagCbor, data: try DagCbor.encode(toJsonShape(record))).string
  }

  public static func computeRecordCid<T: Encodable>(_ record: T) throws -> String {
    CID.create(codec: CID.codecDagCbor, data: try DagCbor.encode(toJsonShape(record))).string
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
      // `JSON.stringify(date)`: its ISO string, or null for an invalid date.
      // A JavaScript date holds whole milliseconds: round away the float
      // error of seconds-since-1970 first, then drop any fraction.
      var container = encoder.singleValueContainer()
      let micros = (date.timeIntervalSince1970 * 1_000_000).rounded()
      if let text = JSDate.toISOString((micros / 1000).rounded(.down)) {
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
