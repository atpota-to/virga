// The XRPC client signed-in calls go through: the part of @atproto/api's
// Agent (and @atproto/xrpc's XrpcClient under it) the web app relies on.
//
// A call is built the SDK's way: the path `/xrpc/<nsid>?<params>`, GET for a
// query and POST for a procedure, the input's content type, the client's
// headers, the labelers header every Agent call carries
// (`atproto-accept-labelers: did:plc:ar7c4by46qjdydhdevvrndac;redact`, plus
// any configured) and `atproto-proxy` once `withProxy` is used. It is handed
// to a fetch handler, which decides how it is sent:
//
//   ServiceFetchHandler   to a service URL (a PDS, the AppView), as
//                         `new Agent(serviceUrl)` does
//   BackendFetchHandler   through Virga's server (/api/oauth/proxy and
//                         /api/oauth/upload-blob) with the account's `vg_`
//                         token: the web's long sessions, and the only way
//                         the iOS app signs calls (src/session/backendClient.js)
//
// The answer is read the SDK's way: by content type (JSON, text or bytes),
// and a status that isn't success becomes an XRPCError with the body's
// `error` and `message`. Not ported: the SDK checks a JSON answer against the
// method's lexicon and fails one that doesn't match with InvalidResponse;
// here the answer is handed on as it came, and a typed `query(…, as:)`
// fails only where it can't decode.

import Foundation
import VirgaCore

/// One call as an Agent hands it to its fetch handler: `fetchHandler(url,
/// init)`.
public struct XRPCHandlerRequest: Sendable, Hashable {
  /// `/xrpc/<nsid>?<query>`, relative, as the SDK builds it.
  public var path: String
  public var method: String
  public var headers: HTTPHeaders
  public var body: Data?
  /// Whether the caller passed its own AbortSignal (`init.signal`), as
  /// blobs.js does with a deadline of its own. A handler that would add a
  /// fallback deadline only for a call without one reads this.
  public var hasSignal: Bool

  public init(path: String, method: String, headers: HTTPHeaders = HTTPHeaders(), body: Data? = nil, hasSignal: Bool = false) {
    self.path = path
    self.method = method.uppercased()
    self.headers = headers
    self.body = body
    self.hasSignal = hasSignal
  }
}

/// How an Agent's calls are sent (the SDK's `fetchHandler`, the pluggable
/// part of a session).
public protocol XRPCFetchHandler: Sendable {
  func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse
}

/// `buildFetchHandler(service)`: each call to `new URL(path, service)`, with
/// default headers added where the call has none of that name.
public struct ServiceFetchHandler: XRPCFetchHandler {
  public var service: String
  public var defaultHeaders: [(String, String)]
  public var transport: any HTTPTransport
  /// A deadline for each call. The SDK attaches none (a caller's signal
  /// is its only limit); nil keeps it so.
  public var timeoutMs: Double?

  public init(service: String, headers: [(String, String)] = [], transport: any HTTPTransport = HTTP.transport, timeoutMs: Double? = nil) {
    self.service = service
    self.defaultHeaders = headers
    self.transport = transport
    self.timeoutMs = timeoutMs
  }

  public func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse {
    let url = try WebURL(request.path, base: service).href
    var headers = request.headers
    for (name, value) in defaultHeaders where !headers.has(name) { headers.set(name, value) }
    return try await transport.send(
      HTTPRequest(method: request.method, url: url, headers: headers, body: request.body, timeoutMs: timeoutMs)
    )
  }
}

/// A call's answer: `res.data` and `res.headers`.
public struct XRPCResponse: Sendable, Hashable {
  public enum Body: Sendable, Hashable {
    case json(JSONValue)
    case text(String)
    case bytes(Data)
  }

  public var body: Body
  /// The response's headers, lower-cased names.
  public var headers: [String: String]

  /// The JSON body, or `.null` for a text or byte answer.
  public var data: JSONValue {
    if case .json(let value) = body { return value }
    return .null
  }

  /// The body's bytes, for a byte answer.
  public var bytes: Data? {
    if case .bytes(let data) = body { return data }
    return nil
  }

  /// The JSON body decoded as `T`.
  public func decode<T: Decodable>(_ type: T.Type) throws -> T { try data.decode(T.self) }
}

public struct XRPCAgent: Sendable {
  /// `BSKY_LABELER_DID`: Bluesky's moderation labeler, which every Agent
  /// call names with `;redact` (`Agent.appLabelers`).
  public static let bskyLabelerDid = "did:plc:ar7c4by46qjdydhdevvrndac"
  public static let appLabelers = [bskyLabelerDid]

  public enum Kind: Sendable { case query, procedure }

  /// A procedure's input.
  public enum Input: Sendable, Hashable {
    /// JSON (`application/json`), as the SDK encodes an object.
    case json(JSONValue)
    /// Bytes (`application/octet-stream`, unless an encoding is given).
    case bytes(Data)
    /// Text (`text/plain;charset=UTF-8`, unless an encoding is given),
    /// sent as it is.
    case text(String)

    /// Any Encodable as JSON.
    public static func encoding<T: Encodable>(_ value: T) throws -> Input {
      .json(try JSONValue(encoding: value))
    }
  }

  /// A call's options (`opts`).
  public struct CallOptions: Sendable {
    /// `opts.headers`.
    public var headers: [(String, String)]
    /// `opts.encoding`: the input's content type.
    public var encoding: String?
    /// The caller passed its own AbortSignal (see XRPCHandlerRequest).
    public var hasSignal: Bool

    public init(headers: [(String, String)] = [], encoding: String? = nil, hasSignal: Bool = false) {
      self.headers = headers
      self.encoding = encoding
      self.hasSignal = hasSignal
    }
  }

  /// The account the agent acts as, when it has one.
  public let did: String?
  public let fetchHandler: any XRPCFetchHandler
  /// `atproto-proxy`: `<did>#<service>`.
  public private(set) var proxy: String?
  public private(set) var labelers: [String] = []
  /// The client's own headers (`setHeader`), lower-cased names.
  public private(set) var headers: [(String, String)] = []

  public init(did: String? = nil, fetchHandler: any XRPCFetchHandler) {
    self.did = did
    self.fetchHandler = fetchHandler
  }

  /// `new Agent(serviceUrl)`.
  public init(service: String, transport: any HTTPTransport = HTTP.transport) {
    self.init(fetchHandler: ServiceFetchHandler(service: service, transport: transport))
  }

  /// Bluesky's AppView as a proxied service: the web's `APPVIEW_SERVICE`
  /// (`agent.withProxy('bsky_appview', 'did:web:api.bsky.app')`), which the
  /// signed-in reads (followers, notifications, search, bookmarks) ask.
  public static let blueskyAppView = (serviceType: "bsky_appview", did: "did:web:api.bsky.app")

  /// `agent.withProxy(...APPVIEW_SERVICE)`.
  public func withBlueskyAppView() -> XRPCAgent {
    withProxy(Self.blueskyAppView.serviceType, Self.blueskyAppView.did)
  }

  /// `agent.withProxy(serviceType, did)`: a copy whose calls name the
  /// service (`did:web:api.bsky.app#bsky_appview`).
  public func withProxy(_ serviceType: String, _ did: String) -> XRPCAgent {
    var copy = self
    copy.proxy = "\(did)#\(serviceType)"
    return copy
  }

  public mutating func configureProxy(_ value: String?) { proxy = value }
  public mutating func configureLabelers(_ dids: [String]) { labelers = dids }
  public mutating func setHeader(_ name: String, _ value: String) {
    let key = name.lowercased()
    headers.removeAll { $0.0 == key }
    headers.append((key, value))
  }

  // MARK: Calls

  public func query(_ nsid: String, _ params: XRPCParams? = nil, options: CallOptions = CallOptions()) async throws -> XRPCResponse {
    try await call(nsid, kind: .query, params: params, input: nil, options: options)
  }

  public func procedure(
    _ nsid: String,
    input: Input? = nil,
    params: XRPCParams? = nil,
    options: CallOptions = CallOptions()
  ) async throws -> XRPCResponse {
    try await call(nsid, kind: .procedure, params: params, input: input, options: options)
  }

  public func query<T: Decodable>(_ nsid: String, _ params: XRPCParams? = nil, as type: T.Type) async throws -> T {
    try await query(nsid, params).decode(T.self)
  }

  public func procedure<T: Decodable>(_ nsid: String, input: Input? = nil, params: XRPCParams? = nil, as type: T.Type) async throws -> T {
    try await procedure(nsid, input: input, params: params).decode(T.self)
  }

  /// `XrpcClient.call(nsid, params, data, opts)`, through the Agent's
  /// header wrapper and fetch handler. Throws XRPCError for any failure
  /// (cancellation excepted, which stays a CancellationError).
  public func call(
    _ nsid: String,
    kind: Kind,
    params: XRPCParams? = nil,
    input: Input? = nil,
    options: CallOptions = CallOptions()
  ) async throws -> XRPCResponse {
    let path = XRPCPath.methodCallURL(nsid, params)
    let method = kind == .procedure ? "POST" : "GET"

    // constructMethodCallHeaders
    var requestHeaders = HTTPHeaders()
    for (name, value) in options.headers { requestHeaders.set(name, value) }
    if kind == .procedure {
      // `if (opts?.encoding)`: an empty encoding is none.
      if let encoding = options.encoding, !encoding.isEmpty {
        requestHeaders.set("content-type", encoding)
      } else if !requestHeaders.has("content-type"), let input {
        switch input {
        case .bytes: requestHeaders.set("content-type", "application/octet-stream")
        case .text, .json(.string): requestHeaders.set("content-type", "text/plain;charset=UTF-8")
        case .json: requestHeaders.set("content-type", "application/json")
        }
      }
    }

    // encodeMethodCallBody: no content type (or an empty one), no body.
    var body: Data?
    if let contentType = requestHeaders.get("content-type"), !contentType.isEmpty {
      guard let input else {
        throw XRPCError(
          statusCode: XRPCResponseType.invalidRequest.rawValue,
          error: "A request body is expected but none was provided"
        )
      }
      switch input {
      case .bytes(let data): body = data
      case .text(let text), .json(.string(let text)): body = Data(text.utf8)
      case .json(let value):
        if contentType.jsStartsWith("text/") {
          body = Data(value.jsString.utf8)
        } else if contentType.jsStartsWith("application/json") {
          body = Data(JSONStringify.stringify(value).utf8)
        } else {
          let type: String
          switch value {
          case .null, .object: type = "object"
          case .array: type = "Array"
          case .bool: type = "boolean"
          case .number: type = "number"
          case .string: type = "string"
          }
          throw XRPCError(
            statusCode: XRPCResponseType.invalidRequest.rawValue,
            error: "Unable to encode \(type) as \(contentType) data"
          )
        }
      }
    }

    // combineHeaders with the client's own, then the Agent's wrapper.
    for (name, value) in headers where !requestHeaders.has(name) { requestHeaders.set(name, value) }
    if let proxy, !requestHeaders.has("atproto-proxy") { requestHeaders.set("atproto-proxy", proxy) }
    let accept =
      (Self.appLabelers.map { "\($0);redact" } + labelers + [requestHeaders.get("atproto-accept-labelers")?.jsTrimmed() ?? ""])
      .filter { !$0.isEmpty }
      .joined(separator: ", ")
    requestHeaders.set("atproto-accept-labelers", accept)

    let request = XRPCHandlerRequest(path: path, method: method, headers: requestHeaders, body: body, hasSignal: options.hasSignal)
    do {
      let response = try await fetchHandler.handle(request)
      return try Self.read(response)
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw XRPCError.from(error)
    }
  }

  /// Whether any object in `value` has a member named `__proto__` (walked
  /// without recursion: an answer can nest deeply).
  static func hasProtoKey(_ value: JSONValue) -> Bool {
    var stack = [value]
    while let next = stack.popLast() {
      switch next {
      case .object(let members):
        if members.keys.contains(where: { $0.jsEquals("__proto__") }) { return true }
        stack.append(contentsOf: members.values)
      case .array(let items):
        stack.append(contentsOf: items)
      default:
        break
      }
    }
    return false
  }

  /// The SDK's reading of an answer: the body by content type, then an
  /// XRPCError for a status that isn't success.
  static func read(_ response: HTTPResponse) throws -> XRPCResponse {
    let headers = response.headers.canonical
    let contentType = response.headers.get("content-type")
    let body: XRPCResponse.Body
    // httpResponseBodyParse: `mimeType.includes(...)`, `startsWith(...)`.
    if let contentType, contentType.jsIncludes("application/json") {
      let parsed: JSONValue
      do {
        parsed = try JSONSyntaxError.parse(response.body)
      } catch {
        throw XRPCError(
          statusCode: XRPCResponseType.invalidResponse.rawValue,
          message: "Failed to parse response body: SyntaxError: \(jsMessage(error))"
        )
      }
      // jsonStringToLex refuses an object with a `__proto__` member
      // anywhere in the answer, whatever its status.
      if hasProtoKey(parsed) {
        throw XRPCError(
          statusCode: XRPCResponseType.invalidResponse.rawValue,
          message: "Failed to parse response body: TypeError: Invalid key: __proto__"
        )
      }
      body = .json(parsed)
    } else if let contentType, contentType.jsStartsWith("text/") {
      body = .text(response.text())
    } else {
      body = .bytes(response.body)
    }
    let type = XRPCResponseType.from(httpStatus: response.status)
    if type != .success {
      var error: String?
      var message: String?
      // isErrorResponseBody: an object whose `error` and `message` are
      // strings where present.
      if case .json(.object(let members)) = body {
        let errorValue = members["error"]
        let messageValue = members["message"]
        let errorOK = !errorValue.isPresent || errorValue?.stringValue != nil
        let messageOK = !messageValue.isPresent || messageValue?.stringValue != nil
        if errorOK && messageOK {
          error = errorValue?.stringValue
          message = messageValue?.stringValue
        }
      }
      throw XRPCError(statusCode: type.rawValue, error: error, message: message, headers: headers)
    }
    return XRPCResponse(body: body, headers: headers)
  }
}
