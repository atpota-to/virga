// The WHATWG URL Standard's parser and serializer: what `new URL(input, base)`
// computes in a browser or in Node. The posting code reads hosts, paths and
// queries through it (link shortening, inline links, compose intents, safe
// external URLs), and Foundation's URL follows RFC 3986 instead, so it
// percent-encodes, normalizes and refuses differently.
//
// Held to Node's URL (Ada) by ios/parity/cases/posting-text.url.js:
// - path segments are encoded with the path set that leaves `^` and `|`
//   alone, and an opaque path keeps its spaces, as Node 22 does;
// - hosts go through UTS #46 as Node's parser (Ada) applies it, over Ada's
//   own per-character data (IDNA.swift, IDNATable.swift).
//
// State overrides (the setters) aren't ported; only parsing and the getters.
//
// Where Node 22's Ada leaves the URL Standard, this follows the Standard, as
// browsers do (the web app runs in one). A differential fuzz found two such
// places, both outside what the posting code acts on (it only uses http(s)
// URLs it parsed, and a base that is an origin):
// - a relative input holding a `#` against a base with an opaque path
//   (`new URL('x#y', 'mailto:a')`): Ada resolves it, the Standard fails it;
// - a non-special URL whose path ends in `..` right after its root
//   (`foo:/..`, `foo://h/.%2E`): Ada drops the root, the Standard keeps it
//   (`foo:/`, `foo://h/`).
// The URL fixtures leave both out; URLStandardBehaviour pins the Standard's
// answers.

import Foundation

public struct WHATWGURLError: Error, LocalizedError, Hashable, Sendable, CustomStringConvertible {
  /// Node's TypeError message.
  public let message: String
  public init(_ message: String = "Invalid URL") { self.message = message }
  public var errorDescription: String? { message }
  public var description: String { message }
}

public struct WHATWGURL: Hashable, Sendable, CustomStringConvertible {
  public enum Host: Hashable, Sendable {
    case domain(String)
    case ipv4(UInt32)
    case ipv6([UInt16])
    case opaque(String)
    case empty
  }

  public enum Path: Hashable, Sendable {
    case opaque(String)
    case segments([String])
  }

  public internal(set) var scheme = ""
  public internal(set) var username = ""
  public internal(set) var password = ""
  public internal(set) var parsedHost: Host?
  public internal(set) var port: Int?
  public internal(set) var parsedPath: Path = .segments([])
  public internal(set) var query: String?
  public internal(set) var fragment: String?

  static let specialSchemes: [String: Int?] = [
    "ftp": 21, "file": nil, "http": 80, "https": 443, "ws": 80, "wss": 443,
  ]

  public var isSpecial: Bool { Self.specialSchemes[scheme] != nil }

  /// `new URL(input, base)`. Throws "Invalid URL" where JavaScript does.
  public init(_ input: String, base: WHATWGURL? = nil) throws {
    var parser = Parser(input: input, base: base)
    guard let url = parser.run() else { throw WHATWGURLError() }
    self = url
  }

  /// `new URL(input, base)` with the base as a string, parsed first.
  public init(_ input: String, base: String) throws {
    let baseURL = try WHATWGURL(base)
    try self.init(input, base: baseURL)
  }

  /// `URL.parse(input, base)`: nil instead of a throw.
  public static func parse(_ input: String, base: WHATWGURL? = nil) -> WHATWGURL? {
    try? WHATWGURL(input, base: base)
  }

  init() {}

  // MARK: Getters (the URL API's)

  /// `url.href`.
  public var href: String {
    var output = scheme + ":"
    if let parsedHost {
      output += "//"
      if !username.isEmpty || !password.isEmpty {
        output += username
        if !password.isEmpty { output += ":" + password }
        output += "@"
      }
      output += Self.serialize(parsedHost)
      if let port { output += ":" + String(port) }
    }
    if parsedHost == nil, case .segments(let segments) = parsedPath, segments.count > 1, segments[0].isEmpty {
      output += "/."
    }
    output += pathname
    if let query { output += "?" + query }
    if let fragment { output += "#" + fragment }
    return output
  }

  public var description: String { href }

  /// `url.protocol`: the scheme and a colon.
  public var protocolString: String { scheme + ":" }

  /// `url.host`: the host and a non-default port.
  public var host: String {
    guard let parsedHost else { return "" }
    let name = Self.serialize(parsedHost)
    return port.map { name + ":" + String($0) } ?? name
  }

  /// `url.hostname`.
  public var hostname: String {
    parsedHost.map(Self.serialize) ?? ""
  }

  /// `url.port` as a string ("" for the scheme's default).
  public var portString: String { port.map(String.init) ?? "" }

  /// `url.pathname`.
  public var pathname: String {
    switch parsedPath {
    case .opaque(let path): return path
    case .segments(let segments): return segments.map { "/" + $0 }.joined()
    }
  }

  /// `url.search`: "" for no query or an empty one.
  public var search: String {
    guard let query, !query.isEmpty else { return "" }
    return "?" + query
  }

  /// `url.hash`: "" for no fragment or an empty one.
  public var hash: String {
    guard let fragment, !fragment.isEmpty else { return "" }
    return "#" + fragment
  }

  /// `url.searchParams`, read.
  public var searchParams: URLSearchParams {
    URLSearchParams(query ?? "")
  }

  /// Writing `url.searchParams`: the query becomes their serialization, or
  /// none when they are empty.
  public mutating func setSearchParams(_ params: URLSearchParams) {
    let serialized = params.description
    query = serialized.isEmpty ? nil : serialized
  }

  // MARK: Host serialization

  static func serialize(_ host: Host) -> String {
    switch host {
    case .domain(let name), .opaque(let name): return name
    case .empty: return ""
    case .ipv4(let address):
      return (0..<4).map { String((address >> (24 - 8 * UInt32($0))) & 0xFF) }.joined(separator: ".")
    case .ipv6(let pieces):
      return "[" + serializeIPv6(pieces) + "]"
    }
  }

  static func serializeIPv6(_ address: [UInt16]) -> String {
    // The first longest run of two or more zero pieces is compressed.
    var compress: Int?
    var bestLength = 1
    var index = 0
    while index < 8 {
      if address[index] == 0 {
        var end = index
        while end < 8, address[end] == 0 { end += 1 }
        if end - index > bestLength {
          bestLength = end - index
          compress = index
        }
        index = end
      } else {
        index += 1
      }
    }
    var output = ""
    var ignore0 = false
    for pieceIndex in 0..<8 {
      if ignore0, address[pieceIndex] == 0 { continue }
      ignore0 = false
      if compress == pieceIndex {
        output += pieceIndex == 0 ? "::" : ":"
        ignore0 = true
        continue
      }
      output += String(address[pieceIndex], radix: 16)
      if pieceIndex != 7 { output += ":" }
    }
    return output
  }
}

// MARK: - Percent-encoding

extension WHATWGURL {
  enum EncodeSet {
    case c0Control, fragment, query, specialQuery, path, userinfo, component, formURLEncoded

    func contains(_ value: UInt32) -> Bool {
      if value < 0x20 || value > 0x7E { return true }
      let c = Character(Unicode.Scalar(value)!)
      switch self {
      case .c0Control: return false
      case .fragment: return " \"<>`".contains(c)
      case .query: return " \"#<>".contains(c)
      case .specialQuery: return " \"#<>'".contains(c)
      case .path: return " \"#<>?`{}".contains(c)
      case .userinfo: return " \"#<>?`{}/:;=@[\\]^|".contains(c)
      case .component: return " \"#<>?`{}/:;=@[\\]^|$%&+,".contains(c)
      case .formURLEncoded: return " \"#<>?`{}/:;=@[\\]^|$%&+,!'()~".contains(c)
      }
    }
  }

  static let hexUpper = Array("0123456789ABCDEF".utf8)

  static func percentEncode(_ scalar: Unicode.Scalar, _ set: EncodeSet) -> String {
    guard set.contains(scalar.value) else { return String(scalar) }
    var out = ""
    for byte in String(scalar).utf8 {
      out.append("%")
      out.append(Character(Unicode.Scalar(hexUpper[Int(byte >> 4)])))
      out.append(Character(Unicode.Scalar(hexUpper[Int(byte & 0x0F)])))
    }
    return out
  }

  static func percentEncode(_ text: String, _ set: EncodeSet) -> String {
    var out = ""
    for scalar in text.unicodeScalars { out += percentEncode(scalar, set) }
    return out
  }

  /// Percent-decoding of a string's UTF-8 bytes: %XX becomes the byte, a `%`
  /// without two hex digits stays.
  static func percentDecode(_ bytes: [UInt8]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(bytes.count)
    var i = 0
    while i < bytes.count {
      if bytes[i] == 0x25, i + 2 < bytes.count,
        let high = hexValue(bytes[i + 1]), let low = hexValue(bytes[i + 2])
      {
        out.append(high << 4 | low)
        i += 3
      } else {
        out.append(bytes[i])
        i += 1
      }
    }
    return out
  }

  static func hexValue(_ byte: UInt8) -> UInt8? {
    switch byte {
    case 0x30...0x39: return byte - 0x30
    case 0x41...0x46: return byte - 0x41 + 10
    case 0x61...0x66: return byte - 0x61 + 10
    default: return nil
    }
  }
}

// MARK: - The basic URL parser

extension WHATWGURL {
  struct Parser {
    enum State {
      case schemeStart, scheme, noScheme, specialRelativeOrAuthority, pathOrAuthority, relative,
        relativeSlash, specialAuthoritySlashes, specialAuthorityIgnoreSlashes, authority, host,
        port, file, fileSlash, fileHost, pathStart, path, opaquePath, query, fragment
    }

    let input: [Unicode.Scalar]
    let base: WHATWGURL?
    var url = WHATWGURL()
    var state = State.schemeStart
    var buffer: [Unicode.Scalar] = []
    var atSignSeen = false
    var insideBrackets = false
    var passwordTokenSeen = false
    var pointer = 0

    init(input raw: String, base: WHATWGURL?) {
      var scalars = Array(raw.unicodeScalars)
      // Leading and trailing C0 control or space, then every tab and newline.
      while let first = scalars.first, first.value <= 0x20 { scalars.removeFirst() }
      while let last = scalars.last, last.value <= 0x20 { scalars.removeLast() }
      scalars.removeAll { $0 == "\t" || $0 == "\n" || $0 == "\r" }
      self.input = scalars
      self.base = base
    }

    var c: Unicode.Scalar? { pointer >= 0 && pointer < input.count ? input[pointer] : nil }

    func remaining(startsWith text: String) -> Bool {
      let want = Array(text.unicodeScalars)
      let start = pointer + 1
      guard start + want.count <= input.count else { return false }
      return Array(input[start..<(start + want.count)]) == want
    }

    static func isASCIIAlpha(_ s: Unicode.Scalar?) -> Bool {
      guard let s else { return false }
      return (0x41...0x5A).contains(s.value) || (0x61...0x7A).contains(s.value)
    }

    static func isASCIIDigit(_ s: Unicode.Scalar?) -> Bool {
      guard let s else { return false }
      return (0x30...0x39).contains(s.value)
    }

    static func lower(_ s: Unicode.Scalar) -> Unicode.Scalar {
      (0x41...0x5A).contains(s.value) ? Unicode.Scalar(s.value + 0x20)! : s
    }

    static func isWindowsDriveLetter(_ s: [Unicode.Scalar], normalized: Bool = false) -> Bool {
      s.count == 2 && isASCIIAlpha(s[0]) && (s[1] == ":" || (!normalized && s[1] == "|"))
    }

    /// Whether the input from `index` starts with a Windows drive letter.
    func startsWithWindowsDriveLetter(at index: Int) -> Bool {
      guard index + 2 <= input.count else { return false }
      guard Self.isWindowsDriveLetter(Array(input[index..<(index + 2)])) else { return false }
      if index + 2 == input.count { return true }
      return ["/", "\\", "?", "#"].contains(input[index + 2])
    }

    static func isSingleDot(_ s: String) -> Bool {
      s == "." || s.lowercased() == "%2e"
    }

    static func isDoubleDot(_ s: String) -> Bool {
      switch s.lowercased() {
      case "..", ".%2e", "%2e.", "%2e%2e": return true
      default: return false
      }
    }

    mutating func shortenPath() {
      guard case .segments(var segments) = url.parsedPath else { return }
      if url.scheme == "file", segments.count == 1,
        Self.isWindowsDriveLetter(Array(segments[0].unicodeScalars), normalized: true)
      {
        return
      }
      if !segments.isEmpty { segments.removeLast() }
      url.parsedPath = .segments(segments)
    }

    mutating func appendSegment(_ segment: String) {
      if case .segments(var segments) = url.parsedPath {
        segments.append(segment)
        url.parsedPath = .segments(segments)
      }
    }

    var pathSegments: [String] {
      if case .segments(let segments) = url.parsedPath { return segments }
      return []
    }

    var bufferString: String { String(String.UnicodeScalarView(buffer)) }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    mutating func run() -> WHATWGURL? {
      while true {
        let c = self.c
        switch state {
        case .schemeStart:
          if Self.isASCIIAlpha(c) {
            buffer.append(Self.lower(c!))
            state = .scheme
          } else {
            state = .noScheme
            pointer -= 1
          }

        case .scheme:
          if let c, Self.isASCIIAlpha(c) || Self.isASCIIDigit(c) || c == "+" || c == "-" || c == "." {
            buffer.append(Self.lower(c))
          } else if c == ":" {
            url.scheme = bufferString
            buffer = []
            if url.scheme == "file" {
              state = .file
            } else if url.isSpecial, let base, base.scheme == url.scheme {
              state = .specialRelativeOrAuthority
            } else if url.isSpecial {
              state = .specialAuthoritySlashes
            } else if remaining(startsWith: "/") {
              state = .pathOrAuthority
              pointer += 1
            } else {
              url.parsedPath = .opaque("")
              state = .opaquePath
            }
          } else {
            buffer = []
            state = .noScheme
            pointer = -1
          }

        case .noScheme:
          guard let base else { return nil }
          if case .opaque = base.parsedPath {
            guard c == "#" else { return nil }
            url.scheme = base.scheme
            url.parsedPath = base.parsedPath
            url.query = base.query
            url.fragment = ""
            state = .fragment
          } else if base.scheme != "file" {
            state = .relative
            pointer -= 1
          } else {
            state = .file
            pointer -= 1
          }

        case .specialRelativeOrAuthority:
          if c == "/", remaining(startsWith: "/") {
            state = .specialAuthorityIgnoreSlashes
            pointer += 1
          } else {
            state = .relative
            pointer -= 1
          }

        case .pathOrAuthority:
          if c == "/" {
            state = .authority
          } else {
            state = .path
            pointer -= 1
          }

        case .relative:
          let base = self.base!
          url.scheme = base.scheme
          if c == "/" {
            state = .relativeSlash
          } else if url.isSpecial, c == "\\" {
            state = .relativeSlash
          } else {
            url.username = base.username
            url.password = base.password
            url.parsedHost = base.parsedHost
            url.port = base.port
            url.parsedPath = base.parsedPath
            url.query = base.query
            if c == "?" {
              url.query = ""
              state = .query
            } else if c == "#" {
              url.fragment = ""
              state = .fragment
            } else if c != nil {
              url.query = nil
              shortenPath()
              state = .path
              pointer -= 1
            }
          }

        case .relativeSlash:
          if url.isSpecial, c == "/" || c == "\\" {
            state = .specialAuthorityIgnoreSlashes
          } else if c == "/" {
            state = .authority
          } else {
            let base = self.base!
            url.username = base.username
            url.password = base.password
            url.parsedHost = base.parsedHost
            url.port = base.port
            state = .path
            pointer -= 1
          }

        case .specialAuthoritySlashes:
          if c == "/", remaining(startsWith: "/") {
            state = .specialAuthorityIgnoreSlashes
            pointer += 1
          } else {
            state = .specialAuthorityIgnoreSlashes
            pointer -= 1
          }

        case .specialAuthorityIgnoreSlashes:
          if c != "/", c != "\\" {
            state = .authority
            pointer -= 1
          }

        case .authority:
          if c == "@" {
            if atSignSeen { buffer.insert(contentsOf: "%40".unicodeScalars, at: 0) }
            atSignSeen = true
            for codePoint in buffer {
              if codePoint == ":", !passwordTokenSeen {
                passwordTokenSeen = true
                continue
              }
              let encoded = WHATWGURL.percentEncode(codePoint, .userinfo)
              if passwordTokenSeen { url.password += encoded } else { url.username += encoded }
            }
            buffer = []
          } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
            if atSignSeen, buffer.isEmpty { return nil }
            pointer -= buffer.count + 1
            buffer = []
            state = .host
          } else {
            buffer.append(c!)
          }

        case .host:
          if c == ":", !insideBrackets {
            if buffer.isEmpty { return nil }
            guard let host = WHATWGURL.parseHost(bufferString, isOpaque: !url.isSpecial) else { return nil }
            url.parsedHost = host
            buffer = []
            state = .port
          } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
            pointer -= 1
            if url.isSpecial, buffer.isEmpty { return nil }
            guard let host = WHATWGURL.parseHost(bufferString, isOpaque: !url.isSpecial) else { return nil }
            url.parsedHost = host
            buffer = []
            state = .pathStart
          } else {
            if c == "[" { insideBrackets = true }
            if c == "]" { insideBrackets = false }
            buffer.append(c!)
          }

        case .port:
          if Self.isASCIIDigit(c) {
            buffer.append(c!)
          } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
            if !buffer.isEmpty {
              var value = 0
              for digit in buffer {
                value = value * 10 + Int(digit.value - 0x30)
                if value > 65535 { return nil }
              }
              let defaultPort = WHATWGURL.specialSchemes[url.scheme] ?? nil
              url.port = value == defaultPort ? nil : value
              buffer = []
            }
            state = .pathStart
            pointer -= 1
          } else {
            return nil
          }

        case .file:
          url.scheme = "file"
          url.parsedHost = .empty
          if c == "/" || c == "\\" {
            state = .fileSlash
          } else if let base, base.scheme == "file" {
            url.parsedHost = base.parsedHost
            url.parsedPath = base.parsedPath
            url.query = base.query
            if c == "?" {
              url.query = ""
              state = .query
            } else if c == "#" {
              url.fragment = ""
              state = .fragment
            } else if c != nil {
              url.query = nil
              if !startsWithWindowsDriveLetter(at: pointer) {
                shortenPath()
              } else {
                url.parsedPath = .segments([])
              }
              state = .path
              pointer -= 1
            }
          } else {
            state = .path
            pointer -= 1
          }

        case .fileSlash:
          if c == "/" || c == "\\" {
            state = .fileHost
          } else {
            if let base, base.scheme == "file" {
              url.parsedHost = base.parsedHost
              if !startsWithWindowsDriveLetter(at: pointer),
                case .segments(let baseSegments) = base.parsedPath,
                let first = baseSegments.first,
                Self.isWindowsDriveLetter(Array(first.unicodeScalars), normalized: true)
              {
                appendSegment(first)
              }
            }
            state = .path
            pointer -= 1
          }

        case .fileHost:
          if c == nil || c == "/" || c == "\\" || c == "?" || c == "#" {
            pointer -= 1
            if Self.isWindowsDriveLetter(buffer) {
              state = .path
            } else if buffer.isEmpty {
              url.parsedHost = .empty
              state = .pathStart
            } else {
              guard var host = WHATWGURL.parseHost(bufferString, isOpaque: false) else { return nil }
              if host == .domain("localhost") { host = .empty }
              url.parsedHost = host
              buffer = []
              state = .pathStart
            }
          } else {
            buffer.append(c!)
          }

        case .pathStart:
          if url.isSpecial {
            state = .path
            if c != "/", c != "\\" { pointer -= 1 }
          } else if c == "?" {
            url.query = ""
            state = .query
          } else if c == "#" {
            url.fragment = ""
            state = .fragment
          } else if c != nil {
            state = .path
            if c != "/" { pointer -= 1 }
          }

        case .path:
          let slash = c == "/" || (url.isSpecial && c == "\\")
          if c == nil || slash || c == "?" || c == "#" {
            let segment = bufferString
            if Self.isDoubleDot(segment) {
              shortenPath()
              if !slash { appendSegment("") }
            } else if Self.isSingleDot(segment), !slash {
              appendSegment("")
            } else if !Self.isSingleDot(segment) {
              var segment = segment
              if url.scheme == "file", pathSegments.isEmpty, Self.isWindowsDriveLetter(buffer) {
                segment = String(Character(buffer[0])) + ":"
              }
              appendSegment(segment)
            }
            buffer = []
            if c == "?" {
              url.query = ""
              state = .query
            }
            if c == "#" {
              url.fragment = ""
              state = .fragment
            }
          } else {
            buffer.append(contentsOf: WHATWGURL.percentEncode(c!, .path).unicodeScalars)
          }

        case .opaquePath:
          if c == "?" {
            url.query = ""
            state = .query
          } else if c == "#" {
            url.fragment = ""
            state = .fragment
          } else if let c {
            if case .opaque(let path) = url.parsedPath {
              url.parsedPath = .opaque(path + WHATWGURL.percentEncode(c, .c0Control))
            }
          }

        case .query:
          if c == "#" || c == nil {
            let set: EncodeSet = url.isSpecial ? .specialQuery : .query
            url.query = (url.query ?? "") + WHATWGURL.percentEncode(bufferString, set)
            buffer = []
            if c == "#" {
              url.fragment = ""
              state = .fragment
            }
          } else {
            buffer.append(c!)
          }

        case .fragment:
          if let c {
            url.fragment = (url.fragment ?? "") + WHATWGURL.percentEncode(c, .fragment)
          }
        }

        if pointer >= input.count { break }
        pointer += 1
      }
      return url
    }
  }
}

// MARK: - Hosts

extension WHATWGURL {
  static let forbiddenHostCodePoints: Set<UInt32> = [
    0x00, 0x09, 0x0A, 0x0D, 0x20, 0x23, 0x2F, 0x3A, 0x3C, 0x3E, 0x3F, 0x40, 0x5B, 0x5C, 0x5D, 0x5E, 0x7C,
  ]

  static func isForbiddenDomainCodePoint(_ value: UInt32) -> Bool {
    forbiddenHostCodePoints.contains(value) || value <= 0x1F || value == 0x25 || value == 0x7F
  }

  /// The host parser.
  static func parseHost(_ input: String, isOpaque: Bool) -> Host? {
    let scalars = Array(input.unicodeScalars)
    if scalars.first == "[" {
      guard scalars.last == "]", scalars.count >= 2 else { return nil }
      return parseIPv6(Array(scalars[1..<(scalars.count - 1)])).map(Host.ipv6)
    }
    if isOpaque {
      if scalars.contains(where: { forbiddenHostCodePoints.contains($0.value) }) { return nil }
      return .opaque(percentEncode(input, .c0Control))
    }
    let domain = String(decoding: percentDecode(Array(input.utf8)), as: UTF8.self)
    guard let ascii = IDNA.domainToASCII(domain) else { return nil }
    if endsInANumber(ascii) {
      return parseIPv4(ascii).map(Host.ipv4)
    }
    return .domain(ascii)
  }

  static func endsInANumber(_ input: String) -> Bool {
    var parts = input.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    if parts.last == "" {
      if parts.count == 1 { return false }
      parts.removeLast()
    }
    let last = parts.last ?? ""
    if !last.isEmpty, last.unicodeScalars.allSatisfy({ (0x30...0x39).contains($0.value) }) { return true }
    return parseIPv4Number(last) != nil
  }

  /// An IPv4 number, saturated (any value past 2^32 fails the parser anyway).
  static func parseIPv4Number(_ raw: String) -> UInt64? {
    var input = Substring(raw)
    if input.isEmpty { return nil }
    var radix: UInt64 = 10
    if input.count >= 2, input.hasPrefix("0x") || input.hasPrefix("0X") {
      input = input.dropFirst(2)
      radix = 16
    } else if input.count >= 2, input.hasPrefix("0") {
      input = input.dropFirst()
      radix = 8
    }
    if input.isEmpty { return 0 }
    var value: UInt64 = 0
    for ch in input.unicodeScalars {
      let digit: UInt64
      switch ch.value {
      case 0x30...0x39: digit = UInt64(ch.value - 0x30)
      case 0x41...0x46 where radix == 16: digit = UInt64(ch.value - 0x41 + 10)
      case 0x61...0x66 where radix == 16: digit = UInt64(ch.value - 0x61 + 10)
      default: return nil
      }
      guard digit < radix else { return nil }
      value = value > (1 << 40) ? value : value * radix + digit
    }
    return value
  }

  static func parseIPv4(_ input: String) -> UInt32? {
    var parts = input.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
    if parts.last == "", parts.count > 1 { parts.removeLast() }
    guard parts.count <= 4 else { return nil }
    var numbers: [UInt64] = []
    for part in parts {
      guard let n = parseIPv4Number(part) else { return nil }
      numbers.append(n)
    }
    for n in numbers.dropLast() where n > 255 { return nil }
    let last = numbers.last!
    let limit = UInt64(1) << (8 * UInt64(5 - numbers.count))
    if last >= limit { return nil }
    var ipv4 = last
    for (i, n) in numbers.dropLast().enumerated() {
      ipv4 += n << (8 * UInt64(3 - i))
    }
    return UInt32(ipv4)
  }

  static func parseIPv6(_ input: [Unicode.Scalar]) -> [UInt16]? {
    var address = [UInt16](repeating: 0, count: 8)
    var pieceIndex = 0
    var compress: Int?
    var pointer = 0
    func c(_ p: Int) -> Unicode.Scalar? { p < input.count ? input[p] : nil }
    func hex(_ s: Unicode.Scalar?) -> UInt32? {
      guard let s else { return nil }
      return s.properties.isASCIIHexDigit ? UInt32(Character(s).hexDigitValue!) : nil
    }
    if c(pointer) == ":" {
      guard c(pointer + 1) == ":" else { return nil }
      pointer += 2
      pieceIndex += 1
      compress = pieceIndex
    }
    while c(pointer) != nil {
      if pieceIndex == 8 { return nil }
      if c(pointer) == ":" {
        if compress != nil { return nil }
        pointer += 1
        pieceIndex += 1
        compress = pieceIndex
        continue
      }
      var value: UInt32 = 0
      var length = 0
      while length < 4, let digit = hex(c(pointer)) {
        value = value * 0x10 + digit
        pointer += 1
        length += 1
      }
      if c(pointer) == "." {
        if length == 0 { return nil }
        pointer -= length
        if pieceIndex > 6 { return nil }
        var numbersSeen = 0
        while c(pointer) != nil {
          var ipv4Piece: UInt32?
          if numbersSeen > 0 {
            if c(pointer) == ".", numbersSeen < 4 { pointer += 1 } else { return nil }
          }
          guard let first = c(pointer), (0x30...0x39).contains(first.value) else { return nil }
          while let d = c(pointer), (0x30...0x39).contains(d.value) {
            let number = d.value - 0x30
            if ipv4Piece == nil {
              ipv4Piece = number
            } else if ipv4Piece == 0 {
              return nil
            } else {
              ipv4Piece = ipv4Piece! * 10 + number
            }
            if ipv4Piece! > 255 { return nil }
            pointer += 1
          }
          address[pieceIndex] = UInt16(truncatingIfNeeded: UInt32(address[pieceIndex]) * 0x100 + ipv4Piece!)
          numbersSeen += 1
          if numbersSeen == 2 || numbersSeen == 4 { pieceIndex += 1 }
        }
        if numbersSeen != 4 { return nil }
        break
      } else if c(pointer) == ":" {
        pointer += 1
        if c(pointer) == nil { return nil }
      } else if c(pointer) != nil {
        return nil
      }
      address[pieceIndex] = UInt16(value)
      pieceIndex += 1
    }
    if let compress {
      var swaps = pieceIndex - compress
      pieceIndex = 7
      while pieceIndex != 0, swaps > 0 {
        address.swapAt(pieceIndex, compress + swaps - 1)
        pieceIndex -= 1
        swaps -= 1
      }
    } else if pieceIndex != 8 {
      return nil
    }
    return address
  }
}
