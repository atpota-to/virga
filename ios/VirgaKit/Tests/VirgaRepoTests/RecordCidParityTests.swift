// Parity for src/posting/lib/recordCid.js (ios/parity/cases/repo.recordCid.js):
// record CIDs as the PDS computes them, and the JSON form values are
// brought to first, from Swift's own types.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaRepo

/// A fixture's tagged toJsonShape input as Swift values: `Data` for a
/// Uint8Array, `CID` for a CID instance, VirgaCore's `BlobRef` for a
/// BlobRef, `Date` for a Date, a decoded `DagCborValue` for a lexified
/// record, and a missing member for `undefined`.
indirect enum ShapeInput: Encodable {
  case json(JSONValue)
  case bytes(Data)
  case cid(CID)
  case blobRef(BlobRef)
  case date(Date)
  case lex(DagCborValue)
  case undefined
  case array([ShapeInput])
  case object([String: ShapeInput])

  init(tagged value: JSONValue) throws {
    switch value {
    case .array(let values):
      self = .array(try values.map(ShapeInput.init(tagged:)))
    case .object(let members):
      if let bytes = members["$u8"]?.arrayValue {
        self = .bytes(Data(bytes.map { UInt8($0.intValue ?? 0) }))
      } else if let text = members["$cid"]?.stringValue {
        self = .cid(try CID.fromString(text))
      } else if let blob = members["$blobRef"] {
        // A legacy `{ cid, mimeType }` blob has no Swift type: it is JSON.
        self = blob["ref"] != nil ? .blobRef(try blob.decode(BlobRef.self)) : .json(blob)
      } else if let text = members["$date"]?.stringValue {
        self = .date(Date(timeIntervalSince1970: JSDate.parse(text, timeZone: TimeZone(identifier: "UTC")!) / 1000))
      } else if let lex = members["$lex"] {
        self = .lex(DagCborValue(json: lex))
      } else if members["$undefined"] != nil {
        self = .undefined
      } else {
        self = .object(try members.mapValues(ShapeInput.init(tagged:)))
      }
    default:
      self = .json(value)
    }
  }

  private struct Key: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  func encode(to encoder: Encoder) throws {
    switch self {
    case .json(let value): try value.encode(to: encoder)
    case .cid(let cid): try cid.encode(to: encoder)
    case .blobRef(let blob): try blob.encode(to: encoder)
    case .lex(let value): try value.encode(to: encoder)
    case .bytes(let data):
      var container = encoder.singleValueContainer()
      try container.encode(data)
    case .date(let date):
      var container = encoder.singleValueContainer()
      try container.encode(date)
    case .undefined:
      var container = encoder.singleValueContainer()
      try container.encodeNil()
    case .array(let values):
      var container = encoder.unkeyedContainer()
      for value in values { try container.encode(value) }
    case .object(let members):
      var container = encoder.container(keyedBy: Key.self)
      for (key, value) in members {
        if case .undefined = value { continue }
        try container.encode(value, forKey: Key(stringValue: key))
      }
    }
  }
}

@Suite struct RecordCidParity {
  @Test func computeRecordCid() throws {
    for c in try Parity.cases("repo.recordCid", fn: "computeRecordCid") {
      let actual = outcome { .string(try RecordCid.computeRecordCid(c["record"])) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func computeRecordCidOfParsedJSON() throws {
    // Records as JSON text: a "__proto__" member is a real member, which
    // the web's toJsonShape turns into the object's prototype.
    for c in try Parity.cases("repo.recordCid", fn: "computeRecordCid.json") {
      let record = try JSONValue.parse(c["json"].stringValue ?? "")
      let actual = outcome { .string(try RecordCid.computeRecordCid(record)) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func toJsonShapeOfParsedJSON() throws {
    for c in try Parity.cases("repo.recordCid", fn: "toJsonShape.json") {
      let value = try JSONValue.parse(c["json"].stringValue ?? "")
      #expect(exactDiff(RecordCid.toJsonShape(value), c.output, strictNulls: true) == nil, "\(c)")
      // A decoded value and a Swift value take the same shape.
      #expect(exactDiff(RecordCid.toJsonShape(DagCborValue(json: value)), c.output, strictNulls: true) == nil, "\(c)")
      #expect(exactDiff(try RecordCid.toJsonShape(value as JSONValue?), c.output, strictNulls: true) == nil, "\(c)")
    }
  }

  @Test func computeRecordCidFromSwiftValues() throws {
    for c in try Parity.cases("repo.recordCid", fn: "computeRecordCid.instances") {
      let actual = outcome { .string(try RecordCid.computeRecordCid(ShapeInput(tagged: c["value"]))) }
      #expect(exactDiff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func toJsonShape() throws {
    for c in try Parity.cases("repo.recordCid", fn: "toJsonShape") {
      let actual = outcome { try RecordCid.toJsonShape(ShapeInput(tagged: c["value"])) }
      #expect(exactDiff(actual, c.output, strictNulls: true) == nil, "\(c)")
    }
  }

  @Test func theWebTestsVectors() throws {
    // src/posting/lib/recordCid.test.js: CIDs bsky.app's PDS reported.
    let expected = [
      "pds: post with record embed, facets, unicode": "bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu",
      "pds: post with an image blob over 1MB": "bafyreibowb4zpdgv74mzhpn3w433q4affyql5jd6c43tluinucj4q2jdzy",
      "pds: reply with an image blob": "bafyreib3xpze6k6lagrwhjn75wj4daeaj73hvhhjkmt3d5umm6qkqba5fa",
    ]
    let cases = try Parity.cases("repo.recordCid", fn: "computeRecordCid").filter { expected[$0.id] != nil }
    #expect(cases.count == 3)
    for c in cases {
      #expect(try RecordCid.computeRecordCid(c["record"]) == expected[c.id], "\(c)")
    }
  }
}

@Suite struct RecordCidBehaviour {
  struct Image: Codable {
    var alt: String
    var image: BlobRef
    var note: String?
  }

  struct Post: Codable {
    var type = "app.bsky.feed.post"
    var text: String
    var images: [Image]
    var sig: Data
    var ref: CID
    var createdAt: Date
    var labels: [String]?

    enum CodingKeys: String, CodingKey {
      case type = "$type"
      case text, images, sig, ref, createdAt, labels
    }
  }

  @Test func swiftTypesGiveTheCidOfTheirJsonForm() throws {
    let ref = try CID.fromString("bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu")
    let post = Post(
      text: "héllo",
      images: [Image(alt: "", image: BlobRef(cid: "bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64", mimeType: "image/png", size: 3))],
      sig: Data([1, 2, 3]),
      ref: ref,
      createdAt: Date(timeIntervalSince1970: 1_773_576_000.123),
      labels: nil)
    let shape = try RecordCid.toJsonShape(post)
    let expected: JSONValue = [
      "$type": "app.bsky.feed.post",
      "text": "héllo",
      "images": [
        [
          "alt": "",
          "image": [
            "$type": "blob", "ref": ["$link": "bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64"],
            "mimeType": "image/png", "size": 3,
          ],
        ]
      ],
      "sig": ["$bytes": "AQID"],
      "ref": ["$link": "bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu"],
      "createdAt": "2026-03-15T12:00:00.123Z",
    ]
    #expect(shape == expected)
    #expect(try RecordCid.computeRecordCid(post) == RecordCid.computeRecordCid(expected))
  }

  @Test func jsonAndDecodedValuesAreTheirOwnShape() throws {
    let value: JSONValue = ["a": [1, "x", nil], "b": ["$link": "bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu"]]
    #expect(RecordCid.toJsonShape(value) == value)
    #expect(RecordCid.toJsonShape(DagCborValue(json: value)) == value)
  }

  @Test func nonFiniteNumbersAreRefusedByTheEncoder() throws {
    // The web's toJsonShape passes NaN and ±Infinity through; its encoder
    // refuses them.
    struct Odd: Encodable {
      var ratio: Double
      var list: [Double]
    }
    for bad in [Double.nan, .infinity, -.infinity] {
      let shape = try RecordCid.toJsonShape(Odd(ratio: bad, list: [1, bad]))
      #expect(shape["ratio"]?.doubleValue.map { $0.isNaN ? bad.isNaN : $0 == bad } == true, "\(bad)")
      #expect(shape["list"]?[1]?.doubleValue.map { $0.isNaN ? bad.isNaN : $0 == bad } == true, "\(bad)")
      #expect(outcome { .string(try RecordCid.computeRecordCid(Odd(ratio: bad, list: []))) }
        == ["$throws": "NaN and Infinity values not supported"])
    }
    #expect(try RecordCid.toJsonShape(Odd(ratio: 0.5, list: [])) == ["ratio": 0.5, "list": []])
  }

  @Test func datesKeepWholeMilliseconds() throws {
    for ms in [0.0, 1, 999, 1_773_576_000_123, -1, 8.64e15] {
      let date = Date(timeIntervalSince1970: ms / 1000)
      let shape = try RecordCid.toJsonShape(["at": date])
      #expect(shape["at"]?.stringValue == JSDate.toISOString(ms), "\(ms)")
    }
    // A fraction of a millisecond is cut toward zero, as `new Date(ms)`
    // cuts it: before 1970 that is up, not down.
    for (seconds, iso) in [
      (-0.0005, "1970-01-01T00:00:00.000Z"), (-0.0015, "1969-12-31T23:59:59.999Z"),
      (0.0015, "1970-01-01T00:00:00.001Z"), (1_773_576_000.1237, "2026-03-15T12:00:00.123Z"),
    ] {
      let shape = try RecordCid.toJsonShape(["at": Date(timeIntervalSince1970: seconds)])
      #expect(shape["at"]?.stringValue == iso, "\(seconds)")
    }
    // Past the range a JavaScript date holds: null, as JSON.stringify writes it.
    #expect(try RecordCid.toJsonShape(["at": Date(timeIntervalSince1970: 9e12)])["at"] == .null)
  }
}
