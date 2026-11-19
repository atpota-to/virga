// src/session/backendClient.js against network.backendClient and
// network.agent: Virga's server, the sign-in's request and return, the
// requester, and an Agent's calls through the server; and the API surface
// against api.surface.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaNetwork

/// An error as the generators record it: `{ name, message, status, code,
/// detail, payload }`.
func errorShape(_ error: any Error) -> JSONValue {
  if let backend = error as? BackendError { return backend.json }
  let name = (error is WebURLError) ? "TypeError" : "Error"
  return ["name": .string(name), "message": .string(jsMessage(error)), "status": .null, "code": .null, "detail": .null, "payload": .null]
}

@Suite struct BackendClientParity {
  @Test func constants() throws {
    let paths = try Parity.cases("network.backendClient", fn: "BACKEND_PATHS")[0]
    let actual: JSONValue = .object(Dictionary(uniqueKeysWithValues: BackendClient.BackendPaths.all.map { ($0.0, JSONValue.string($0.1)) }))
    #expect(Parity.diff(actual, paths.output) == nil)
    let key = try Parity.cases("network.backendClient", fn: "SIGNIN_PENDING_KEY")[0]
    #expect(Parity.diff(.string(BackendClient.signinPendingKey), key.output) == nil)
    let prompts = try Parity.cases("network.backendClient", fn: "SIGNIN_PROMPTS")[0]
    #expect(Parity.diff(.array(BackendClient.signinPrompts.map(JSONValue.string)), prompts.output) == nil)
  }

  @Test func backendAddress() throws {
    for c in try Parity.cases("network.backendClient", fn: "backendAddress") {
      let actual: JSONValue
      do {
        actual = .string(try BackendClient.backendAddress(c["backendUrl"].stringValue, c["path"].stringValue ?? "", origin: c["origin"].stringValue).href)
      } catch {
        actual = ["$throws": .string(jsMessage(error))]
      }
      #expect(Parity.diff(actual, c.output) == nil, "\(c) \(c.input)")
    }
  }

  @Test func signInPrompt() throws {
    for c in try Parity.cases("network.backendClient", fn: "signInPrompt") {
      let actual = BackendClient.signInPrompt(c["prompt"].stringValue).map(JSONValue.string) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func buildLoginRequest() throws {
    for c in try Parity.cases("network.backendClient", fn: "buildLoginRequest") {
      let actual: JSONValue
      do {
        let request = try BackendClient.buildLoginRequest(
          backendUrl: c["backendUrl"].stringValue, handle: c["handle"].stringValue ?? "", origin: c["origin"].stringValue ?? "",
          returnPath: c["returnPath"].stringValue ?? "", nonce: c["nonce"].stringValue ?? "", prompt: c["prompt"].stringValue,
          defense: c.input["defense"] ?? false)
        actual = ["url": .string(request.url), "returnUrl": .string(request.returnUrl)]
      } catch {
        actual = ["$throws": .string(jsMessage(error))]
      }
      let d = Parity.diff(actual, c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func readSigninPending() throws {
    for c in try Parity.cases("network.backendClient", fn: "readSigninPending") {
      let store = InMemoryKeyValueStore()
      if let stored = c["stored"].stringValue { try store.setItem(BackendClient.signinPendingKey, stored) }
      let actual = BackendClient.readSigninPending(store) ?? .null
      #expect(Parity.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func readBackendReturn() throws {
    for c in try Parity.cases("network.backendClient", fn: "readBackendReturn") {
      let location = BackendClient.ReturnLocation(
        pathname: c["location"]["pathname"]?.stringValue ?? "", search: c["location"]["search"]?.stringValue ?? "",
        hash: c["location"]["hash"]?.stringValue ?? "")
      let pending = c.input["pending"].nonNull
      let actual = BackendClient.readBackendReturn(location, pending, "/oauth/return")?.json ?? .null
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func strippedReturnAddress() throws {
    for c in try Parity.cases("network.backendClient", fn: "strippedReturnAddress") {
      let location = BackendClient.ReturnLocation(pathname: c["location"]["pathname"]?.stringValue ?? "")
      #expect(Parity.diff(.string(BackendClient.strippedReturnAddress(location)), c.output) == nil)
    }
  }

  @Test func requestError() throws {
    for c in try Parity.cases("network.backendClient", fn: "requestError") {
      let actual = BackendClient.requestError(c["status"].intValue ?? 0, c.input["body"]).json
      let d = Parity.diff(actual, c.output, strictNulls: true)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func request() async throws {
    for c in try Parity.cases("network.backendClient", fn: "request") {
      await expectReplay(c) { transport, _ in
        let heard = Heard()
        let token: String? = c.input["token"].map { $0.stringValue } ?? Fixed.token
        let backendUrl: String? = c.input["backendUrl"].map { $0.stringValue } ?? Fixed.server
        let backend = VirgaBackend(
          backendUrl: backendUrl, token: { token }, did: Fixed.did, transport: transport, onUnauthorized: heard.onUnauthorized)
        let options = c.input["options"]
        let query = options?["query"].map { QueryParams($0.ordered(by: c.input["queryKeys"])) }
        let unauthorized = { JSONValue.array(heard.unauthorized) }
        do {
          let body = try await backend.request(
            c["path"].stringValue ?? "", method: options?["method"]?.stringValue ?? "GET", query: query, body: options?["body"])
          return ["body": body, "unauthorized": unauthorized()]
        } catch {
          return ["error": errorShape(error), "unauthorized": unauthorized()]
        }
      }
    }
  }

  @Test func sessionCheck() async throws {
    for c in try Parity.cases("network.backendClient", fn: "sessionCheck") {
      await expectReplay(c) { transport, _ in
        let backendUrl: String? = c.input["backendUrl"].map { $0.stringValue } ?? Fixed.server
        let read =
          c["lite"].boolValue == true
          ? await BackendClient.checkBackendSession(backendUrl: backendUrl, token: Fixed.token, transport: transport)
          : await BackendClient.fetchBackendSession(backendUrl: backendUrl, token: Fixed.token, transport: transport)
        return read.json
      }
    }
  }

  @Test func backendSignOut() async throws {
    for c in try Parity.cases("network.backendClient", fn: "backendSignOut") {
      await expectReplay(c) { transport, recorder in
        let token: String? = c.input["token"].map { $0.stringValue } ?? Fixed.token
        let backendUrl: String? = c.input["backendUrl"].map { $0.stringValue } ?? Fixed.server
        let done = await BackendClient.backendSignOut(
          backendUrl: backendUrl, token: token, transport: transport, clock: recorder.clock,
          retryDelayMs: c["retryDelayMs"].doubleValue ?? BackendClient.logoutRetryMs, keepGrant: c["keepGrant"].boolValue ?? false)
        return .bool(done)
      }
    }
  }

  @Test func startBackendSignIn() async throws {
    for c in try Parity.cases("network.backendClient", fn: "startBackendSignIn") {
      await expectReplay(c) { transport, recorder in
        let storage = InMemoryKeyValueStore()
        let assigned = Locked<String?>(nil)
        var out: JSONValue = [:]
        do {
          _ = try await BackendClient.startBackendSignIn(
            backendUrl: Fixed.server, handle: c["handle"].stringValue ?? "mira.example.com",
            origin: c["origin"].stringValue ?? "https://virga.example", returnPath: "/oauth/return",
            intent: c["intent"].stringValue ?? "add", did: c["did"].stringValue, prompt: c["prompt"].stringValue,
            defense: c.input["defense"] ?? false, transport: transport, clock: recorder.clock,
            randomBytes: { count in (0..<count).map { UInt8(($0 * 37 + 11) & 0xFF) } },
            sessionStorage: storage, assign: { url in assigned.withLock { $0 = url } })
        } catch {
          out["error"] = errorShape(error)
        }
        out["assigned"] = assigned.withLock { $0 }.map(JSONValue.string) ?? .null
        out["stored"] = try storage.getItem(BackendClient.signinPendingKey).map { try JSONValue.parse($0) } ?? .null
        return out
      }
    }
  }
}

@Suite struct AgentParity {
  /// The parameters as the generator typed them from the lexicon.
  static func params(_ typed: JSONValue?) -> XRPCParams {
    var out = XRPCParams()
    for entry in typed?.arrayValue ?? [] {
      guard let name = entry[0]?.stringValue, let type = entry[1]?.stringValue, let value = entry[2], !value.isNull else { continue }
      out[name] = paramValue(type, value)
    }
    return out
  }

  static func paramValue(_ type: String, _ value: JSONValue) -> XRPCParamValue {
    if type.hasPrefix("array:") {
      let itemType = String(type.dropFirst(6))
      return .array((value.arrayValue ?? [value]).map { paramValue(itemType, $0) })
    }
    switch type {
    case "integer": return .integer(Int(value.jsNumber.rounded(.towardZero)))
    case "boolean": return .boolean(value.isTruthy)
    case "float": return .float(value.jsNumber)
    case "datetime": return .datetime(value.jsString)
    default: return .string(value.jsString)
    }
  }

  static func input(_ value: JSONValue?) -> XRPCAgent.Input? {
    guard let value else { return nil }
    if let bytes = value["bytes"]?.arrayValue { return .bytes(Data(bytes.compactMap { $0.intValue.map(UInt8.init) })) }
    if let text = value["text"]?.stringValue { return .text(text) }
    if let json = value["json"] { return .json(json) }
    return nil
  }

  static func outcome(_ heard: Heard?, _ body: () async throws -> XRPCResponse) async -> JSONValue {
    var out: JSONValue
    do {
      let response = try await body()
      let data: JSONValue
      switch response.body {
      case .json(let value): data = value
      case .text(let text): data = .string(text)
      case .bytes(let bytes): data = ["$bytes": .string(bytes.base64EncodedString())]
      }
      out = ["data": data, "headers": .object(response.headers.mapValues(JSONValue.string))]
    } catch let error as XRPCError {
      var shape = error.json
      shape["headers"] = error.headers.map { .object($0.mapValues(JSONValue.string)) } ?? .null
      out = ["error": shape]
    } catch {
      out = ["error": ["status": .null, "error": .null, "message": .string(jsMessage(error)), "headers": .null]]
    }
    if let heard {
      out["unauthorized"] = .array(heard.unauthorized)
      out["authorized"] = .array(heard.authorized)
    }
    return out
  }

  @Test func agentCall() async throws {
    for c in try Parity.cases("network.agent", fn: "agentCall") {
      await expectReplay(c) { transport, _ in
        let heard = Heard()
        let token: String? = c.input["token"].map { $0.stringValue } ?? Fixed.token
        let handler = BackendFetchHandler(
          backendUrl: c["backendUrl"].stringValue ?? Fixed.server, token: { token }, did: Fixed.did, transport: transport,
          onUnauthorized: heard.onUnauthorized, onAuthorized: heard.onAuthorized)
        var agent = XRPCAgent(did: Fixed.did, fetchHandler: handler)
        if let proxy = c.input["proxy"]?.arrayValue {
          agent = agent.withProxy(proxy[0].stringValue ?? "", proxy[1].stringValue ?? "")
        }
        if let labelers = c.input["labelers"]?.arrayValue { agent.configureLabelers(labelers.compactMap(\.stringValue)) }
        let opts = c.input["opts"]
        let options = XRPCAgent.CallOptions(
          headers: (opts?["headers"]?.objectValue ?? [:]).sorted { $0.key < $1.key }.map { ($0.key, $0.value.jsString) },
          encoding: opts?["encoding"]?.stringValue)
        let kind: XRPCAgent.Kind = c["kind"].stringValue == "procedure" ? .procedure : .query
        return await Self.outcome(heard) {
          try await agent.call(
            c["nsid"].stringValue ?? "", kind: kind, params: Self.params(c.input["typedParams"]), input: Self.input(c.input["input"]),
            options: options)
        }
      }
    }
  }

  @Test func fetchHandler() async throws {
    for c in try Parity.cases("network.agent", fn: "fetchHandler") {
      await expectReplay(c) { transport, _ in
        let heard = Heard()
        let handler = BackendFetchHandler(
          backendUrl: Fixed.server, token: { Fixed.token }, did: Fixed.did, transport: transport, onUnauthorized: heard.onUnauthorized,
          onAuthorized: heard.onAuthorized)
        let initValue = c["init"]
        var headers = HTTPHeaders()
        for (name, value) in (initValue["headers"]?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
          headers.set(name, value.jsString)
        }
        var body: Data?
        if let text = initValue["body"]?.stringValue { body = Data(text.utf8) }
        if let base64 = initValue["body"]?["$bytes"]?.stringValue { body = Data(base64Encoded: base64) }
        let response = try await handler.handle(
          XRPCHandlerRequest(path: c["url"].stringValue ?? "", method: initValue["method"]?.stringValue ?? "GET", headers: headers, body: body))
        return [
          "status": .number(Double(response.status)),
          "headers": .object(response.headers.canonical.mapValues(JSONValue.string)),
          "body": try response.json(),
          "unauthorized": .array(heard.unauthorized),
          "authorized": .array(heard.authorized),
        ]
      }
    }
  }

  @Test func serviceAgent() async throws {
    for c in try Parity.cases("network.agent", fn: "serviceAgent") {
      await expectReplay(c) { transport, _ in
        let agent = XRPCAgent(service: c["service"].stringValue ?? "", transport: transport)
        let kind: XRPCAgent.Kind = c["kind"].stringValue == "procedure" ? .procedure : .query
        return await Self.outcome(nil) {
          try await agent.call(c["nsid"].stringValue ?? "", kind: kind, params: Self.params(c.input["typedParams"]))
        }
      }
    }
  }
}

@Suite struct APISurfaceParity {
  /// Every area and action of Virga's server is classified: a new server
  /// route fails here until APISurface.swift says what the app does with it.
  @Test func registryCoversTheServerExactly() throws {
    let c = try Parity.cases("api.surface", fn: "areas")[0]
    let actual: JSONValue = .object(APISurface.areas.mapValues { .array($0.map(JSONValue.string)) })
    let d = Parity.diff(actual, c.output, strictNulls: true)
    #expect(d == nil, "APISurface.routes and the server's routers differ: \(d ?? "")")
  }

  @Test func eachRouteIsClassifiedOnce() {
    let keys = APISurface.routes.map { "\($0.area)/\($0.action)" }
    #expect(Set(keys).count == keys.count, "a route listed twice")
    for route in APISurface.routes {
      switch route.use {
      case .app(let service, let target, let web):
        #expect(!service.isEmpty && !target.isEmpty && web.hasPrefix("src/"), "\(route.path)")
      case .serverOnly(let reason):
        #expect(reason.count > 20, "\(route.path) needs a reason")
      }
    }
    #expect(APISurface.route(area: "oauth", action: "proxy")?.path == "/api/oauth/proxy")
  }
}
