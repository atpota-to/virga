// Parity with harness/fakeXrpc.js, against
// ios/parity/fixtures/demo-network.fakeXrpc.json: the scope each call needs,
// the service tokens, and an agent's answers to scenarios of calls on fresh
// worlds, refusals word for word.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct FakeXrpcParity {
  static let fixture = "demo-network.fakeXrpc"

  static func check(_ actual: JSONValue, _ c: ParityCase) {
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  static func caught(_ body: () throws -> JSONValue) -> JSONValue {
    do { return try body() } catch { return ["$throws": .string(jsMessage(error))] }
  }

  @Test func draftLimit() throws {
    Self.check(.number(Double(FakeXrpc.draftLimit)), try Parity.cases(Self.fixture, fn: "DRAFT_LIMIT")[0])
  }

  @Test func scopesFor() throws {
    let cases = try Parity.cases(Self.fixture, fn: "scopesFor")
    #expect(cases.count > 200)
    for c in cases {
      let out = Self.caught {
        .array(try FakeXrpc.scopesFor(c["nsid"].stringValue ?? "", c.input["input"], c.input["opts"]).map(JSONValue.string))
      }
      Self.check(out, c)
    }
  }

  @Test func mintServiceToken() throws {
    for c in try Parity.cases(Self.fixture, fn: "mintServiceToken") {
      let claims = c["claims"]
      let out = Self.caught {
        .string(try FakeXrpc.mintServiceToken(iss: claims["iss"], aud: claims["aud"], lxm: claims["lxm"], exp: claims["exp"]))
      }
      Self.check(out, c)
    }
  }

  @Test func readServiceToken() throws {
    for c in try Parity.cases(Self.fixture, fn: "readServiceToken") {
      Self.check(FakeXrpc.readServiceToken(c.input["token"]?.stringValue) ?? .null, c)
    }
  }

  /// Ids the agent minted, as `$minted#<n>`.
  static func scrub(_ value: JSONValue, _ minted: [String]) -> JSONValue {
    switch value {
    case .string(let text):
      guard let i = minted.firstIndex(where: { $0.jsEquals(text) }) else { return value }
      return .string("$minted#\(i)")
    case .array(let items): return .array(items.map { scrub($0, minted) })
    case .object(let members): return .object(members.mapValues { scrub($0, minted) })
    default: return value
    }
  }

  /// One scenario, as the generator runs it.
  static func run(_ c: ParityCase) async throws -> JSONValue {
    let world = DemoNetwork.world(c["search"].stringValue ?? "")
    let did = c["did"].stringValue ?? World.me.did
    let agent = FakeAgent(
      world: world, did: did, appview: c["appview"].stringValue ?? "ok", sweepCounter: FakeXrpc.memoryCounter(),
      clock: .instant(now: DemoNetwork.now), tids: TIDClock(clockId: 0))
    var minted: [String] = []
    var out: [JSONValue] = []
    for s in c["steps"].arrayValue ?? [] {
      let target = s["proxy"]?.isTruthy == true ? agent.withProxy("bsky_appview", "did:web:api.bsky.app") : agent
      var input: FakeXrpc.Input = .none
      if let bytes = s["bytes"]?.arrayValue {
        input = .bytes(bytes.map { UInt8($0.doubleValue ?? 0) })
      } else if let given = s["input"] {
        input = .json(given)
      }
      if let from = s["swapFrom"]?.intValue, case .json(var given) = input {
        given["swapRecord"] = out[from]["result"]?["data"]?["cid"] ?? .null
        input = .json(given)
      }
      let nsid = s["nsid"]?.stringValue ?? ""
      let opts = s["opts"]
      out.append(
        await DemoNetwork.outcome({ answer in
          if nsid == "app.bsky.draft.createDraft", case .string(let id)? = answer["data"]?["id"] { minted.append(id) }
          return scrub(answer, minted)
        }) {
          DemoNetwork.json(try await target.handle(nsid, input, opts))
        })
    }
    return .array(out)
  }

  @Test func agentScenarios() async throws {
    let cases = try Parity.cases(Self.fixture, fn: "agent")
    #expect(cases.count >= 7)
    for c in cases {
      let actual = try await Self.run(c)
      guard case .array(let got) = actual, case .array(let want) = c.output else {
        Issue.record("\(c): not a list")
        continue
      }
      #expect(got.count == want.count, "\(c): \(got.count) steps, expected \(want.count)")
      for (i, (a, b)) in zip(got, want).enumerated() {
        let d = Exact.diff(a, b)
        #expect(d == nil, "\(c) step \(i) \(c["steps"][i]?.jsonString().prefix(200) ?? ""): \(d ?? "")")
      }
    }
  }
}
