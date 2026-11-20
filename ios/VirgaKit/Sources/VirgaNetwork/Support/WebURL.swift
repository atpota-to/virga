// `new URL(input, base)`: the URL Standard's basic URL parser
// (https://url.spec.whatwg.org/#concept-basic-url-parser), as Node and
// browsers run it, for the web code that builds or checks addresses with
// `new URL` (Virga's server's address, the sign-in's return address, a PDS
// endpoint read off a DID document). Foundation's URL follows RFC 3986 and
// reads the same strings differently (it refuses a space or a non-ASCII
// host, keeps `..` segments and a default port, doesn't lower-case a host),
// so it can't stand in.
//
// ios/parity/cases/network.url.js holds this to Node's own URL over a few
// hundred adversarial inputs. What isn't exact: a non-ASCII host goes
// through an approximation of UTS #46 (NFKC, lower-casing, the ignored
// code points, the joiner rule, Punycode) rather than its full table, and
// the Bidi rule isn't checked. The percent-encode sets are the ones Node 22
// uses (the path set has no `^`, and an opaque path keeps its spaces).

import Foundation
import VirgaCore

/// A URL Standard URL record.
public struct WebURL: Sendable, Hashable, CustomStringConvertible {
  public enum Host: Sendable, Hashable {
    case domain(String)
    case ipv4(UInt32)
    case ipv6([UInt16])
    case opaque(String)
    case empty

    /// The host serializer.
    public var serialized: String {
      switch self {
      case .domain(let text), .opaque(let text): return text
      case .empty: return ""
      case .ipv4(let address):
        return [24, 16, 8, 0].map { String((address >> UInt32($0)) & 0xFF) }.joined(separator: ".")
      case .ipv6(let pieces): return "[\(WebURLParser.serializeIPv6(pieces))]"
      }
    }
  }

  public enum Path: Sendable, Hashable {
    /// A URL whose path is opaque ("cannot be a base"): `mailto:x`, `data:…`.
    case opaque(String)
    case segments([String])
  }

  public internal(set) var scheme: String
  public internal(set) var username: String
  public internal(set) var password: String
  public internal(set) var host: Host?
  public internal(set) var port: Int?
  public internal(set) var path: Path
  public internal(set) var query: String?
  public internal(set) var fragment: String?

  init(scheme: String = "") {
    self.scheme = scheme
    username = ""
    password = ""
    host = nil
    port = nil
    path = .segments([])
    query = nil
    fragment = nil
  }

  /// `new URL(input)`, or `new URL(input, base)`. Throws `WebURLError`
  /// ("Invalid URL", a TypeError in JavaScript) where `new URL` throws.
  public init(_ input: String, base: WebURL? = nil) throws {
    guard let url = WebURLParser.parse(input, base: base) else { throw WebURLError(input: input) }
    self = url
  }

  /// `new URL(input, base)` with the base as text, which must parse too.
  public init(_ input: String, base: String) throws {
    let parsedBase = try WebURL(base)
    try self.init(input, base: parsedBase)
  }

  /// Whether `new URL(input)` succeeds (`URL.canParse`).
  public static func canParse(_ input: String, base: String? = nil) -> Bool {
    if let base { return (try? WebURL(input, base: base)) != nil }
    return (try? WebURL(input)) != nil
  }

  public var isSpecial: Bool { WebURLParser.specialPorts.keys.contains(scheme) }

  // MARK: Getters, as the URL object's

  /// `url.href`.
  public var href: String {
    var out = scheme + ":"
    if let host {
      out += "//"
      if !username.isEmpty || !password.isEmpty {
        out += username
        if !password.isEmpty { out += ":" + password }
        out += "@"
      }
      out += host.serialized
      if let port { out += ":\(port)" }
    } else if case .segments(let segments) = path, segments.count > 1, segments[0].isEmpty {
      out += "/."
    }
    out += pathname
    if let query { out += "?" + query }
    if let fragment { out += "#" + fragment }
    return out
  }

  public var description: String { href }

  /// `url.protocol`: the scheme and a colon.
  public var `protocol`: String { scheme + ":" }

  /// `url.host`: the host and, when there is one, the port.
  public var hostWithPort: String {
    guard let host else { return "" }
    guard let port else { return host.serialized }
    return "\(host.serialized):\(port)"
  }

  /// `url.hostname`.
  public var hostname: String { host?.serialized ?? "" }

  /// `url.port`: "" for none (or the scheme's default).
  public var portString: String { port.map(String.init) ?? "" }

  /// `url.pathname`.
  public var pathname: String {
    switch path {
    case .opaque(let text): return text
    case .segments(let segments): return segments.map { "/" + $0 }.joined()
    }
  }

  /// `url.search`: "" or "?" and the query.
  public var search: String {
    guard let query, !query.isEmpty else { return "" }
    return "?" + query
  }

  /// `url.hash`: "" or "#" and the fragment.
  public var hash: String {
    guard let fragment, !fragment.isEmpty else { return "" }
    return "#" + fragment
  }

  /// `url.origin`.
  public var origin: String {
    switch scheme {
    case "blob":
      if case .opaque(let inner) = path, let url = try? WebURL(inner), url.scheme == "http" || url.scheme == "https" {
        return url.origin
      }
      return "null"
    case "ftp", "http", "https", "ws", "wss":
      return "\(scheme)://\(hostWithPort)"
    default:
      return "null"
    }
  }

  // MARK: Setters and searchParams

  /// `url.search = value`.
  public mutating func setSearch(_ value: String) {
    if value.isEmpty {
      query = nil
      return
    }
    var input = value
    if input.unicodeScalars.first == "?" { input.unicodeScalars.removeFirst() }
    query = ""
    if let updated = WebURLParser.parse(input, base: nil, url: self, stateOverride: .query) {
      self = updated
    }
  }

  /// `[...url.searchParams]`: the query's name-value pairs.
  public var searchParams: [(String, String)] {
    JSURI.parseSearchParams(query ?? "")
  }

  /// `url.searchParams.set(name, value)`: the first pair named `name` takes
  /// the value and the others go, or the pair is appended; the query is
  /// then written again as URLSearchParams writes it.
  public mutating func setSearchParam(_ name: String, _ value: String) {
    var pairs = searchParams
    if let first = pairs.firstIndex(where: { $0.0 == name }) {
      pairs[first].1 = value
      pairs = pairs.enumerated().filter { $0.offset == first || $0.element.0 != name }.map(\.element)
    } else {
      pairs.append((name, value))
    }
    updateQuery(pairs)
  }

  /// `url.searchParams.append(name, value)`.
  public mutating func appendSearchParam(_ name: String, _ value: String) {
    var pairs = searchParams
    pairs.append((name, value))
    updateQuery(pairs)
  }

  private mutating func updateQuery(_ pairs: [(String, String)]) {
    let serialized = JSURI.searchParams(pairs)
    query = serialized.isEmpty ? nil : serialized
  }
}

/// What `new URL` throws for an input it can't parse.
public struct WebURLError: Error, Hashable, Sendable, LocalizedError {
  public var input: String
  public var errorDescription: String? { "Invalid URL" }
}

// MARK: - The parser

enum WebURLParser {
  static let specialPorts: [String: Int?] = ["ftp": 21, "file": nil, "http": 80, "https": 443, "ws": 80, "wss": 443]

  enum State {
    case schemeStart, scheme, noScheme, specialRelativeOrAuthority, pathOrAuthority, relative, relativeSlash
    case specialAuthoritySlashes, specialAuthorityIgnoreSlashes, authority, host, port
    case file, fileSlash, fileHost, pathStart, path, opaquePath, query, fragment
  }

  // MARK: Percent-encode sets (as Node 22 has them)

  static func inC0Control(_ c: UInt32) -> Bool { c <= 0x1F || c > 0x7E }
  static func inFragment(_ c: UInt32) -> Bool {
    inC0Control(c) || c == 0x20 || c == 0x22 || c == 0x3C || c == 0x3E || c == 0x60
  }
  static func inQuery(_ c: UInt32) -> Bool {
    inC0Control(c) || c == 0x20 || c == 0x22 || c == 0x23 || c == 0x3C || c == 0x3E
  }
  static func inSpecialQuery(_ c: UInt32) -> Bool { inQuery(c) || c == 0x27 }
  static func inPath(_ c: UInt32) -> Bool { inQuery(c) || c == 0x3F || c == 0x60 || c == 0x7B || c == 0x7D }
  static func inUserinfo(_ c: UInt32) -> Bool {
    inPath(c) || c == 0x2F || c == 0x3A || c == 0x3B || c == 0x3D || c == 0x40 || (0x5B...0x5E).contains(c) || c == 0x7C
  }

  static let hex: [Character] = Array("0123456789ABCDEF")

  static func percentEncode(_ scalar: Unicode.Scalar, _ inSet: (UInt32) -> Bool) -> String {
    guard inSet(scalar.value) else { return String(scalar) }
    var out = ""
    for byte in String(scalar).utf8 {
      out.append("%")
      out.append(hex[Int(byte >> 4)])
      out.append(hex[Int(byte & 0x0F)])
    }
    return out
  }

  static func isASCIIAlpha(_ c: Unicode.Scalar?) -> Bool {
    guard let c else { return false }
    return ("a"..."z").contains(c) || ("A"..."Z").contains(c)
  }
  static func isASCIIDigit(_ c: Unicode.Scalar?) -> Bool {
    guard let c else { return false }
    return ("0"..."9").contains(c)
  }
  static func isASCIIHexDigit(_ c: Unicode.Scalar?) -> Bool {
    guard let c else { return false }
    return isASCIIDigit(c) || ("a"..."f").contains(c) || ("A"..."F").contains(c)
  }
  static func lower(_ c: Unicode.Scalar) -> Unicode.Scalar {
    ("A"..."Z").contains(c) ? Unicode.Scalar(c.value + 32)! : c
  }

  // MARK: Windows drive letters and dot segments

  static func isWindowsDriveLetter(_ s: [Unicode.Scalar], normalized: Bool = false) -> Bool {
    s.count == 2 && isASCIIAlpha(s[0]) && (s[1] == ":" || (!normalized && s[1] == "|"))
  }

  static func startsWithWindowsDriveLetter(_ input: [Unicode.Scalar], at index: Int) -> Bool {
    guard index >= 0, input.count - index >= 2 else { return false }
    guard isWindowsDriveLetter([input[index], input[index + 1]]) else { return false }
    if input.count - index == 2 { return true }
    let third = input[index + 2]
    return third == "/" || third == "\\" || third == "?" || third == "#"
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

  static func shorten(_ url: inout WebURL) {
    guard case .segments(var segments) = url.path else { return }
    if url.scheme == "file", segments.count == 1, isWindowsDriveLetter(Array(segments[0].unicodeScalars), normalized: true) {
      return
    }
    if !segments.isEmpty { segments.removeLast() }
    url.path = .segments(segments)
  }

  static func appendSegment(_ url: inout WebURL, _ segment: String) {
    if case .segments(var segments) = url.path {
      segments.append(segment)
      url.path = .segments(segments)
    }
  }

  // MARK: The state machine

  static func parse(_ raw: String, base: WebURL?, url existing: WebURL? = nil, stateOverride: State? = nil) -> WebURL? {
    var scalars = Array(raw.unicodeScalars)
    if existing == nil {
      while let first = scalars.first, first.value <= 0x20 { scalars.removeFirst() }
      while let last = scalars.last, last.value <= 0x20 { scalars.removeLast() }
    }
    let input = scalars.filter { $0 != "\t" && $0 != "\n" && $0 != "\r" }
    var url = existing ?? WebURL()
    var state = stateOverride ?? .schemeStart
    var buffer: [Unicode.Scalar] = []
    var atSignSeen = false
    var insideBrackets = false
    var passwordTokenSeen = false
    var pointer = 0

    func at(_ index: Int) -> Unicode.Scalar? {
      index >= 0 && index < input.count ? input[index] : nil
    }

    while true {
      let c = at(pointer)
      switch state {
      case .schemeStart:
        if let c, isASCIIAlpha(c) {
          buffer.append(lower(c))
          state = .scheme
        } else if stateOverride == nil {
          state = .noScheme
          pointer -= 1
        } else {
          return nil
        }

      case .scheme:
        if let c, isASCIIAlpha(c) || isASCIIDigit(c) || c == "+" || c == "-" || c == "." {
          buffer.append(lower(c))
        } else if c == ":" {
          url.scheme = String(String.UnicodeScalarView(buffer))
          buffer = []
          if url.scheme == "file" {
            state = .file
          } else if url.isSpecial, let base, base.scheme == url.scheme {
            state = .specialRelativeOrAuthority
          } else if url.isSpecial {
            state = .specialAuthoritySlashes
          } else if at(pointer + 1) == "/" {
            state = .pathOrAuthority
            pointer += 1
          } else {
            url.path = .opaque("")
            state = .opaquePath
          }
        } else if stateOverride == nil {
          buffer = []
          state = .noScheme
          pointer = -1
        } else {
          return nil
        }

      case .noScheme:
        guard let base else { return nil }
        if case .opaque = base.path {
          guard c == "#" else { return nil }
          url.scheme = base.scheme
          url.path = base.path
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
        if c == "/", at(pointer + 1) == "/" {
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
        guard let base else { return nil }
        url.scheme = base.scheme
        if c == "/" {
          state = .relativeSlash
        } else if url.isSpecial, c == "\\" {
          state = .relativeSlash
        } else {
          url.username = base.username
          url.password = base.password
          url.host = base.host
          url.port = base.port
          url.path = base.path
          url.query = base.query
          if c == "?" {
            url.query = ""
            state = .query
          } else if c == "#" {
            url.fragment = ""
            state = .fragment
          } else if c != nil {
            url.query = nil
            shorten(&url)
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
          guard let base else { return nil }
          url.username = base.username
          url.password = base.password
          url.host = base.host
          url.port = base.port
          state = .path
          pointer -= 1
        }

      case .specialAuthoritySlashes:
        if c == "/", at(pointer + 1) == "/" {
          state = .specialAuthorityIgnoreSlashes
          pointer += 1
        } else {
          state = .specialAuthorityIgnoreSlashes
          pointer -= 1
        }

      case .specialAuthorityIgnoreSlashes:
        if c != "/" && c != "\\" {
          state = .authority
          pointer -= 1
        }

      case .authority:
        if c == "@" {
          if atSignSeen { buffer = Array("%40".unicodeScalars) + buffer }
          atSignSeen = true
          for scalar in buffer {
            if scalar == ":" && !passwordTokenSeen {
              passwordTokenSeen = true
              continue
            }
            let encoded = percentEncode(scalar, inUserinfo)
            if passwordTokenSeen { url.password += encoded } else { url.username += encoded }
          }
          buffer = []
        } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
          if atSignSeen && buffer.isEmpty { return nil }
          pointer -= buffer.count + 1
          buffer = []
          state = .host
        } else if let c {
          buffer.append(c)
        }

      case .host:
        if c == ":" && !insideBrackets {
          if buffer.isEmpty { return nil }
          guard let host = parseHost(buffer, isOpaque: !url.isSpecial) else { return nil }
          url.host = host
          buffer = []
          state = .port
        } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
          pointer -= 1
          if url.isSpecial && buffer.isEmpty { return nil }
          guard let host = parseHost(buffer, isOpaque: !url.isSpecial) else { return nil }
          url.host = host
          buffer = []
          state = .pathStart
        } else if let c {
          if c == "[" { insideBrackets = true }
          if c == "]" { insideBrackets = false }
          buffer.append(c)
        }

      case .port:
        if let c, isASCIIDigit(c) {
          buffer.append(c)
        } else if c == nil || c == "/" || c == "?" || c == "#" || (url.isSpecial && c == "\\") {
          if !buffer.isEmpty {
            var value = 0
            for digit in buffer {
              value = value * 10 + Int(digit.value - 0x30)
              if value > 65535 { return nil }
            }
            let defaultPort = specialPorts[url.scheme] ?? nil
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
        url.host = .empty
        if c == "/" || c == "\\" {
          state = .fileSlash
        } else if let base, base.scheme == "file" {
          url.host = base.host
          url.path = base.path
          url.query = base.query
          if c == "?" {
            url.query = ""
            state = .query
          } else if c == "#" {
            url.fragment = ""
            state = .fragment
          } else if c != nil {
            url.query = nil
            if !startsWithWindowsDriveLetter(input, at: pointer) {
              shorten(&url)
            } else {
              url.path = .segments([])
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
            url.host = base.host
            if !startsWithWindowsDriveLetter(input, at: pointer),
              case .segments(let baseSegments) = base.path, let first = baseSegments.first,
              isWindowsDriveLetter(Array(first.unicodeScalars), normalized: true)
            {
              appendSegment(&url, first)
            }
          }
          state = .path
          pointer -= 1
        }

      case .fileHost:
        if c == nil || c == "/" || c == "\\" || c == "?" || c == "#" {
          pointer -= 1
          if isWindowsDriveLetter(buffer) {
            state = .path
          } else if buffer.isEmpty {
            url.host = .empty
            state = .pathStart
          } else {
            guard var host = parseHost(buffer, isOpaque: !url.isSpecial) else { return nil }
            if host == .domain("localhost") { host = .empty }
            url.host = host
            buffer = []
            state = .pathStart
          }
        } else if let c {
          buffer.append(c)
        }

      case .pathStart:
        if url.isSpecial {
          state = .path
          if c != "/" && c != "\\" { pointer -= 1 }
        } else if stateOverride == nil && c == "?" {
          url.query = ""
          state = .query
        } else if stateOverride == nil && c == "#" {
          url.fragment = ""
          state = .fragment
        } else if c != nil {
          state = .path
          if c != "/" { pointer -= 1 }
        }

      case .path:
        if c == nil || c == "/" || (url.isSpecial && c == "\\") || (stateOverride == nil && (c == "?" || c == "#")) {
          let segment = String(String.UnicodeScalarView(buffer))
          let slash = c == "/" || (url.isSpecial && c == "\\")
          if isDoubleDot(segment) {
            shorten(&url)
            if !slash { appendSegment(&url, "") }
          } else if isSingleDot(segment) && !slash {
            appendSegment(&url, "")
          } else if !isSingleDot(segment) {
            var text = segment
            if url.scheme == "file", case .segments(let segments) = url.path, segments.isEmpty, isWindowsDriveLetter(buffer) {
              text = String(buffer[0]) + ":"
            }
            appendSegment(&url, text)
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
        } else if let c {
          buffer.append(contentsOf: percentEncode(c, inPath).unicodeScalars)
        }

      case .opaquePath:
        if c == "?" {
          url.query = ""
          state = .query
        } else if c == "#" {
          url.fragment = ""
          state = .fragment
        } else if let c {
          if case .opaque(let text) = url.path { url.path = .opaque(text + percentEncode(c, inC0Control)) }
        }

      case .query:
        if (stateOverride == nil && c == "#") || c == nil {
          let special = url.isSpecial
          var encoded = ""
          for scalar in buffer {
            encoded += special ? percentEncode(scalar, inSpecialQuery) : percentEncode(scalar, inQuery)
          }
          url.query = (url.query ?? "") + encoded
          buffer = []
          if c == "#" {
            url.fragment = ""
            state = .fragment
          }
        } else if let c {
          buffer.append(c)
        }

      case .fragment:
        if let c { url.fragment = (url.fragment ?? "") + percentEncode(c, inFragment) }
      }

      if pointer >= input.count { break }
      pointer += 1
    }
    return url
  }

  // MARK: Hosts

  static let forbiddenHost: Set<UInt32> = [
    0x00, 0x09, 0x0A, 0x0D, 0x20, 0x23, 0x2F, 0x3A, 0x3C, 0x3E, 0x3F, 0x40, 0x5B, 0x5C, 0x5D, 0x5E, 0x7C,
  ]

  static func isForbiddenDomain(_ c: UInt32) -> Bool {
    forbiddenHost.contains(c) || c <= 0x1F || c == 0x25 || c == 0x7F
  }

  static func parseHost(_ input: [Unicode.Scalar], isOpaque: Bool) -> WebURL.Host? {
    if input.first == "[" {
      guard input.last == "]", input.count >= 2 else { return nil }
      return parseIPv6(Array(input[1..<(input.count - 1)])).map(WebURL.Host.ipv6)
    }
    if isOpaque {
      if input.contains(where: { forbiddenHost.contains($0.value) }) { return nil }
      let text = input.map { percentEncode($0, inC0Control) }.joined()
      return text.isEmpty ? .empty : .opaque(text)
    }
    let decoded = String(decoding: percentDecode(Array(String(String.UnicodeScalarView(input)).utf8)), as: UTF8.self)
    guard let ascii = IDNA.domainToASCII(decoded) else { return nil }
    if ascii.unicodeScalars.contains(where: { isForbiddenDomain($0.value) }) { return nil }
    if endsInANumber(ascii) { return parseIPv4(ascii).map(WebURL.Host.ipv4) }
    return .domain(ascii)
  }

  static func percentDecode(_ bytes: [UInt8]) -> [UInt8] {
    var out: [UInt8] = []
    out.reserveCapacity(bytes.count)
    var i = 0
    func hexValue(_ b: UInt8) -> UInt8? {
      switch b {
      case 0x30...0x39: return b - 0x30
      case 0x41...0x46: return b - 0x41 + 10
      case 0x61...0x66: return b - 0x61 + 10
      default: return nil
      }
    }
    while i < bytes.count {
      if bytes[i] == 0x25, i + 2 < bytes.count, let high = hexValue(bytes[i + 1]), let low = hexValue(bytes[i + 2]) {
        out.append(high << 4 | low)
        i += 3
      } else {
        out.append(bytes[i])
        i += 1
      }
    }
    return out
  }

  static func ipv4Number(_ text: Substring) -> UInt64? {
    var input = Array(text.unicodeScalars)
    if input.isEmpty { return nil }
    var radix: UInt64 = 10
    if input.count >= 2, input[0] == "0", input[1] == "x" || input[1] == "X" {
      input.removeFirst(2)
      radix = 16
    } else if input.count >= 2, input[0] == "0" {
      input.removeFirst()
      radix = 8
    }
    if input.isEmpty { return 0 }
    var value: UInt64 = 0
    for c in input {
      let digit: UInt64
      if isASCIIDigit(c) {
        digit = UInt64(c.value - 0x30)
      } else if ("a"..."f").contains(c) {
        digit = UInt64(c.value - 0x61 + 10)
      } else if ("A"..."F").contains(c) {
        digit = UInt64(c.value - 0x41 + 10)
      } else {
        return nil
      }
      guard digit < radix else { return nil }
      // Past 2^40 the value can only fail, however large it grows.
      value = min(value * radix + digit, 1 << 40)
    }
    return value
  }

  static func endsInANumber(_ text: String) -> Bool {
    var parts = text.split(separator: ".", omittingEmptySubsequences: false)
    if parts.last?.isEmpty == true {
      if parts.count == 1 { return false }
      parts.removeLast()
    }
    guard let last = parts.last else { return false }
    if !last.isEmpty && last.unicodeScalars.allSatisfy({ isASCIIDigit($0) }) { return true }
    return ipv4Number(last) != nil
  }

  static func parseIPv4(_ text: String) -> UInt32? {
    var parts = text.split(separator: ".", omittingEmptySubsequences: false)
    if parts.last?.isEmpty == true, parts.count > 1 { parts.removeLast() }
    if parts.count > 4 { return nil }
    var numbers: [UInt64] = []
    for part in parts {
      guard let number = ipv4Number(part) else { return nil }
      numbers.append(number)
    }
    guard let last = numbers.last else { return nil }
    if numbers.dropLast().contains(where: { $0 > 255 }) { return nil }
    let limit = UInt64(1) << (8 * UInt64(5 - numbers.count))
    if last >= limit { return nil }
    var address = last
    for (index, number) in numbers.dropLast().enumerated() {
      address += number << (8 * UInt64(3 - index))
    }
    return UInt32(address)
  }

  static func parseIPv6(_ input: [Unicode.Scalar]) -> [UInt16]? {
    var address = [UInt16](repeating: 0, count: 8)
    var pieceIndex = 0
    var compress: Int?
    var pointer = 0
    func c(_ offset: Int = 0) -> Unicode.Scalar? {
      let i = pointer + offset
      return i < input.count ? input[i] : nil
    }
    if c() == ":" {
      guard c(1) == ":" else { return nil }
      pointer += 2
      pieceIndex += 1
      compress = pieceIndex
    }
    while c() != nil {
      if pieceIndex == 8 { return nil }
      if c() == ":" {
        if compress != nil { return nil }
        pointer += 1
        pieceIndex += 1
        compress = pieceIndex
        continue
      }
      var value: UInt32 = 0
      var length = 0
      while length < 4, let h = c(), isASCIIHexDigit(h) {
        value = value * 16 + UInt32(hexDigitValue(h))
        pointer += 1
        length += 1
      }
      if c() == "." {
        if length == 0 { return nil }
        pointer -= length
        if pieceIndex > 6 { return nil }
        var numbersSeen = 0
        while c() != nil {
          var ipv4Piece: Int?
          if numbersSeen > 0 {
            if c() == ".", numbersSeen < 4 { pointer += 1 } else { return nil }
          }
          guard let d = c(), isASCIIDigit(d) else { return nil }
          while let d = c(), isASCIIDigit(d) {
            let number = Int(d.value - 0x30)
            if let held = ipv4Piece {
              if held == 0 { return nil }
              ipv4Piece = held * 10 + number
            } else {
              ipv4Piece = number
            }
            if ipv4Piece! > 255 { return nil }
            pointer += 1
          }
          address[pieceIndex] = address[pieceIndex] &* 0x100 &+ UInt16(ipv4Piece!)
          numbersSeen += 1
          if numbersSeen == 2 || numbersSeen == 4 { pieceIndex += 1 }
        }
        if numbersSeen != 4 { return nil }
        break
      } else if c() == ":" {
        pointer += 1
        if c() == nil { return nil }
      } else if c() != nil {
        return nil
      }
      address[pieceIndex] = UInt16(value)
      pieceIndex += 1
    }
    if let compress {
      var swaps = pieceIndex - compress
      pieceIndex = 7
      while pieceIndex != 0 && swaps > 0 {
        address.swapAt(pieceIndex, compress + swaps - 1)
        pieceIndex -= 1
        swaps -= 1
      }
    } else if pieceIndex != 8 {
      return nil
    }
    return address
  }

  static func hexDigitValue(_ c: Unicode.Scalar) -> Int {
    if isASCIIDigit(c) { return Int(c.value - 0x30) }
    if ("a"..."f").contains(c) { return Int(c.value - 0x61 + 10) }
    return Int(c.value - 0x41 + 10)
  }

  static func serializeIPv6(_ pieces: [UInt16]) -> String {
    // The first longest run of two or more zero pieces is written "::".
    var compress: Int?
    var bestLength = 1
    var index = 0
    while index < 8 {
      if pieces[index] == 0 {
        var end = index
        while end < 8 && pieces[end] == 0 { end += 1 }
        if end - index > bestLength {
          bestLength = end - index
          compress = index
        }
        index = end
      } else {
        index += 1
      }
    }
    var out = ""
    var ignore0 = false
    for pieceIndex in 0..<8 {
      if ignore0 && pieces[pieceIndex] == 0 { continue }
      ignore0 = false
      if compress == pieceIndex {
        out += pieceIndex == 0 ? "::" : ":"
        ignore0 = true
        continue
      }
      out += String(pieces[pieceIndex], radix: 16)
      if pieceIndex != 7 { out += ":" }
    }
    return out
  }
}

// MARK: - Domain to ASCII

/// UTS #46 ToASCII as the URL Standard calls it (CheckHyphens false,
/// CheckJoiners true, UseSTD3ASCIIRules false, non-transitional), by
/// approximation: the full mapping table is NFKC_Casefold with exceptions,
/// and this applies NFKC and lower-casing, the ignored code points, the
/// dots that map to `.`, and refuses controls, unassigned and private-use
/// code points, separators and a joiner that doesn't follow a virama. The
/// Bidi rule isn't checked.
enum IDNA {
  static let ignored: Set<UInt32> = [0x00AD, 0x034F, 0x180B, 0x180C, 0x180D, 0x180F, 0x200B, 0x2060, 0xFEFF]

  static func domainToASCII(_ domain: String) -> String? {
    if domain.unicodeScalars.allSatisfy({ $0.isASCII }) {
      let lowered = String(String.UnicodeScalarView(domain.unicodeScalars.map(WebURLParser.lower)))
      return toASCII(lowered)
    }
    var mapped = String.UnicodeScalarView()
    for scalar in domain.unicodeScalars {
      let value = scalar.value
      if scalar.isASCII {
        mapped.append(WebURLParser.lower(scalar))
        continue
      }
      if ignored.contains(value) || (0xFE00...0xFE0F).contains(value) || (0xE0100...0xE01EF).contains(value)
        || (0x1BCA0...0x1BCA3).contains(value)
      {
        continue
      }
      if value == 0x3002 || value == 0xFF0E || value == 0xFF61 {
        mapped.append(".")
        continue
      }
      if value == 0x200C || value == 0x200D {
        mapped.append(scalar)
        continue
      }
      let folded = String(scalar).precomposedStringWithCompatibilityMapping.lowercased()
        .precomposedStringWithCompatibilityMapping
      for out in folded.unicodeScalars {
        if out == "\u{3002}" { mapped.append("."); continue }
        guard isValid(out) else { return nil }
        mapped.append(out)
      }
    }
    return toASCII(String(mapped).precomposedStringWithCanonicalMapping)
  }

  static func isValid(_ scalar: Unicode.Scalar) -> Bool {
    if scalar.value == 0xFFFD { return false }
    switch scalar.properties.generalCategory {
    case .control, .format, .surrogate, .privateUse, .unassigned, .spaceSeparator, .lineSeparator, .paragraphSeparator:
      return scalar.value == 0x200C || scalar.value == 0x200D
    default:
      return true
    }
  }

  static func toASCII(_ domain: String) -> String? {
    var labels: [String] = []
    for label in domain.split(separator: ".", omittingEmptySubsequences: false) {
      let scalars = Array(label.unicodeScalars)
      if label.hasPrefix("xn--") {
        guard scalars.allSatisfy({ $0.isASCII }) else { return nil }
        guard let decoded = Punycode.decode(String(label.dropFirst(4))), !decoded.isEmpty else { return nil }
        guard validLabel(decoded) else { return nil }
        labels.append(String(label))
      } else if scalars.allSatisfy({ $0.isASCII }) {
        labels.append(String(label))
      } else {
        guard validLabel(scalars), let encoded = Punycode.encode(scalars) else { return nil }
        labels.append("xn--" + encoded)
      }
    }
    let result = labels.joined(separator: ".")
    return result.isEmpty ? nil : result
  }

  static func validLabel(_ scalars: [Unicode.Scalar]) -> Bool {
    let text = String(String.UnicodeScalarView(scalars))
    if text.precomposedStringWithCanonicalMapping != text { return false }
    if let first = scalars.first {
      switch first.properties.generalCategory {
      case .nonspacingMark, .spacingMark, .enclosingMark: return false
      default: break
      }
    }
    for (index, scalar) in scalars.enumerated() {
      guard isValid(scalar) else { return false }
      if scalar.value == 0x200C || scalar.value == 0x200D {
        guard index > 0, scalars[index - 1].properties.canonicalCombiningClass == .virama else { return false }
      }
      if scalar == "." { return false }
    }
    return true
  }
}

/// Punycode (RFC 3492), for internationalized domain labels.
enum Punycode {
  static let base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128

  static func adapt(_ delta: Int, _ numPoints: Int, _ firstTime: Bool) -> Int {
    var delta = firstTime ? delta / damp : delta / 2
    delta += delta / numPoints
    var k = 0
    while delta > ((base - tMin) * tMax) / 2 {
      delta /= base - tMin
      k += base
    }
    return k + (((base - tMin + 1) * delta) / (delta + skew))
  }

  static func digit(_ d: Int) -> Unicode.Scalar {
    Unicode.Scalar(UInt8(d < 26 ? d + 0x61 : d - 26 + 0x30))
  }

  static func encode(_ input: [Unicode.Scalar]) -> String? {
    var output = String.UnicodeScalarView()
    for scalar in input where scalar.isASCII { output.append(scalar) }
    let basicCount = output.count
    var handled = basicCount
    if basicCount > 0 { output.append("-") }
    var n = initialN
    var delta = 0
    var bias = initialBias
    let values = input.map { Int($0.value) }
    while handled < values.count {
      guard let m = values.filter({ $0 >= n }).min() else { return nil }
      let (product, overflow) = (m - n).multipliedReportingOverflow(by: handled + 1)
      guard !overflow else { return nil }
      delta += product
      n = m
      for c in values {
        if c < n { delta += 1 }
        if c == n {
          var q = delta
          var k = base
          while true {
            let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
            if q < t { break }
            output.append(digit(t + (q - t) % (base - t)))
            q = (q - t) / (base - t)
            k += base
          }
          output.append(digit(q))
          bias = adapt(delta, handled + 1, handled == basicCount)
          delta = 0
          handled += 1
        }
      }
      delta += 1
      n += 1
    }
    return String(output)
  }

  static func decode(_ input: String) -> [Unicode.Scalar]? {
    let scalars = Array(input.unicodeScalars)
    var output: [Int] = []
    var basicEnd = 0
    if let lastDash = scalars.lastIndex(of: "-") {
      for scalar in scalars[..<lastDash] {
        guard scalar.isASCII else { return nil }
        output.append(Int(scalar.value))
      }
      basicEnd = lastDash + 1
    }
    var n = initialN
    var i = 0
    var bias = initialBias
    var index = basicEnd
    while index < scalars.count {
      let oldI = i
      var w = 1
      var k = base
      while true {
        guard index < scalars.count else { return nil }
        let c = scalars[index].value
        index += 1
        let d: Int
        switch c {
        case 0x30...0x39: d = Int(c) - 0x30 + 26
        case 0x41...0x5A: d = Int(c) - 0x41
        case 0x61...0x7A: d = Int(c) - 0x61
        default: return nil
        }
        let (step, overflow) = d.multipliedReportingOverflow(by: w)
        guard !overflow, i <= Int.max - step else { return nil }
        i += step
        let t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias)
        if d < t { break }
        let (next, overflowW) = w.multipliedReportingOverflow(by: base - t)
        guard !overflowW else { return nil }
        w = next
        k += base
      }
      bias = adapt(i - oldI, output.count + 1, oldI == 0)
      n += i / (output.count + 1)
      guard n <= 0x10FFFF else { return nil }
      i %= output.count + 1
      output.insert(n, at: i)
      i += 1
    }
    var result: [Unicode.Scalar] = []
    for value in output {
      guard let scalar = Unicode.Scalar(UInt32(value)) else { return nil }
      result.append(scalar)
    }
    return result
  }
}
