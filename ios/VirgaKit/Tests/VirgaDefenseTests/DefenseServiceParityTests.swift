// src/defense/defenseService.js against the web code (ios/parity/cases/
// defense.service.js): every call replayed from the exchanges the web's
// requester made with Virga's server, and defenseErrorMessage word for word.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaDefense

private let fixture = "defense.service"
private let server = "https://server.example"
private let token = "vg_" + String(repeating: "0f", count: 32)
private let did = "did:plc:virgaharnessmira2zq4x"

/// What a call threw, as the fixture records it.
private func thrown(_ error: any Error) -> JSONValue {
  let fields = JSErrorFields(error)
  return [
    "$error": [
      "name": .string(fields?.name ?? "Error"), "message": .string(fields?.message ?? jsMessage(error)),
      "code": fields?.code ?? .null, "status": fields?.status.map { .number(Double($0)) } ?? .null,
    ]
  ]
}

private func call(_ fn: String, _ req: VirgaBackend?, _ a: JSONValue) async throws -> JSONValue {
  switch fn {
  case "fetchLists": return try await DefenseService.fetchLists(req)
  case "createList":
    return try await DefenseService.createList(
      req, name: a["name"]?.stringValue, purpose: a["purpose"]?.stringValue, description: a["description"]?.stringValue)
  case "keepAccount": return try await DefenseService.keepAccount(req, a["did"]?.stringValue ?? "", a["reason"]?.stringValue)
  case "unkeepAccount": return try await DefenseService.unkeepAccount(req, a["did"]?.stringValue ?? "")
  case "planAndApprove":
    return try await DefenseService.planAndApprove(
      req, listId: a["listId"] ?? .null, postUri: a["postUri"]?.stringValue, rows: a["rows"] ?? .null,
      totals: a["totals"] ?? .null, bands: a["bands"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      note: a["note"]?.stringValue)
  case "fetchHistory": return try await DefenseService.fetchHistory(req, before: a["before"], list: a["list"]?.stringValue)
  case "undoAdds":
    return try await DefenseService.undoAdds(req, planId: a["planId"], ids: a["ids"]?.arrayValue, note: a["note"]?.stringValue)
  case "fetchLink": return try await DefenseService.fetchLink(req)
  case "makeLinkCode": return try await DefenseService.makeLinkCode(req)
  case "unlinkModerator": return try await DefenseService.unlinkModerator(req)
  case "chooseLinkList": return try await DefenseService.chooseLinkList(req, a["listId"])
  default: throw ParityError.noCases(fixture: fixture, fn: fn)
  }
}

@Suite struct DefenseServiceParity {
  static let calls = [
    "fetchLists", "createList", "keepAccount", "unkeepAccount", "planAndApprove", "fetchHistory", "undoAdds",
    "fetchLink", "makeLinkCode", "unlinkModerator", "chooseLinkList",
  ]

  @Test(arguments: calls) func replays(_ fn: String) async throws {
    for c in try Parity.cases(fixture, fn: fn) {
      await expectReplay(c) { transport, _ in
        let req =
          c["noBackend"].boolValue == true
          ? nil : VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport)
        do {
          return ["value": try await call(fn, req, c["args"])]
        } catch {
          return thrown(error)
        }
      }
    }
  }

  @Test func defenseErrorMessage() throws {
    for c in try Parity.cases(fixture, fn: "defenseErrorMessage") {
      let error = c["error"]
      let message = error.isNull ? DefenseService.defenseErrorMessage(nil) : DefenseService.defenseErrorMessage(JSError(json: error))
      let d = Parity.diff(.string(message), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func readsTheCodeOfAnyError() {
    let needs = DefenseService.needsBackend()
    #expect(DefenseService.defenseErrorMessage(needs).hasPrefix("Defense’s lists need a long session"))
    #expect(DefenseService.defenseErrorMessage(BackendError(message: "m", status: 503, code: "UNAVAILABLE")) == "Defense isn’t set up on Virga’s server yet.")
    #expect(DefenseService.defenseErrorMessage(CancellationError()) == "This operation was aborted")
  }
}
