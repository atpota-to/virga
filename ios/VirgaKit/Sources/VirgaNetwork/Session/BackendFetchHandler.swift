// Ports src/session/backendClient.js
//
// createBackendFetchHandler: the fetch handler that sends an Agent's XRPC
// calls through Virga's server, as the account whose `vg_` token it holds.
// The Agent hands over `/xrpc/<nsid>?<query>` and the call's method,
// headers and body; the answer is an ordinary XRPC response, so every call
// (and every error's `.error` name) reads as it would against a PDS.
//
//   a call      → GET|POST <server>/api/oauth/proxy?<query>
//                 Authorization: Bearer vg_…, X-XRPC-Method: <nsid>,
//                 Content-Type: application/json, and X-Atproto-Proxy and
//                 Atproto-Accept-Labelers when the Agent set them
//   an upload   → POST <server>/api/oauth/upload-blob?encoding=<type>
//                 Authorization and Content-Type: application/octet-stream
//
// Exactly these headers: they are the ones the server's CORS preflight
// allows (server/http.js), which matters to the web when the server is on
// another origin and costs the app nothing to keep.
//
// The server answers in an envelope, `{ success: true, data }` or
// `{ success: false, error, code, ratelimit? }` with the upstream status
// (server/oauth/handlers/proxy.js, uploadBlob.js), which is unwrapped into
// the XRPC answer: `data` with 200, or `{ error: code, message: error }`
// with the status (502 for a failure that came back as a 200), the rate
// limit as headers.

import Foundation
import VirgaCore

public struct BackendFetchHandler: XRPCFetchHandler {
  public var backendUrl: String?
  /// Reads the token at each request: another sign-in may have replaced it.
  public var token: @Sendable () -> String?
  public var did: String?
  public var transport: any HTTPTransport
  /// Hears every 401, with the server's code.
  public var onUnauthorized: (@Sendable (_ did: String?, _ code: JSONValue?) -> Void)?
  /// Hears every answer that came back through the account's grant.
  public var onAuthorized: (@Sendable (_ did: String?) -> Void)?
  /// Each call's deadline (not an upload's).
  public var timeoutMs: Double
  /// The page's origin, for a `backendUrl` of "" (not used by the app).
  public var origin: String?

  public init(
    backendUrl: String?,
    token: @escaping @Sendable () -> String?,
    did: String? = nil,
    transport: any HTTPTransport = HTTP.transport,
    onUnauthorized: (@Sendable (_ did: String?, _ code: JSONValue?) -> Void)? = nil,
    onAuthorized: (@Sendable (_ did: String?) -> Void)? = nil,
    timeoutMs: Double = BackendClient.proxyTimeoutMs,
    origin: String? = nil
  ) {
    self.backendUrl = backendUrl
    self.token = token
    self.did = did
    self.transport = transport
    self.onUnauthorized = onUnauthorized
    self.onAuthorized = onAuthorized
    self.timeoutMs = timeoutMs
    self.origin = origin
  }

  /// A handler with a fixed token.
  public init(backendUrl: String?, token: String?, did: String? = nil, transport: any HTTPTransport = HTTP.transport) {
    self.init(backendUrl: backendUrl, token: { token }, did: did, transport: transport)
  }

  public func handle(_ request: XRPCHandlerRequest) async throws -> HTTPResponse {
    let u = try WebURL(request.path, base: "https://xrpc.invalid")
    let nsid = u.pathname.jsRemovingPrefix("/xrpc/")
    let upload = nsid.jsEquals("com.atproto.repo.uploadBlob")
    // `withDeadline(signal, ms)`: a call's own signal with no fallback, and
    // no deadline at all for a falsy `timeoutMs`.
    let deadline: Double? =
      upload ? (request.hasSignal ? nil : BackendClient.uploadFallbackTimeoutMs) : backendDeadline(timeoutMs)

    if BackendClient.binaryOutput.contains(where: { $0.jsEquals(nsid) }) {
      throw BackendError(
        name: "TypeError",
        message: "\(nsid) answers in bytes and can't go through Virga’s server; read it from the PDS directly.")
    }

    guard let bearer = token(), !bearer.isEmpty else {
      return unwrap(HTTPResponse.json(BackendClient.noTokenEnvelope, status: 401), pick: nil, authorized: false)
    }

    if upload {
      // `(type || '').split(';')[0].trim()`, by code unit.
      let mime = (request.headers.get("content-type") ?? "").jsBefore(firstUnit: 0x3B).jsTrimmed()
      // The server stores whatever type it is told; octet-stream would put
      // an untyped blob in the repo, which no post can use.
      if mime.isEmpty || mime == "application/octet-stream" {
        throw BackendError(name: "TypeError", message: "uploadBlob needs the blob’s real type (pass an encoding such as image/jpeg)")
      }
      var address = try BackendClient.backendAddress(backendUrl, BackendClient.BackendPaths.uploadBlob, origin: origin)
      address.setSearchParam("encoding", mime)
      let response = try await transport.send(
        HTTPRequest(
          method: "POST", url: address.href,
          headers: ["Authorization": "Bearer \(bearer)", "Content-Type": "application/octet-stream"],
          body: request.body, timeoutMs: deadline))
      return unwrap(response, pick: { data in
        if let blob = data?["blob"], blob.isTruthy { return ["blob": blob] }
        return data
      }, authorized: true)
    }

    var headers: HTTPHeaders = [
      "Authorization": "Bearer \(bearer)",
      "X-XRPC-Method": nsid,
      "Content-Type": "application/json",
    ]
    if let proxy = request.headers.get("atproto-proxy"), !proxy.isEmpty { headers.set("X-Atproto-Proxy", proxy) }
    if let labelers = request.headers.get("atproto-accept-labelers"), !labelers.jsTrimmed().isEmpty {
      headers.set("Atproto-Accept-Labelers", labelers)
    }
    let method = request.method.uppercased()
    let url = try BackendClient.backendAddress(backendUrl, BackendClient.BackendPaths.proxy, origin: origin).href + u.search
    let response = try await transport.send(
      HTTPRequest(
        method: method, url: url, headers: headers,
        body: method == "GET" || method == "HEAD" ? nil : request.body, timeoutMs: deadline))
    return unwrap(response, pick: nil, authorized: true)
  }

  /// `unwrapEnvelope`: the proxy's envelope as the XRPC answer the Agent reads.
  func unwrap(_ response: HTTPResponse, pick: ((JSONValue?) -> JSONValue?)?, authorized: Bool) -> HTTPResponse {
    let env = response.jsonOrNull()
    if response.ok, env?["success"]?.isTruthy == true {
      if authorized { onAuthorized?(did) }
      let data = env?["data"]
      let picked = pick.map { $0(data) } ?? data
      var body: JSONValue = [:]
      if let picked, !picked.isNull { body = picked }
      return HTTPResponse.json(body, status: 200)
    }
    if response.status == 401 {
      let code = env?["code"].truthy
      onUnauthorized?(did, code)
    }
    var headers = HTTPHeaders()
    // `Object.entries(env?.ratelimit || {})`: an object's members, an
    // array's elements by index.
    switch env?["ratelimit"].truthy {
    case .object(let members)?:
      for (name, value) in members.sorted(by: { $0.key < $1.key }) where !value.isNull { headers.set(name, value.jsString) }
    case .array(let items)?:
      for (index, value) in items.enumerated() where !value.isNull { headers.set(String(index), value.jsString) }
    case .string(let text)?:
      // A string's entries are its code units.
      for (index, unit) in text.utf16.enumerated() { headers.set(String(index), String(jsUnits: [unit])) }
    default:
      break
    }
    let status = response.ok ? 502 : (response.status == 0 ? 502 : response.status)
    let code = env?["code"].truthy
    let error: JSONValue = code ?? .string(status == 401 ? "AuthenticationRequired" : "BackendError")
    let message: JSONValue =
      env?["error"].truthy
      ?? .string(response.statusText.isEmpty ? "The request failed" : response.statusText)
    return HTTPResponse.json(["error": error, "message": message], status: status, headers: headers)
  }
}
