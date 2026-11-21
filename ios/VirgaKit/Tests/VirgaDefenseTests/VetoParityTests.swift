// src/defense/veto.js against the web code (ios/parity/cases/
// defense.veto.js), replayed from the exchanges the web made with the
// public AppView. Batches and lists are read side by side, so the requests
// are matched in any order.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.veto"

/// A Map as the fixture records it: its entries, sorted by code unit.
func entries(_ map: ReasonMap) -> JSONValue {
  .array(
    map.entries
      .sorted { Array($0.did.utf16).lexicographicallyPrecedes(Array($1.did.utf16)) }
      .map { [.string($0.did), .string($0.reason)] })
}

/// What the veto threw, as the fixture records it.
func vetoError(_ error: any Error) -> JSONValue {
  guard let e = error as? VetoUnreadable else { return ["$error": ["message": .string(jsMessage(error))]] }
  return [
    "$error": [
      "name": .string(e.name), "code": .string(e.code), "message": .string(e.message),
      "cause": e.cause.map { .string(jsMessage($0)) } ?? .null,
    ]
  ]
}

private func reasons(_ value: JSONValue?) -> ReasonMap {
  ReasonMap((value?.objectValue ?? [:]).sorted { $0.key < $1.key }.compactMap { k, v in v.stringValue.map { (k, $0) } })
}

private func limits(_ value: JSONValue?) -> Veto.CurationLimits {
  guard let value else { return Veto.curationLimits }
  return Veto.CurationLimits(lists: value["lists"]?.intValue ?? 20, membersPerList: value["membersPerList"]?.intValue ?? 5000)
}

@Suite struct VetoParity {
  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    let d = Parity.diff(["CURATION_LIMITS": .of(Veto.curationLimits)], c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }

  @Test func followedNow() async throws {
    for c in try Parity.cases(fixture, fn: "followedNow") {
      await expectReplay(c, ordered: false) { transport, _ in
        do {
          let out = try await Veto.followedNow(
            c.input["owner"]?.stringValue ?? "did:plc:owner",
            c["dids"].arrayValue?.compactMap(\.stringValue) ?? [],
            appview: c.input["appview"]?.stringValue ?? AppConfig.appview,
            transport: transport)
          return entries(out)
        } catch {
          return vetoError(error)
        }
      }
    }
  }

  @Test func curationMembers() async throws {
    for c in try Parity.cases(fixture, fn: "curationMembers") {
      await expectReplay(c, ordered: false) { transport, _ in
        do {
          let out = try await Veto.curationMembers(
            c.input["owner"]?.stringValue ?? "did:plc:owner",
            appview: c.input["appview"]?.stringValue ?? AppConfig.appview,
            transport: transport,
            limits: limits(c.input["limits"]))
          return entries(out)
        } catch {
          return vetoError(error)
        }
      }
    }
  }

  @Test func vetoed() async throws {
    for c in try Parity.cases(fixture, fn: "vetoed") {
      let given = c.input["curation"].map(reasons)
      let curation: Veto.Curation? = given.map { map in { @Sendable in map } }
      await expectReplay(c, ordered: false) { transport, _ in
        do {
          let out = try await Veto.vetoed(
            ownerDid: c.input["ownerDid"]?.stringValue,
            holderDid: c.input["holderDid"]?.stringValue,
            dids: c.input["dids"]?.arrayValue?.map(\.stringValue) ?? [],
            kept: reasons(c.input["kept"]),
            curation: curation,
            appview: c.input["appview"]?.stringValue ?? AppConfig.appview,
            transport: transport,
            limits: limits(c.input["limits"]))
          return entries(out)
        } catch {
          return vetoError(error)
        }
      }
    }
  }
}
