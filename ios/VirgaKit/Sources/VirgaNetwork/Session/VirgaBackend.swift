// Ports src/session/backendClient.js
//
// createBackendRequester: Virga's server's own API, /api/<area>/<action>,
// as one account (the token's). Scheduling, timers, the adviser, the terms
// and Defense are services over this (VirgaPosting, VirgaSession,
// VirgaDefense); APISurface.swift says which service calls each action.
//
// `request` resolves to the whole parsed body: the services read `.data`,
// `.moved` or `.unavailable` themselves, and the AI endpoints answer bare.
// A non-2xx answer, or `success: false`, throws BackendClient.requestError
// (status, code, detail, payload). A 401 goes to `onUnauthorized`, which
// decides (after confirming) whether the account must sign in again.

import Foundation
import VirgaCore

/// A request's query as the web writes it in an object literal, `{ name:
/// value }`, in order. A nil or null value is left out, an array is
/// repeated keys, anything else is `String(value)`. Used by VirgaBackend
/// (appendQuery) and PublicAppView.publicXrpc.
public struct QueryParams: Sendable, Hashable, ExpressibleByDictionaryLiteral {
  public struct Item: Sendable, Hashable {
    public var name: String
    public var value: JSONValue?
  }

  public var items: [Item]

  public init(_ items: [(String, JSONValue?)] = []) {
    self.items = items.map { Item(name: $0.0, value: $0.1) }
  }

  public init(dictionaryLiteral elements: (String, JSONValue?)...) {
    self.init(elements)
  }

  /// `appendQuery(url, query)`.
  func apply(to url: inout WebURL) {
    for item in items {
      guard let value = item.value, !value.isNull else { continue }
      if case .array(let values) = value {
        for element in values { url.appendSearchParam(item.name, element.jsString) }
      } else {
        url.setSearchParam(item.name, value.jsString)
      }
    }
  }
}

public struct VirgaBackend: Sendable {
  public var backendUrl: String?
  /// Reads the token at each request: another sign-in may have replaced it.
  public var token: @Sendable () -> String?
  /// The account the token is for.
  public var did: String?
  public var transport: any HTTPTransport
  public var onUnauthorized: (@Sendable (_ did: String?, _ code: JSONValue?) -> Void)?
  /// The page's origin, for a `backendUrl` of "" (not used by the app).
  public var origin: String?

  public static let defaultTimeoutMs: Double = 30_000

  public init(
    backendUrl: String?,
    token: @escaping @Sendable () -> String?,
    did: String?,
    transport: any HTTPTransport = HTTP.transport,
    onUnauthorized: (@Sendable (_ did: String?, _ code: JSONValue?) -> Void)? = nil,
    origin: String? = nil
  ) {
    self.backendUrl = backendUrl
    self.token = token
    self.did = did
    self.transport = transport
    self.onUnauthorized = onUnauthorized
    self.origin = origin
  }

  /// `requester.request(path, { method, query, body, timeoutMs })`. `body`
  /// nil sends none (`undefined`); `.null` sends `null`. A `timeoutMs` of 0
  /// is no deadline, as the web's `withDeadline` reads it.
  @discardableResult
  public func request(
    _ path: String,
    method: String = "GET",
    query: QueryParams? = nil,
    body: JSONValue? = nil,
    timeoutMs: Double = VirgaBackend.defaultTimeoutMs
  ) async throws -> JSONValue {
    var url = try BackendClient.backendAddress(backendUrl, path, origin: origin)
    query?.apply(to: &url)
    guard let bearer = token(), !bearer.isEmpty else {
      onUnauthorized?(did, BackendClient.noTokenEnvelope["code"])
      throw BackendClient.requestError(401, BackendClient.noTokenEnvelope)
    }
    var headers: HTTPHeaders = ["Authorization": "Bearer \(bearer)"]
    if body.isPresent { headers.set("Content-Type", "application/json") }
    let request = HTTPRequest(
      method: method, url: url.href, headers: headers,
      body: body.map { Data(JSONStringify.stringify($0).utf8) }, timeoutMs: backendDeadline(timeoutMs))
    let response: HTTPResponse
    do {
      response = try await transport.send(request)
    } catch {
      // The caller called it off: its own abort goes through as it is.
      if error is CancellationError || Task.isCancelled { throw CancellationError() }
      if case HTTPTransportError.timedOut = error {
        throw BackendError(message: "Virga’s server didn’t answer in time.", status: 0, code: "TIMEOUT")
      }
      throw BackendError(message: "Couldn’t reach Virga’s server.", status: 0, code: "NETWORK_ERROR")
    }
    let parsed = response.jsonOrNull()
    if !response.ok || parsed?["success"] == .bool(false) {
      if response.status == 401 {
        onUnauthorized?(did, parsed?["code"].truthy)
      }
      throw BackendClient.requestError(response.status, parsed)
    }
    return parsed ?? .null
  }

  /// A request with any Encodable as its JSON body.
  @discardableResult
  public func request<Body: Encodable>(
    _ path: String,
    method: String = "POST",
    query: QueryParams? = nil,
    encoding body: Body,
    timeoutMs: Double = VirgaBackend.defaultTimeoutMs
  ) async throws -> JSONValue {
    try await request(path, method: method, query: query, body: try JSONValue(encoding: body), timeoutMs: timeoutMs)
  }

  /// `/api/<area>/<action>`.
  public static func path(area: String, action: String) -> String { "/api/\(area)/\(action)" }

  /// A request to `/api/<area>/<action>`.
  @discardableResult
  public func request(
    area: String,
    action: String,
    method: String = "GET",
    query: QueryParams? = nil,
    body: JSONValue? = nil,
    timeoutMs: Double = VirgaBackend.defaultTimeoutMs
  ) async throws -> JSONValue {
    try await request(Self.path(area: area, action: action), method: method, query: query, body: body, timeoutMs: timeoutMs)
  }
}
