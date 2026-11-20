// useTermsAcceptance as TermsAcceptanceModel: what the agreement screen does
// for a long session and a browser one, against Virga's server stood in for.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

private let server = "https://virga.example"
private let mira = "did:plc:abcdefghijklmnopqrstuvwx"
private let lab = "did:plc:virgaharnesslab7k2pq"
private let token = "vg_" + String(repeating: "0f", count: 32)

/// Waits (yielding) until `condition` holds, for at most a couple of seconds.
@MainActor
func eventually(_ condition: @MainActor () -> Bool) async -> Bool {
  for _ in 0..<2000 {
    if condition() { return true }
    try? await Task.sleep(nanoseconds: 1_000_000)
  }
  return condition()
}

/// Calls to a reporter, across tasks.
final class Reports: @unchecked Sendable {
  let calls = Locked<[String]>([])
  let error: (any Error)?

  init(error: (any Error)? = nil) {
    self.error = error
  }

  var reporter: TermsAcceptanceModel.Reporter {
    { [self] did, version in
      calls.withLock { $0.append("\(did)@\(version)") }
      if let error { throw error }
    }
  }
}

@MainActor
@Suite(.serialized) struct TermsAcceptanceModelTests {
  init() {
    TermsAcceptanceModel.reported.set([])
  }

  func requester(_ transport: MockTransport) -> @MainActor (String) -> VirgaBackend? {
    { did in VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport) }
  }

  @Test func aLongSessionWithANoteGoesStraightIn() {
    let store = InMemoryKeyValueStore()
    Acceptance.writeAcceptance(store, mira, at: "2026-11-14T10:00:00Z", recorded: true, identity: "session")
    let transport = MockTransport()
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: store, backendFor: requester(transport), reporter: Reports().reporter)
    #expect(model.status == .accepted)
    #expect(transport.requests.isEmpty)
  }

  @Test func aLongSessionWithNoNoteAsksTheServer() async {
    let store = InMemoryKeyValueStore()
    let transport = MockTransport()
    transport.on(.path("/api/terms/status"), respond: .json(["success": true, "accepted": true, "version": 1, "acceptedAt": "2026-11-14T10:00:00Z"]))
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: store, backendFor: requester(transport), reporter: Reports().reporter)
    #expect(model.status == .checking)
    #expect(await eventually { model.status == .accepted })
    #expect(Acceptance.readAcceptance(store, mira) == TermsAcceptanceNote(at: "2026-11-14T10:00:00Z", recorded: true, identity: "session"))
  }

  @Test func theScreenShowsWhenTheServerCantSayOrSaysNo() async {
    for answer: MockTransport.Response in [.networkError("fetch failed"), .json(["success": true, "accepted": false]), .json(["success": true, "accepted": true, "version": 2])] {
      let store = InMemoryKeyValueStore()
      let transport = MockTransport()
      transport.on(.path("/api/terms/status"), respond: answer)
      let model = TermsAcceptanceModel(
        did: mira, mode: "backend", storage: store, backendFor: requester(transport), reporter: Reports().reporter)
      #expect(await eventually { model.status == .needs })
      #expect(Acceptance.readAcceptance(store, mira) == nil)
    }
  }

  @Test func aLongSessionWhoseTokenHasGoneCantAgree() async {
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: InMemoryKeyValueStore(), backendFor: { _ in nil }, reporter: Reports().reporter)
    #expect(model.status == .needs)
    await #expect(throws: JSError.self) { try await model.accept() }
    do {
      try await model.accept()
    } catch {
      #expect(JSErrorFields(error)?.codeString == "FRONTEND_SESSION_INVALID")
      #expect(Acceptance.acceptFailure(error).text.hasPrefix("Virga’s server didn’t recognise"))
    }
    #expect(model.status == .needs)
  }

  @Test func agreeingOnALongSessionWaitsForTheRow() async throws {
    let store = InMemoryKeyValueStore()
    let transport = MockTransport()
    transport.on(.path("/api/terms/status"), respond: .json(["success": true, "accepted": false]))
    transport.on("POST", .path("/api/terms/accept"), respond: .json(["success": true, "identity": "session", "acceptedAt": "2026-11-20T00:00:00Z"]))
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: store, backendFor: requester(transport), reporter: Reports().reporter)
    #expect(await eventually { model.status == .needs })
    try await model.accept()
    #expect(model.status == .accepted)
    #expect(Acceptance.readAcceptance(store, mira)?.identity == "session")
    let posted = try #require(transport.requests.last)
    #expect(posted.url == "\(server)/api/terms/accept")
    #expect(String(decoding: posted.body ?? Data(), as: UTF8.self) == "{\"version\":1}")
  }

  @Test func aRefusedRowLeavesTheScreenUp() async {
    let transport = MockTransport()
    transport.on(.path("/api/terms/status"), respond: .json(["success": true, "accepted": false]))
    transport.on("POST", .path("/api/terms/accept"), respond: .json(["success": false, "code": "TERMS_VERSION_MISMATCH", "error": "changed"], status: 409))
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: InMemoryKeyValueStore(), backendFor: requester(transport), reporter: Reports().reporter)
    #expect(await eventually { model.status == .needs })
    do {
      try await model.accept()
      Issue.record("accept should have thrown")
    } catch {
      #expect(Acceptance.acceptFailure(error).reload)
    }
    #expect(model.status == .needs)
  }

  @Test func aBrowserSessionAgreesAtOnceAndReportsAfter() async throws {
    let store = InMemoryKeyValueStore()
    let reports = Reports()
    let model = TermsAcceptanceModel(
      did: mira, mode: "browser", storage: store, backendFor: { _ in nil }, reporter: reports.reporter,
      now: { Date(timeIntervalSince1970: 1_773_576_000) })
    #expect(model.status == .needs)
    try await model.accept()
    #expect(model.status == .accepted)
    #expect(await eventually { Acceptance.readAcceptance(store, mira)?.recorded == true })
    #expect(Acceptance.readAcceptance(store, mira) == TermsAcceptanceNote(at: "2026-03-15T12:00:00.000Z", recorded: true, identity: "claimed"))
    #expect(reports.calls.wrappedValue == ["\(mira)@1"])
  }

  @Test func anUnreportedAgreementIsOfferedAgainOnce() async {
    let store = InMemoryKeyValueStore()
    Acceptance.writeAcceptance(store, mira, at: "2026-11-14T10:00:00Z", tries: 2)
    let reports = Reports(error: JSError(message: "down", code: "UNAVAILABLE", status: 503))
    let model = TermsAcceptanceModel(did: mira, mode: "browser", storage: store, backendFor: { _ in nil }, reporter: reports.reporter)
    #expect(model.status == .accepted)
    #expect(await eventually { Acceptance.readAcceptance(store, mira)?.tries == 3 })
    // A second model in the same run doesn't offer it again.
    _ = TermsAcceptanceModel(did: mira, mode: "browser", storage: store, backendFor: { _ in nil }, reporter: reports.reporter)
    try? await Task.sleep(nanoseconds: 20_000_000)
    #expect(reports.calls.wrappedValue.count == 1)
  }

  @Test func aServerThatRefusesClaimsIsLeftAlone() async {
    let store = InMemoryKeyValueStore()
    Acceptance.writeAcceptance(store, mira)
    let reports = Reports(error: JSError(message: "no", code: "SESSION_REQUIRED", status: 401))
    _ = TermsAcceptanceModel(did: mira, mode: "browser", storage: store, backendFor: { _ in nil }, reporter: reports.reporter)
    #expect(await eventually { Acceptance.readAcceptance(store, mira)?.tries == Acceptance.maxReportTries })
    #expect(Acceptance.needsReport(Acceptance.readAcceptance(store, mira)) == false)
  }

  @Test func switchingAccountsDecidesAfresh() async {
    let store = InMemoryKeyValueStore()
    Acceptance.writeAcceptance(store, mira, recorded: true, identity: "session")
    let transport = MockTransport()
    transport.on(.path("/api/terms/status"), respond: .json(["success": true, "accepted": false]))
    let model = TermsAcceptanceModel(
      did: mira, mode: "backend", storage: store, backendFor: requester(transport), reporter: Reports().reporter)
    #expect(model.status == .accepted)
    model.update(did: lab, mode: "backend")
    #expect(model.status == .checking)
    #expect(await eventually { model.status == .needs })
    model.update(did: mira, mode: "backend")
    #expect(model.status == .accepted)
    model.update(did: nil, mode: nil)
    #expect(model.status == .accepted)
  }

  @Test func anotherWindowsAgreementLetsThisOneIn() async {
    let store = InMemoryKeyValueStore()
    let model = TermsAcceptanceModel(did: mira, mode: "browser", storage: store, backendFor: { _ in nil }, reporter: Reports().reporter)
    #expect(model.status == .needs)
    model.storageChanged(key: Acceptance.termsKey(mira))
    #expect(model.status == .needs)
    Acceptance.writeAcceptance(store, mira, recorded: true, identity: "claimed")
    model.storageChanged(key: "virga:something-else")
    #expect(model.status == .needs)
    model.storageChanged(key: Acceptance.termsKey(mira))
    #expect(model.status == .accepted)
  }

  @Test func aLongSessionIsNotLetInOnABrowserSessionsNote() {
    let store = InMemoryKeyValueStore()
    Acceptance.writeAcceptance(store, mira, recorded: true, identity: "claimed")
    let model = TermsAcceptanceModel(did: mira, mode: "backend", storage: store, backendFor: { _ in nil }, reporter: Reports().reporter)
    #expect(model.status == .needs)
    model.storageChanged(key: Acceptance.termsKey(mira))
    #expect(model.status == .needs)
  }
}
