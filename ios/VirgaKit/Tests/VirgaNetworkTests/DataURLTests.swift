// DataURL against what a browser does with the same addresses. Which ones
// Chromium draws in an `<img>` was read off Playwright's Chromium (onload
// with a natural size, or onerror); the bytes and types are what Node's
// `fetch` gives for them, which runs the same data: URL processor.

import Foundation
import Testing
import VirgaNetwork

@Suite struct DataURLTests {
  /// A 3 by 2 PNG, and its base64 (no "=", no "+" or "/").
  static let png = Data(
    base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGM8oaHBwMDAwMDAxAADABSMARygK5uhAAAAAElFTkSuQmCC")!
  static let b64 = png.base64EncodedString()
  /// A 5 by 3 PNG of 77 bytes, so its base64 ends in one "=".
  static let odd = Data(
    base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAFElEQVR4nGMU6TnBgASYGFABOh8AQLwBbvyS38cAAAAASUVORK5CYII=")!
  static let oddB64 = odd.base64EncodedString()

  static func percentEncoded(_ data: Data) -> String {
    data.map { "%" + ($0 < 16 ? "0" : "") + String($0, radix: 16, uppercase: true) }.joined()
  }

  static func spaced(_ text: String, _ gap: String) -> String {
    var out = ""
    for (i, c) in text.enumerated() {
      if i > 0, i % 4 == 0 { out += gap }
      out.append(c)
    }
    return out
  }

  /// Every address here Chromium drew as the PNG.
  @Test func readsAPictureAsABrowserDrawsIt() {
    let b64 = Self.b64
    let drawn = [
      "data:image/png;base64,\(b64)",
      // Any type but SVG, or none, is drawn by what the bytes are.
      "data:text/plain;base64,\(b64)",
      "data:text/html;base64,\(b64)",
      "data:;base64,\(b64)",
      "data:undefined;base64,\(b64)",
      "data:image/jpeg;base64,\(b64)",
      "data:/image/png;base64,\(b64)",
      "data://image/png;base64,\(b64)",
      // Percent-encoded rather than base64.
      "data:image/png,\(Self.percentEncoded(Self.png))",
      "data:,\(Self.percentEncoded(Self.png))",
      // Whitespace in the base64, raw, percent-encoded, or dropped by the URL parser.
      "data:image/png;base64,\(Self.spaced(b64, " "))",
      "data:image/png;base64,\(Self.spaced(b64, "%20"))",
      "data:image/png;base64,\(Self.spaced(b64, "\n"))",
      "data:image/png;base64,\(Self.spaced(b64, "\t"))",
      "data:image/png;base64,\(Self.spaced(b64, "\u{0C}"))",
      // The fragment isn't read; the case of the scheme and of "base64" isn't either.
      "data:image/png;base64,\(b64)#part",
      "DATA:IMAGE/PNG;BASE64,\(b64)",
      "data:image/png;BASE64,\(b64)",
      // Spaces about the type and before "base64", and parameters before it.
      "data:image/png; base64,\(b64)",
      "data:image/png ; base64,\(b64)",
      "data:image/png;base64 ,\(b64)",
      "data: image/png;base64,\(b64)",
      "data:image/png;charset=utf-8;base64,\(b64)",
      // What a URL parser trims off the ends.
      "  data:image/png;base64,\(b64)  ",
      "\u{01}data:image/png;base64,\(b64)",
    ]
    for address in drawn {
      #expect(DataURL.isDataURL(address), "\(address.prefix(40))")
      #expect(DataURL(address)?.picture == Self.png, "\(address.prefix(40))")
    }
  }

  @Test func base64IsForgivingAsTheStandardSaysAndNoMore() {
    let b64 = Self.oddB64
    let unpadded = String(b64.dropLast())
    for address in [
      "data:image/png;base64,\(unpadded)",
      "data:image/png;base64,\(b64)",
      "data:image/png;base64,\(b64) ",
      "data:image/png;base64,\(unpadded)%3D",
    ] {
      #expect(DataURL(address)?.picture == Self.odd, "\(address.suffix(8))")
    }
    // Chromium drew none of these, and Node's fetch refuses each.
    let png = Self.b64
    for address in [
      "data:image/png;base64,\(b64)=",
      "data:image/png;base64,\(png)==",
      "data:image/png;base64,\(png)A",
      "data:image/png;base64,\(png.prefix(8))!\(png.dropFirst(8))",
      "data:image/png;base64,\(png.prefix(8))==\(png.dropFirst(8))",
      "data:image/png;base64,QQ=",
      "data:image/png;base64,Q\u{0C}U\u{0B}JD",
      // The URL-safe alphabet isn't base64's.
      "data:image/jpeg;base64,--__ABCD",
      // A query is part of the body, and "?" isn't base64.
      "data:image/png;base64,\(png)?x=1",
    ] {
      #expect(DataURL(address) == nil, "\(address.suffix(12))")
    }
    #expect(DataURL("data:image/png;base64,++//ABCD")?.body == Data([0xFB, 0xEF, 0xFF, 0x00, 0x10, 0x83]))
    #expect(DataURL("data:image/png;base64,%2B%2B%2F%2FABCD")?.body == Data([0xFB, 0xEF, 0xFF, 0x00, 0x10, 0x83]))
    #expect(DataURL("data:image/png;base64,QQ")?.body == Data([0x41]))
    // Bits left over at the end are dropped, set or not.
    #expect(DataURL("data:image/png;base64,QR==")?.body == Data([0x41]))
  }

  @Test func readsTheTypeAsAMIMEParserDoes() {
    let cases: [(String, String)] = [
      ("data:image/png;base64,QUJD", "image/png"),
      ("data:IMAGE/SVG+XML;base64,PHN2Zy8+", "image/svg+xml"),
      ("data:image/png;charset=utf-8;base64,QUJD", "image/png"),
      ("data:text/html,x", "text/html"),
      ("data:,x", "text/plain"),
      ("data:;base64,QUJD", "text/plain"),
      ("data: ;base64,QUJD", "text/plain"),
      ("data:x;base64,QUJD", "text/plain"),
      ("data:a/b c;base64,QUJD", "text/plain"),
      ("data:undefined;base64,QUJD", "text/plain"),
      ("data:/image/png;base64,QUJD", "text/plain"),
      // ";x=y" after "base64" makes it a parameter: the body stays as written.
      ("data:image/png;base64;x=y,QUJD", "image/png"),
    ]
    for (address, essence) in cases {
      #expect(DataURL(address)?.essence == essence, "\(address)")
    }
    #expect(DataURL("data:image/png;base64;x=y,QUJD")?.body == Data("QUJD".utf8))
  }

  /// The URL parser percent-encodes a control or a byte past "~" in the
  /// type, and in a query a space too, and the processor reads the type as
  /// it's written. Chromium drew the PNG for the first five and not for the
  /// rest, where the base64 stays text; the types are Node's.
  @Test func readsTheTypeAsTheURLParserWritesIt() {
    let b64 = Self.b64
    let drawn: [(String, String)] = [
      ("data:\u{0C}image/png;base64,\(b64)", "%0cimage/png"),
      ("data:image/png\u{01};base64,\(b64)", "image/png%01"),
      ("data:image/png\u{7F};base64,\(b64)", "image/png%7f"),
      ("data:imag\u{E9}/png;base64,\(b64)", "imag%c3%a9/png"),
      ("data:image/png?x;base64,\(b64)", "text/plain"),
      ("data:image/png?\"x\";base64,\(b64)", "text/plain"),
    ]
    for (address, essence) in drawn {
      let read = DataURL(address)
      #expect(read?.essence == essence, "\(address.prefix(24))")
      #expect(read?.picture == Self.png, "\(address.prefix(24))")
    }
    let text: [(String, String)] = [
      ("data:image/png;base64\u{0C},\(b64)", "image/png"),
      ("data:image/png;base64\u{0B},\(b64)", "image/png"),
      ("data:image/png;\u{A0}base64,\(b64)", "image/png"),
      ("data:image/png?x; base64,\(b64)", "text/plain"),
    ]
    for (address, essence) in text {
      let read = DataURL(address)
      #expect(read?.essence == essence, "\(address.prefix(24))")
      #expect(read?.body == Data(b64.utf8), "\(address.prefix(24))")
    }
    #expect(DataURL("data:image/svg+xml\u{0C},%3Csvg%2F%3E")?.essence == "image/svg+xml%0c")
  }

  @Test func percentDecodesTheBodyAsUTF8() {
    // A browser percent-encodes what the address holds beyond ASCII as
    // UTF-8 and decodes it back to those bytes: a PNG written as Latin-1
    // characters isn't the PNG any more (Chromium draws nothing).
    #expect(DataURL("data:,é")?.body == Data([0xC3, 0xA9]))
    #expect(DataURL("data:text/plain,a%zzb%4")?.body == Data("a%zzb%4".utf8))
    let latin1 = String(decoding: Self.png.map { UInt16($0) }, as: UTF16.self)
    let read = DataURL("data:image/png,\(latin1)")
    #expect(read != nil)
    #expect(read?.body != Self.png)
    #expect(read?.body.count == 93)
  }

  @Test func holdsNoPictureWhereABrowserDrawsNone() {
    // SVG is drawn as a document, not by its bytes: PNG bytes under it
    // aren't drawn, and real SVG is DemoPicture's or nobody's.
    let svg = DataURL("data:image/svg+xml;base64,\(Self.b64)")
    #expect(svg?.essence == "image/svg+xml")
    #expect(svg?.body == Self.png)
    #expect(svg?.picture == nil)
    #expect(DataURL("data:image/svg+xml,%3Csvg%2F%3E")?.picture == nil)
    #expect(DataURL("data:,")?.picture == nil)
    #expect(DataURL("data:image/png;base64,")?.picture == nil)
    // No comma: nothing to read.
    #expect(DataURL("data:image/png;base64\(Self.b64)") == nil)
    #expect(DataURL("data:") == nil)
  }

  @Test func knowsADataAddressByItsScheme() {
    for address in ["data:", "DATA:x", "Data:image/png,x", "  data:,x", "\u{01}data:,x", "da\tta\n:,x", "d\ra\nt\ta:"] {
      #expect(DataURL.isDataURL(address), "\(address)")
    }
    for address in [
      "", "data", "dat:a", "data :,x", "xdata:,x", "data+x:,x", "https://cdn.bsky.app/img/avatar/plain/did/x@jpeg",
      "file:///tmp/x.png", "blob:https://a.example/1",
    ] {
      #expect(!DataURL.isDataURL(address), "\(address)")
      #expect(DataURL(address) == nil, "\(address)")
    }
  }

  /// The demo's address for an uploaded picture (HarnessRepo.blobDataUrl:
  /// the blob's type and Foundation's base64), every byte value and every
  /// length a padding can come from.
  @Test func readsBackWhatAStandardEncoderWrote() {
    for count in [0, 1, 2, 3, 4, 255, 256, 257, 258] {
      let bytes = Data((0..<count).map { UInt8(($0 * 7 + count) & 0xFF) })
      let read = DataURL("data:image/jpeg;base64,\(bytes.base64EncodedString())")
      #expect(read?.essence == "image/jpeg")
      #expect(read?.body == bytes, "\(count)")
    }
    let read = DataURL("data:undefined;base64,\(Self.b64)")
    #expect(read?.essence == "text/plain")
    #expect(read?.picture == Self.png)
  }

  /// The demo's cap is 2,000,000 bytes, so its address is about 2.7 million
  /// characters long.
  @Test func readsTheLargestAddressTheDemoWrites() {
    let bytes = Data((0..<2_000_000).map { UInt8(truncatingIfNeeded: ($0 &* 2_654_435_761) >> 13) })
    let address = "data:image/jpeg;base64,\(bytes.base64EncodedString())"
    #expect(DataURL.isDataURL(address))
    #expect(DataURL(address)?.picture == bytes)
  }
}
