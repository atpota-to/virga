// A `data:` address, read as a browser reads it: the Fetch standard's data:
// URL processor (https://fetch.spec.whatwg.org/#data-url-processor), which
// Chromium's `<img>` and Node's `fetch` both follow.
//
// A picture can be written into its own address. The demo does it for the
// pictures its user posts (HarnessRepo.blobDataUrl), and a browser's `<img>`
// draws one without fetching anything. The app's transports fetch, and
// UIImage and AsyncImage take bytes or a URLSession load, so the views read
// such an address here and hand the bytes to UIImage.
//
// The address is read from its UTF-8 rather than through WebURL, whose
// opaque path grows a character at a time and would take far too long over
// megabytes of base64. For a data: address the two agree: the URL parser
// drops the C0 controls and spaces at either end and every tab and
// newline, ends the address at "#", and percent-encodes what it doesn't
// keep. The processor percent-decodes the body, which undoes that, but not
// the type, so the type is percent-encoded here as the parser writes it:
// a form feed after "base64" stays in the type as "%0C", and the body isn't
// read as base64, as in a browser. Not
// followed: the URL parser's host, path and dot-segment rules for an
// address that goes on with "/" after "data:".

import Foundation

public struct DataURL: Sendable, Hashable {
  /// The MIME type's essence, lower-cased ("image/png"), its parameters
  /// left off. "text/plain" when the address names none or one that
  /// doesn't parse, as the processor's text/plain;charset=US-ASCII.
  public let essence: String
  /// The bytes it holds.
  public let body: Data

  /// The address read, or nil when it isn't a data: address or the
  /// processor fails on it: no comma, or base64 that forgiving-base64
  /// refuses (a character outside the alphabet, a misplaced "=", a length
  /// one past a multiple of four).
  public init?(_ address: String) {
    guard let input = Self.afterScheme(Array(address.utf8)) else { return nil }
    // The fragment isn't part of what the URL serializer gives the processor.
    let serialized = input.firstIndex(of: 0x23).map { input[..<$0] } ?? input[...]
    guard let comma = serialized.firstIndex(of: 0x2C) else { return nil }
    var mimeType = Self.trimmed(Self.asWritten(serialized[..<comma]), Self.isASCIIWhitespace)
    var body = WebURLParser.percentDecode(Array(serialized[(comma + 1)...]))
    if let rest = Self.withoutBase64(mimeType) {
      guard let decoded = Self.forgivingBase64(body) else { return nil }
      body = decoded
      mimeType = rest
    }
    if mimeType.first == 0x3B { mimeType = Array("text/plain".utf8) + mimeType }
    essence = Self.essence(mimeType) ?? "text/plain"
    self.body = Data(body)
  }

  /// Whether `address` is a data: address: its scheme, in any case, once
  /// the controls and spaces before it and any tab or newline are dropped.
  /// Looks no further than the scheme.
  public static func isDataURL(_ address: String) -> Bool {
    var scheme: [UInt8] = []
    for byte in address.utf8 {
      if scheme.isEmpty, byte <= 0x20 { continue }
      if byte == 0x09 || byte == 0x0A || byte == 0x0D { continue }
      scheme.append(lower(byte))
      if scheme.count == 5 { break }
    }
    return scheme == Array("data:".utf8)
  }

  /// What an `<img>` hands its image decoders, or nil when it holds nothing
  /// or SVG: a browser draws an SVG type as a document (the demo's own
  /// forms are DemoPicture's), and no other bytes under it. Any other type,
  /// or none, is drawn by what the bytes are, so a PNG under text/plain is
  /// still a picture.
  public var picture: Data? {
    body.isEmpty || essence == "image/svg+xml" ? nil : body
  }

  // MARK: Reading

  /// The address after "data:", once the URL parser's trimming is done,
  /// or nil for another scheme.
  static func afterScheme(_ bytes: [UInt8]) -> [UInt8]? {
    var start = 0
    var end = bytes.count
    while start < end, bytes[start] <= 0x20 { start += 1 }
    while end > start, bytes[end - 1] <= 0x20 { end -= 1 }
    let input = bytes[start..<end].filter { $0 != 0x09 && $0 != 0x0A && $0 != 0x0D }
    guard input.count >= 5, input[..<5].map(lower) == Array("data:".utf8) else { return nil }
    return Array(input[5...])
  }

  /// The type as the URL parser writes it, which the processor reads
  /// without decoding: a control or a byte past "~" percent-encoded, and in
  /// a query (after "?") a space, a double quote and angle brackets too.
  static func asWritten(_ type: ArraySlice<UInt8>) -> [UInt8] {
    let hex = Array("0123456789ABCDEF".utf8)
    var out: [UInt8] = []
    out.reserveCapacity(type.count)
    var inQuery = false
    for byte in type {
      let encoded = byte < 0x20 || byte > 0x7E
        || inQuery && (byte == 0x20 || byte == 0x22 || byte == 0x3C || byte == 0x3E)
      if encoded {
        out += [0x25, hex[Int(byte >> 4)], hex[Int(byte & 0x0F)]]
      } else {
        out.append(byte)
      }
      if byte == 0x3F { inQuery = true }
    }
    return out
  }

  /// The type without its ";base64" (any spaces before "base64", any
  /// case), or nil when it doesn't end with one.
  static func withoutBase64(_ mimeType: [UInt8]) -> [UInt8]? {
    guard mimeType.count >= 7, mimeType.suffix(6).map(lower) == Array("base64".utf8) else { return nil }
    var end = mimeType.count - 6
    while end > 0, mimeType[end - 1] == 0x20 { end -= 1 }
    guard end > 0, mimeType[end - 1] == 0x3B else { return nil }
    return Array(mimeType[..<(end - 1)])
  }

  /// Forgiving-base64 decode (WHATWG Infra): ASCII whitespace skipped,
  /// one or two "=" taken off a length that is a multiple of four, and
  /// nothing else outside the alphabet. The body's bytes are its code
  /// points (an isomorphic decode), so a byte past 0x7F is refused too.
  static func forgivingBase64(_ input: [UInt8]) -> [UInt8]? {
    var data = input.filter { !isASCIIWhitespace($0) }
    if data.count % 4 == 0, data.last == 0x3D {
      data.removeLast()
      if data.last == 0x3D { data.removeLast() }
    }
    if data.count % 4 == 1 { return nil }
    var out: [UInt8] = []
    out.reserveCapacity(data.count / 4 * 3 + 2)
    var buffer: UInt32 = 0
    var bits = 0
    for byte in data {
      guard let value = base64Value(byte) else { return nil }
      buffer = buffer << 6 | value
      bits += 6
      if bits == 24 {
        out += [UInt8(buffer >> 16 & 0xFF), UInt8(buffer >> 8 & 0xFF), UInt8(buffer & 0xFF)]
        buffer = 0
        bits = 0
      }
    }
    if bits == 12 {
      out.append(UInt8(buffer >> 4 & 0xFF))
    } else if bits == 18 {
      out += [UInt8(buffer >> 10 & 0xFF), UInt8(buffer >> 2 & 0xFF)]
    }
    return out
  }

  /// A MIME type's essence as the MIME Sniffing standard parses it (its
  /// type and subtype, HTTP token code points only), or nil where the
  /// parse fails. Parameters can't fail it, so they aren't read.
  static func essence(_ mimeType: [UInt8]) -> String? {
    let text = trimmed(mimeType, isHTTPWhitespace)
    guard let slash = text.firstIndex(of: 0x2F) else { return nil }
    let type = text[..<slash]
    var subtype = text[(slash + 1)...].prefix { $0 != 0x3B }
    while let last = subtype.last, isHTTPWhitespace(last) { subtype = subtype.dropLast() }
    guard !type.isEmpty, type.allSatisfy(isToken), !subtype.isEmpty, subtype.allSatisfy(isToken) else { return nil }
    return String(decoding: (Array(type) + [0x2F] + Array(subtype)).map(lower), as: UTF8.self)
  }

  // MARK: Characters

  static func lower(_ byte: UInt8) -> UInt8 {
    (0x41...0x5A).contains(byte) ? byte + 0x20 : byte
  }

  /// Tab, line feed, form feed, carriage return and space.
  static func isASCIIWhitespace(_ byte: UInt8) -> Bool {
    byte == 0x09 || byte == 0x0A || byte == 0x0C || byte == 0x0D || byte == 0x20
  }

  /// Tab, line feed, carriage return and space (no form feed).
  static func isHTTPWhitespace(_ byte: UInt8) -> Bool {
    byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x20
  }

  static let tokenMarks = Set("!#$%&'*+-.^_`|~".utf8)

  static func isToken(_ byte: UInt8) -> Bool {
    (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
      || tokenMarks.contains(byte)
  }

  static func trimmed(_ bytes: [UInt8], _ drop: (UInt8) -> Bool) -> [UInt8] {
    guard let first = bytes.firstIndex(where: { !drop($0) }), let last = bytes.lastIndex(where: { !drop($0) }) else {
      return []
    }
    return Array(bytes[first...last])
  }

  static func base64Value(_ byte: UInt8) -> UInt32? {
    switch byte {
    case 0x41...0x5A: return UInt32(byte - 0x41)
    case 0x61...0x7A: return UInt32(byte - 0x61 + 26)
    case 0x30...0x39: return UInt32(byte - 0x30 + 52)
    case 0x2B: return 62
    case 0x2F: return 63
    default: return nil
    }
  }
}
