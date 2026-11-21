// src/session/sessionController.js against session.controller: what an
// account can do from its row and status, how much of Defense a grant
// covers, and what a sign-in asks for (the driver's call for a browser one,
// the recorded request to Virga's server and what is kept for the return
// for a long one).

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaSession

private let fixture = "session.controller"

/// A row as the generator records one (`recordSignIn`'s fields and `at`).
private func recordRows(_ rows: JSONValue?, into storage: InMemoryKeyValueStore) {
  for row in rows?.arrayValue ?? [] {
    let scope: SignInScope = row["scope"]?.stringValue.map(SignInScope.granted) ?? .unsaid
    Accounts.recordSignIn(
      storage, did: row["did"]?.stringValue ?? "", mode: row["mode"]?.stringValue ?? "browser", handle: row["handle"]?.stringValue,
      scope: scope, now: row["at"]?.doubleValue ?? 0)
  }
}

/// `signInCase` in the generator, run against the port.
@MainActor
private func runSignIn(_ c: ParityCase, _ transport: MockTransport, _ clock: RecordingClock) async -> JSONValue {
  let storage = InMemoryKeyValueStore()
  let tabStorage = InMemoryKeyValueStore([Accounts.openAtSignInKey: "did:plc:stalestale"])
  recordRows(c.input["rows"], into: storage)
  let open = c["open"].stringValue
  if let open {
    Accounts.recordSignIn(storage, did: open, mode: "browser", now: 9)
    Accounts.writeActiveDid(storage, open)
  }
  let browser = FakeBrowser(sessions: open.map { [$0] } ?? [])
  let w = World(
    storage: storage, tabStorage: tabStorage, browser: browser, authMode: "backend", getProfile: { _ in nil }, transport: transport,
    clock: clock.clock)
  if open != nil { await w.ctrl.startOnce() }
  let o = c.input["options"]
  let options = SignInOptions(
    mode: o?["mode"]?.stringValue, intent: o?["intent"]?.stringValue ?? "add", prompt: o?["prompt"]?.stringValue,
    defense: o?["defense"], did: o?["did"]?.stringValue)
  var out: JSONValue = [:]
  if let error = await thrown({ try await w.ctrl.signIn(c["input"].stringValue, options) }) {
    let fields = JSErrorFields(error) ?? JSErrorFields(message: jsMessage(error))
    out["error"] = [
      "name": .string(fields.name), "message": .string(fields.message), "code": fields.code ?? .null,
      "status": fields.status.map { .number(Double($0)) } ?? .null,
    ]
  }
  out["browser"] = .array(
    browser.signIns.map { call in
      var options: JSONValue = ["scope": .string(call.scope), "intent": .string(call.intent)]
      var keys: [JSONValue] = ["scope", "intent"]
      if let prompt = call.prompt {
        options["prompt"] = .string(prompt)
        keys.append("prompt")
      }
      return ["input": .string(call.input), "options": options, "keys": .array(keys)]
    })
  out["assigned"] = w.heard.assigned.wrappedValue.last.map(JSONValue.string) ?? .null
  out["pending"] = tabStorage.getItem(BackendClient.signinPendingKey).flatMap { try? JSONValue.parse($0) } ?? .null
  out["openAtSignIn"] = tabStorage.getItem(Accounts.openAtSignInKey).map(JSONValue.string) ?? .null
  out["hint"] = storage.getItem(SessionHint.sessionHintKey).map(JSONValue.string) ?? .null
  out["openBefore"] = w.ctrl.active.did.map(JSONValue.string) ?? .null
  return out
}

@Suite struct SessionControllerParity {
  @Test func noActive() throws {
    let c = try Parity.cases(fixture, fn: "NO_ACTIVE")[0]
    let none = SessionController.noActive
    #expect(none.did == nil)
    #expect(none.agent == nil)
    #expect(none.session == nil)
    #expect(none.mode == nil)
    expectParity(["did": .null, "agent": .null, "session": .null, "mode": .null], c)
  }

  @Test func capabilitiesFrom() throws {
    let cases = try Parity.cases(fixture, fn: "capabilitiesFrom")
    #expect(cases.count > 100)
    for c in cases {
      let raw = c.input["row"]
      let row: AccountRow? =
        raw == nil || raw?.isNull == true
        ? nil
        : AccountRow(did: raw?["did"]?.stringValue ?? "", mode: raw?["mode"]?.stringValue ?? "", scope: raw?["scope"]?.stringValue)
      let status = c["status"].stringValue.flatMap(AccountStatus.init(rawValue:))
      let d = Parity.diff(.of(SessionController.capabilitiesFrom(row, status)), c.output, strictNulls: true)
      #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
    }
  }

  @Test func grantedDefenseLevel() throws {
    for c in try Parity.cases(fixture, fn: "grantedDefenseLevel") {
      let granted = c.input["granted"]?.stringValue
      let level = SessionController.grantedDefenseLevel(granted)
      let actual: JSONValue = [
        "holdsDefense": .bool(SessionController.holdsDefense(granted)),
        "grantedDefenseLevel": level.map { .string($0.rawValue) } ?? .bool(false),
      ]
      expectParity(actual, c)
    }
  }

  @Test func signIn() async throws {
    let cases = try Parity.cases(fixture, fn: "signIn")
    #expect(cases.count > 60)
    for c in cases {
      await expectReplay(c) { transport, clock in await runSignIn(c, transport, clock) }
    }
  }
}
