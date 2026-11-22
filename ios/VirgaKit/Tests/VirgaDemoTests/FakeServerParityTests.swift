// Parity with harness/fakeServer.js (the session, the terms ledger and the
// proxy's refusals) and with the real server's proxy pieces the iOS proxy
// is made of, against ios/parity/fixtures/demo-network.fakeServer.json.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct FakeServerParity {
  static let fixture = "demo-network.fakeServer"

  static func fill(_ text: String, _ tokens: [String]) -> String {
    var out = text
    for (i, token) in tokens.enumerated().reversed() { out = out.replacingOccurrences(of: "$t\(i)", with: token) }
    return out
  }

  /// One scenario on one server, as the generator's `serverScenario`.
  static func scenario(_ c: ParityCase) async -> [JSONValue] {
    let clock = Locked(DemoNetwork.now)
    let server = DemoServer(
      world: DemoNetwork.world(), terms: c["terms"].stringValue ?? "agreed", seed: false, now: { clock.wrappedValue },
      randomBytes: RepeatableBytes().generator)
    var tokens: [String] = []
    var out: [JSONValue] = []
    for step in c["steps"].arrayValue ?? [] {
      if let did = step["mint"]?.stringValue {
        tokens.append(server.mintToken(did))
        out.append(["token": .string(tokens[tokens.count - 1])])
      } else if let did = step["refuse"]?.stringValue {
        server.refuseGrant(did)
        out.append(.null)
      } else if let did = step["expire"]?.stringValue {
        server.expireAccount(did)
        out.append(.null)
      } else if let ms = step["advance"]?.doubleValue {
        clock.withLock { $0 += ms }
        out.append(.null)
      } else {
        var request = DemoNetwork.request(step)
        var headers = HTTPHeaders()
        for field in request.headers { headers.append(field.name, fill(field.value, tokens)) }
        request.headers = headers
        if let text = step["text"]?.stringValue { request.body = Data(fill(text, tokens).utf8) }
        out.append(DemoNetwork.answerOf(await server.route(request)))
      }
    }
    return out
  }

  @Test func theServersAnswers() async throws {
    let cases = try Parity.cases(Self.fixture, fn: "server")
    #expect(cases.count == 5)
    for c in cases {
      let got = await Self.scenario(c)
      let want = c.output.arrayValue ?? []
      #expect(got.count == want.count, "\(c)")
      for (i, (a, b)) in zip(got, want).enumerated() {
        let d = Exact.diff(a, b)
        #expect(d == nil, "\(c) #\(i) \(c["steps"][i]?.jsonString().prefix(160) ?? ""): \(d ?? "")")
      }
    }
  }

  /// The forwarded calls, through the iOS proxy as the account's token.
  static func forward(_ c: ParityCase) async -> [JSONValue] {
    let server = DemoServer(world: DemoNetwork.world(c["search"].stringValue ?? ""), now: { DemoNetwork.now })
    let token = server.mintToken(World.me.did)
    var out: [JSONValue] = []
    for step in c["steps"].arrayValue ?? [] {
      let query = step["query"]?.stringValue ?? ""
      var headers = HTTPHeaders()
      for (name, value) in (step["headers"]?.objectValue ?? [:]).sorted(by: { $0.key < $1.key }) {
        headers.append(name, value.stringValue ?? "")
      }
      headers.set("authorization", "Bearer \(token)")
      let request: HTTPRequest
      if step["upload"]?.isTruthy == true {
        headers.set("content-type", "application/octet-stream")
        let bytes = (step["bytes"]?.arrayValue ?? []).map { UInt8($0.doubleValue ?? 0) }
        request = HTTPRequest(
          method: "POST", url: "\(FakeServer.serverOrigin)/api/oauth/upload-blob?\(query)", headers: headers, body: Data(bytes))
      } else {
        headers.set("content-type", "application/json")
        request = HTTPRequest(
          method: step["method"]?.stringValue ?? "GET", url: "\(FakeServer.serverOrigin)/api/oauth/proxy?\(query)",
          headers: headers, body: step["text"]?.stringValue.map { Data($0.utf8) })
      }
      let answer = await server.route(request)
      let body = answer.flatMap { try? JSONValue.parse($0.body) } ?? .null
      out.append(["status": .number(Double(answer?.status ?? 0)), "body": DemoNetwork.shrink(body)])
    }
    return out
  }

  @Test func theProxyForwardsAsTheServersPiecesDo() async throws {
    let cases = try Parity.cases(Self.fixture, fn: "forward")
    #expect(cases.count == 2)
    for c in cases {
      let got = await Self.forward(c)
      let want = c.output.arrayValue ?? []
      #expect(got.count == want.count, "\(c)")
      for (i, (a, b)) in zip(got, want).enumerated() {
        let d = Exact.diff(a, b)
        #expect(d == nil, "\(c) #\(i) \(c["steps"][i]?.jsonString().prefix(160) ?? ""): \(d ?? "")")
      }
    }
  }

  @Test func forwardedQuery() throws {
    for c in try Parity.cases(Self.fixture, fn: "forwardedQuery") {
      let query = FakeServer.forwardedQuery(JSURI.parseSearchParams(c["query"].stringValue ?? ""))
      let d = Exact.diff(DemoNetwork.toJSON(query), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func isSafeXrpcMethod() throws {
    for c in try Parity.cases(Self.fixture, fn: "isSafeXrpcMethod") {
      #expect(.bool(FakeServer.isSafeXrpcMethod(c.input["method"]?.stringValue)) == c.output, "\(c)")
    }
  }

  @Test func httpStatusForXrpcError() throws {
    for c in try Parity.cases(Self.fixture, fn: "httpStatusForXrpcError") {
      let status = c.input["status"]?.intValue
      #expect(.number(Double(FakeServer.httpStatusForXrpcError(status))) == c.output, "\(c)")
    }
  }
}
