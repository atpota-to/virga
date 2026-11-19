// A transport that answers from stubs, for tests and the demo: the iOS
// counterpart of the web tests' `vi.stubGlobal('fetch', …)`.
//
//   let transport = MockTransport()
//   transport.on("GET", .path("/xrpc/app.bsky.actor.getProfile"), respond: .json(profile))
//   transport.on(.urlPrefix("https://constellation.microcosm.blue/"), times: 1, respond: .status(429))
//   transport.on(.urlPrefix("https://constellation.microcosm.blue/"), respond: .json(["records": []]))
//
// Routes are tried in the order they were added; a route with `times`
// answers that many requests and then steps aside, so a sequence (a 429,
// then the answer) is two routes. Every request is recorded. A request no
// route answers is recorded in `unexpected` and fails loudly: it throws
// `MockTransportError.unexpectedRequest`, naming the request and every route,
// so a test never passes by a request quietly going unanswered.

import Foundation
import VirgaCore

public final class MockTransport: HTTPTransport, @unchecked Sendable {
  /// Which requests a route answers.
  public enum Matcher: Sendable, CustomStringConvertible {
    /// The whole address, exactly.
    case url(String)
    /// Addresses that start with this.
    case urlPrefix(String)
    /// The path, whatever the host, query or fragment (`/xrpc/<nsid>`).
    case path(String)
    /// A regular expression searched for in the whole address.
    case regex(String)
    /// Anything a predicate accepts.
    case predicate(String, @Sendable (HTTPRequest) -> Bool)
    /// Every request.
    case any

    public func matches(_ request: HTTPRequest) -> Bool {
      switch self {
      case .url(let url): return request.url == url
      case .urlPrefix(let prefix): return request.url.hasPrefix(prefix)
      case .path(let path): return (try? WebURL(request.url))?.pathname == path
      case .regex(let pattern):
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
        let text = request.url as NSString
        return regex.firstMatch(in: request.url, range: NSRange(location: 0, length: text.length)) != nil
      case .predicate(_, let accepts): return accepts(request)
      case .any: return true
      }
    }

    public var description: String {
      switch self {
      case .url(let url): return "url \(url)"
      case .urlPrefix(let prefix): return "url prefix \(prefix)"
      case .path(let path): return "path \(path)"
      case .regex(let pattern): return "regex \(pattern)"
      case .predicate(let name, _): return "predicate \(name)"
      case .any: return "any request"
      }
    }
  }

  /// A canned answer.
  public enum Response: Sendable {
    /// JSON, with Content-Type application/json.
    case json(JSONValue, status: Int = 200, headers: HTTPHeaders = HTTPHeaders())
    /// Text, as given, with a content type (text/plain by default).
    case text(String, status: Int = 200, contentType: String = "text/plain", headers: HTTPHeaders = HTTPHeaders())
    /// Bytes, with a content type.
    case bytes(Data, status: Int = 200, contentType: String = "application/octet-stream", headers: HTTPHeaders = HTTPHeaders())
    /// A status with an empty body.
    case status(Int, headers: HTTPHeaders = HTTPHeaders())
    /// A complete response.
    case response(HTTPResponse)
    /// The network fails (fetch's TypeError).
    case networkError(String = "fetch failed")
    /// The request's deadline passes at once.
    case timeout
    /// No answer: waits for the request's deadline (then times out) or for
    /// the task to be cancelled.
    case hang

    func resolve(for request: HTTPRequest) async throws -> HTTPResponse {
      switch self {
      case .json(let value, let status, let headers):
        var response = HTTPResponse.json(value, status: status, headers: headers, url: request.url)
        if status == 204 || status == 304 { response.body = Data() }
        return response
      case .text(let text, let status, let contentType, let headers):
        var all: HTTPHeaders = ["content-type": contentType]
        for field in headers { all.set(field.name, field.value) }
        return HTTPResponse(status: status, headers: all, body: Data(text.utf8), url: request.url)
      case .bytes(let data, let status, let contentType, let headers):
        var all: HTTPHeaders = ["content-type": contentType]
        for field in headers { all.set(field.name, field.value) }
        return HTTPResponse(status: status, headers: all, body: data, url: request.url)
      case .status(let status, let headers):
        return HTTPResponse(status: status, headers: headers, url: request.url)
      case .response(var response):
        if response.url.isEmpty { response.url = request.url }
        return response
      case .networkError(let message):
        throw HTTPTransportError.network(message)
      case .timeout:
        throw HTTPTransportError.timedOut
      case .hang:
        if let ms = request.timeoutMs {
          try await Task.sleep(nanoseconds: UInt64(max(0, min(ms, 9.0e12)) * 1_000_000))
          throw HTTPTransportError.timedOut
        }
        while true { try await Task.sleep(nanoseconds: 3_600_000_000_000) }
      }
    }
  }

  /// A request no route answered.
  public enum MockTransportError: Error, LocalizedError, CustomStringConvertible {
    case unexpectedRequest(HTTPRequest, routes: [String])

    public var description: String {
      switch self {
      case .unexpectedRequest(let request, let routes):
        let list = routes.isEmpty ? "  (none)" : routes.map { "  - \($0)" }.joined(separator: "\n")
        return "MockTransport: no route answers \(request)\nRoutes:\n\(list)"
      }
    }

    public var errorDescription: String? { description }
  }

  public struct Route: Sendable {
    public var method: String?
    public var matcher: Matcher
    /// How many requests it answers; nil for any number.
    public var times: Int?
    public var respond: @Sendable (HTTPRequest) async throws -> Response

    var summary: String {
      "\(method ?? "*") \(matcher)\(times.map { " (\($0) left)" } ?? "")"
    }
  }

  private struct State {
    var routes: [Route] = []
    var requests: [HTTPRequest] = []
    var unexpected: [HTTPRequest] = []
  }

  private let state = Locked(State())

  public init() {}

  /// Adds a route answering any method with a canned response.
  @discardableResult
  public func on(_ matcher: Matcher, times: Int? = nil, respond response: Response) -> MockTransport {
    add(nil, matcher, times: times) { _ in response }
  }

  /// Adds a route answering one method with a canned response.
  @discardableResult
  public func on(_ method: String, _ matcher: Matcher, times: Int? = nil, respond response: Response) -> MockTransport {
    add(method, matcher, times: times) { _ in response }
  }

  /// Adds a route answering any method from a closure, which sees the request.
  @discardableResult
  public func on(
    _ matcher: Matcher,
    times: Int? = nil,
    respond: @escaping @Sendable (HTTPRequest) async throws -> Response
  ) -> MockTransport {
    add(nil, matcher, times: times, respond: respond)
  }

  /// Adds a route answering one method from a closure.
  @discardableResult
  public func on(
    _ method: String,
    _ matcher: Matcher,
    times: Int? = nil,
    respond: @escaping @Sendable (HTTPRequest) async throws -> Response
  ) -> MockTransport {
    add(method, matcher, times: times, respond: respond)
  }

  private func add(
    _ method: String?,
    _ matcher: Matcher,
    times: Int?,
    respond: @escaping @Sendable (HTTPRequest) async throws -> Response
  ) -> MockTransport {
    state.withLock { $0.routes.append(Route(method: method?.uppercased(), matcher: matcher, times: times, respond: respond)) }
    return self
  }

  /// Every request sent, in order.
  public var requests: [HTTPRequest] { state.withLock { $0.requests } }

  /// The requests no route answered.
  public var unexpected: [HTTPRequest] { state.withLock { $0.unexpected } }

  /// The routes not used up yet.
  public var remainingRoutes: [String] { state.withLock { $0.routes.map(\.summary) } }

  /// Forgets the requests recorded so far (the routes stay).
  public func clearRequests() {
    state.withLock {
      $0.requests = []
      $0.unexpected = []
    }
  }

  public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let route: Route? = state.withLock { state in
      state.requests.append(request)
      guard
        let index = state.routes.firstIndex(where: { route in
          (route.method == nil || route.method == request.method) && route.matcher.matches(request)
        })
      else {
        state.unexpected.append(request)
        return nil
      }
      let route = state.routes[index]
      if let times = route.times {
        if times <= 1 { state.routes.remove(at: index) } else { state.routes[index].times = times - 1 }
      }
      return route
    }
    guard let route else {
      let routes = state.withLock { $0.routes.map(\.summary) }
      throw MockTransportError.unexpectedRequest(request, routes: routes)
    }
    try Task.checkCancellation()
    let answer = try await route.respond(request)
    return try await answer.resolve(for: request)
  }
}
