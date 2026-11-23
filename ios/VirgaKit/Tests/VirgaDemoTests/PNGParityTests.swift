// Parity with harness/png.js, against ios/parity/fixtures/demo-world.png.json:
// PNGs byte for byte from the same pixel functions, and link-card images.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct PNGParity {
  static let fixture = "demo-world.png"

  /// demo-world.png.js's PIXELS (a channel JavaScript leaves undefined is NaN).
  static func pixel(_ name: String) -> (Int, Int) -> (Double, Double, Double) {
    switch name {
    case "gradient": return { x, y in (Double(x * 40), Double(y * 60), Double((x + y) * 7)) }
    case "wrapping": return { x, y in (Double(x * 100 - 50), Double(300 + y), Double(y) - 1.5) }
    case "odd": return { _, _ in (.nan, .infinity, -0.4) }
    case "short": return { x, _ in (Double(x + 1), .nan, .nan) }
    default: return { _, _ in (12, 34, 56) }
    }
  }

  static func shown(_ bytes: [UInt8], whole: Bool) -> JSONValue {
    var out: [String: JSONValue] = [
      "length": .number(Double(bytes.count)), "sha256": .string(CanonicalJSON.sha256(bytes: bytes)),
    ]
    if whole { out["base64"] = .string(Data(bytes).base64EncodedString()) }
    return .object(out)
  }

  @Test func encodePng() throws {
    for c in try Parity.cases(Self.fixture, fn: "encodePng") {
      let width = c["width"].intValue ?? 0
      let height = c["height"].intValue ?? 0
      let png = PNG.encodePng(width, height, Self.pixel(c["pixel"].stringValue ?? ""))
      let d = Exact.diff(Self.shown(png, whole: width * height < 100), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func cardImage() throws {
    for c in try Parity.cases(Self.fixture, fn: "cardImage") {
      let png = PNG.cardImage(c["seed"].doubleValue ?? 0, width: c["width"].intValue ?? 0, height: c["height"].intValue ?? 0)
      let d = Exact.diff(Self.shown(png, whole: true), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
    for c in try Parity.cases(Self.fixture, fn: "cardImage-full") {
      let png = PNG.cardImage(c["seed"].doubleValue ?? 0)
      let d = Exact.diff(Self.shown(png, whole: false), c.output)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func isAPNGAReaderTakes() {
    let png = PNG.cardImage(42, width: 30, height: 20)
    #expect(Array(png.prefix(8)) == [137, 80, 78, 71, 13, 10, 26, 10])
    // IHDR: width and height big-endian, 8-bit RGB.
    #expect(Array(png[16..<24]) == [0, 0, 0, 30, 0, 0, 0, 20])
    #expect(Array(png[24..<29]) == [8, 2, 0, 0, 0])
    #expect(Array(png.suffix(12)) == [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
  }
}
