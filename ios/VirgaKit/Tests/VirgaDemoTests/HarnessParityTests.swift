// Parity with harness/harness.js, against
// ios/parity/fixtures/demo-world.harness.json: the read-only scope,
// withDefense at every level, and the worlds createHarness builds for the
// address flags (their scope and PDS), grantOf and regrant, through
// DemoWorld.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct HarnessParity {
  static let fixture = "demo-world.harness"

  static func check(_ actual: JSONValue, _ c: ParityCase) {
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(c) \(c.input.jsonString().prefix(200)): \(d ?? "")")
  }

  /// A JavaScript `level` as withDefense reads it: `'lists'`, else any
  /// truthy value grants the read, else nothing.
  static func level(_ value: JSONValue?) -> Harness.DefenseLevel {
    if case .string(let text)? = value, text == "lists" { return .lists }
    return value?.isTruthy == true ? .scan : .none
  }

  @Test func readOnlyScope() throws {
    Self.check(.string(Harness.readOnlyScope), try Parity.cases(Self.fixture, fn: "READ_ONLY_SCOPE")[0])
  }

  @Test func withDefense() throws {
    let cases = try Parity.cases(Self.fixture, fn: "withDefense")
    #expect(cases.count == 64)
    for c in cases {
      Self.check(.string(Harness.withDefense(c["scope"].stringValue, Self.level(c.input["level"]))), c)
    }
  }

  @Test func theWorldsForEachSetOfFlags() throws {
    let cases = try Parity.cases(Self.fixture, fn: "createHarness")
    #expect(cases.count == 8)
    let dids = [World.me.did, World.lab.did, "did:plc:nobody"]
    for c in cases {
      let scope = Harness.grantedScope(scope: c["scope"].stringValue, defense: c["defense"].stringValue)
      let demo = DemoWorld(
        now: DemoFixtures.now, accounts: c["accounts"].stringValue == "1" ? [World.me] : [World.me, World.lab],
        scope: scope)
      var out: [String: JSONValue] = [
        "scope": .string(demo.scope),
        "worlds": .array(
          demo.worlds.map { w in
            ["did": .string(w.me.did), "scope": w.scope.map(JSONValue.string) ?? .null,
             "pdsUrl": w.pdsUrl.map(JSONValue.string) ?? .null]
          }),
        "grants": .array(dids.map { .string(demo.grantOf($0)) }),
      ]
      let regrants: [(String, JSONValue)] = [
        (World.me.did, "lists"), (World.me.did, true), (World.lab.did, "lists"), (World.me.did, false),
        ("did:plc:nobody", "scan"),
      ]
      out["regrants"] = .array(
        regrants.map { did, defense in
          do {
            return .string(try demo.regrant(did, defense: Self.level(defense)))
          } catch {
            return ["$throws": .string(error.localizedDescription)]
          }
        })
      out["grantsAfter"] = .array(dids.map { .string(demo.grantOf($0)) })
      Self.check(.object(out), c)
    }
  }

  @Test func aWorldBuiltAloneHasNoGrant() {
    let world = World.buildWorld(now: DemoFixtures.now, account: World.lab)
    #expect(world.scope == nil && world.pdsUrl == nil)
    let demo = DemoWorld(worlds: [world], scope: Harness.readOnlyScope)
    #expect(demo.world(World.lab.did)?.scope == nil)
    #expect(demo.grantOf(World.lab.did) == Harness.readOnlyScope)
    #expect(Harness.defaultScope == AppConfig.oauthScope)
  }
}
