// The request and response every network call in the app is made of: what
// the web passes to `fetch(url, init)` and what `fetch` resolves to, as
// values, so a transport can be swapped (URLSessionTransport on a device,
// MockTransport in tests and the demo) and a test can compare a request
// with the one the web code made (ios/parity/cases/_fetch.js).
//
// The URL is kept as the string the web code built, not a Foundation URL:
// that is what a parity fixture records and compares, and a string the web
// accepts is parsed for sending with the URL Standard's parser (WebURL), not
// Foundation's stricter one.

import Foundation
import VirgaCore

// MARK: - Headers

/// A request's or response's headers, as the Fetch standard's `Headers`
/// object holds them: names compared case-insensitively, a value's
/// surrounding HTTP whitespace dropped, and two values under one name read
/// back joined with ", ".
public struct HTTPHeaders: Sendable, Hashable, Sequence, ExpressibleByDictionaryLiteral {
  public struct Field: Sendable, Hashable {
    public var name: String
    public var value: String
  }

  public private(set) var fields: [Field] = []

  public init() {}

  /// Headers in the order given (later duplicates are appended, as
  /// `new Headers(object)` does).
  public init(_ pairs: [(String, String)]) {
    for (name, value) in pairs { append(name, value) }
  }

  public init(dictionaryLiteral elements: (String, String)...) {
    self.init(elements)
  }

  /// `headers.get(name)`: every value under `name` joined with ", ", or nil.
  public func get(_ name: String) -> String? {
    let key = name.lowercased()
    let values = fields.filter { $0.name.lowercased() == key }.map(\.value)
    return values.isEmpty ? nil : values.joined(separator: ", ")
  }

  /// `headers.has(name)`.
  public func has(_ name: String) -> Bool { get(name) != nil }

  /// `headers.set(name, value)`: replaces every value under `name`.
  public mutating func set(_ name: String, _ value: String) {
    let key = name.lowercased()
    if let first = fields.firstIndex(where: { $0.name.lowercased() == key }) {
      fields[first].value = Self.normalize(value)
      fields = fields.enumerated().filter { $0.offset == first || $0.element.name.lowercased() != key }.map(\.element)
    } else {
      fields.append(Field(name: name, value: Self.normalize(value)))
    }
  }

  /// `headers.append(name, value)`.
  public mutating func append(_ name: String, _ value: String) {
    fields.append(Field(name: name, value: Self.normalize(value)))
  }

  /// `headers.delete(name)`.
  public mutating func delete(_ name: String) {
    let key = name.lowercased()
    fields.removeAll { $0.name.lowercased() == key }
  }

  /// The headers as `[...headers.entries()]` gives them: lower-cased names,
  /// sorted, one combined value each. This is the form a parity fixture
  /// records.
  public var canonical: [String: String] {
    var out: [String: String] = [:]
    for field in fields {
      let key = field.name.lowercased()
      if let held = out[key] { out[key] = "\(held), \(field.value)" } else { out[key] = field.value }
    }
    return out
  }

  public var isEmpty: Bool { fields.isEmpty }

  public func makeIterator() -> IndexingIterator<[Field]> { fields.makeIterator() }

  public static func == (lhs: HTTPHeaders, rhs: HTTPHeaders) -> Bool { lhs.canonical == rhs.canonical }
  public func hash(into hasher: inout Hasher) { hasher.combine(canonical) }

  /// Fetch's header value normalization: leading and trailing HTTP
  /// whitespace (tab, line feed, carriage return, space) removed.
  static func normalize(_ value: String) -> String {
    let scalars = value.unicodeScalars
    let isSpace: (Unicode.Scalar) -> Bool = { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" }
    guard let start = scalars.firstIndex(where: { !isSpace($0) }) else { return "" }
    let end = scalars.lastIndex(where: { !isSpace($0) })!
    return String(scalars[start...end])
  }
}

// MARK: - Request

/// One `fetch(url, init)`.
public struct HTTPRequest: Sendable, Hashable, CustomStringConvertible {
  /// Upper-case, as `String(init.method || 'GET').toUpperCase()`.
  public var method: String
  /// The address exactly as the web code built it.
  public var url: String
  public var headers: HTTPHeaders
  public var body: Data?
  /// The deadline the web attaches with `AbortSignal.timeout(ms)`, in
  /// milliseconds; the transport gives up with `HTTPTransportError.timedOut`
  /// when it passes. Nil for none.
  public var timeoutMs: Double?

  public init(
    method: String = "GET",
    url: String,
    headers: HTTPHeaders = HTTPHeaders(),
    body: Data? = nil,
    timeoutMs: Double? = nil
  ) {
    self.method = method.uppercased()
    self.url = url
    self.headers = headers
    self.body = body
    self.timeoutMs = timeoutMs
  }

  /// A request whose body is `text` as UTF-8.
  public init(method: String, url: String, headers: HTTPHeaders = HTTPHeaders(), text: String, timeoutMs: Double? = nil) {
    self.init(method: method, url: url, headers: headers, body: Data(text.utf8), timeoutMs: timeoutMs)
  }

  public var description: String {
    var out = "\(method) \(url)"
    let headers = self.headers.canonical.sorted { $0.key < $1.key }
    if !headers.isEmpty { out += " " + headers.map { "\($0.key): \($0.value)" }.joined(separator: "; ") }
    if let body {
      let text = String(decoding: body, as: UTF8.self)
      out += " body(\(body.count) bytes): " + (text.count > 200 ? String(text.prefix(200)) + "…" : text)
    }
    return out
  }
}

// MARK: - Response

/// What `fetch` resolves to.
public struct HTTPResponse: Sendable, Hashable {
  public var status: Int
  /// The reason phrase. Empty over HTTP/2, and from URLSession, which
  /// doesn't expose it; the web's messages that quote it then read as the
  /// browser's do over HTTP/2.
  public var statusText: String
  public var headers: HTTPHeaders
  public var body: Data
  /// The address the response came from.
  public var url: String

  public init(status: Int = 200, statusText: String = "", headers: HTTPHeaders = HTTPHeaders(), body: Data = Data(), url: String = "") {
    self.status = status
    self.statusText = statusText
    self.headers = headers
    self.body = body
    self.url = url
  }

  /// `res.ok`.
  public var ok: Bool { (200...299).contains(status) }

  /// `await res.json()`: UTF-8 (a byte-order mark dropped), then JSON.parse.
  /// Throws JSONSyntaxError, with V8's words, for a body that isn't JSON.
  public func json() throws -> JSONValue { try JSONSyntaxError.parse(body) }

  /// `await res.json().catch(() => null)`.
  public func jsonOrNull() -> JSONValue? { try? json() }

  /// `await res.text()`: UTF-8, a leading byte-order mark dropped, malformed
  /// bytes read as U+FFFD.
  public func text() -> String {
    var text = String(decoding: body, as: UTF8.self)
    if text.unicodeScalars.first == "\u{FEFF}" { text.unicodeScalars.removeFirst() }
    return text
  }

  /// A JSON response, as `new Response(JSON.stringify(body), { status,
  /// headers: { 'Content-Type': 'application/json' } })`.
  public static func json(_ value: JSONValue, status: Int = 200, headers: HTTPHeaders = HTTPHeaders(), url: String = "") -> HTTPResponse {
    var all: HTTPHeaders = ["Content-Type": "application/json"]
    for field in headers { all.set(field.name, field.value) }
    return HTTPResponse(status: status, headers: all, body: Data(JSONStringify.stringify(value).utf8), url: url)
  }
}

// MARK: - Errors

/// Why a request got no response: what `fetch` rejects with.
public enum HTTPTransportError: Error, Sendable, Hashable, LocalizedError {
  /// The request's deadline passed (`AbortSignal.timeout`): a DOMException
  /// named TimeoutError.
  case timedOut
  /// The network failed (fetch's TypeError). The message is what the web
  /// would have read: Node says "fetch failed", browsers "Failed to fetch".
  case network(String)
  /// An address no URL parser takes.
  case invalidURL(String)

  public var errorDescription: String? {
    switch self {
    case .timedOut: return "The operation was aborted due to timeout"
    case .network(let message): return message
    case .invalidURL: return "Invalid URL"
    }
  }

  /// The JavaScript error's name.
  public var name: String {
    switch self {
    case .timedOut: return "TimeoutError"
    case .network, .invalidURL: return "TypeError"
    }
  }
}

/// `err.message` for any error a port can catch: a Swift error's
/// description where it has one, as the web reads `error.message`.
public func jsMessage(_ error: any Error) -> String {
  if let error = error as? LocalizedError, let text = error.errorDescription { return text }
  if error is CancellationError { return "This operation was aborted" }
  return String(describing: error)
}
