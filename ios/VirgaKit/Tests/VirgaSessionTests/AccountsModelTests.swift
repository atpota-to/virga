// usePendingWork as PendingWorkModel, readPendingWork, and usePendingReauth
// as PendingReauthModel: the waiting work a sign-out would stop, and the
// short notice before an account is signed in again.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaSession

private let server = "https://virga.example"
private let mira = "did:plc:virgaharnessmira2zq4x"
private let lab = "did:plc:virgaharnesslab7k2pq"
private let token = "vg_" + String(repeating: "ab", count: 32)

/// The posting services, as VirgaPosting will supply them: the two lists
/// read through the requester, and their predicates.
private func services() -> PendingWorkServices {
  PendingWorkServices(
    listScheduled: { req in try await req.request("/api/schedule/list")["data"]?.arrayValue ?? [] },
    listTimers: { req in try await req.request("/api/self-destruct/list")["data"]?.arrayValue ?? [] },
    isActiveScheduledRow: { ["pending", "publishing"].contains($0["status"]?.stringValue ?? "") },
    isLiveTimer: { ["armed", "checking"].contains($0["status"]?.stringValue ?? "") })
}

private func requester(_ transport: MockTransport, did: String = mira) -> VirgaBackend {
  VirgaBackend(backendUrl: server, token: { token }, did: did, transport: transport)
}

@Suite struct ReadPendingWorkTests {
  @Test func countsTheWaitingPostsAndLiveTimers() async throws {
    let transport = MockTransport()
    transport.on(.urlPrefix("\(server)/api/schedule/list"), respond: .json([
      "success": true,
      "data": [
        ["id": 1, "status": "pending", "clientKey": "virga"], ["id": 2, "status": "publishing"], ["id": 3, "status": "failed"],
        ["id": 4, "status": "published"], ["id": 5, "status": "pending"],
      ],
    ]))
    transport.on(.urlPrefix("\(server)/api/self-destruct/list"), respond: .json([
      "success": true,
      "data": [["id": 1, "status": "armed"], ["id": 2, "status": "checking"], ["id": 3, "status": "deleted"], ["id": 4, "status": "failed"]],
    ]))
    let work = try await PendingWork.readPendingWork(requester(transport), services: services())
    #expect(work == PendingWorkCount(posts: 3, timers: 2))
  }

  @Test func failsWhenAListCantBeRead() async {
    let transport = MockTransport()
    transport.on(.urlPrefix("\(server)/api/schedule/list"), respond: .json(["success": true, "data": []]))
    transport.on(.urlPrefix("\(server)/api/self-destruct/list"), respond: .networkError("fetch failed"))
    await #expect(throws: (any Error).self) { try await PendingWork.readPendingWork(requester(transport), services: services()) }
  }

  @Test func givesUpAfterTheDeadline() async {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    await #expect(throws: (any Error).self) {
      try await PendingWork.readPendingWork(requester(transport), services: services(), timeoutMs: 20)
    }
  }
}

@MainActor
@Suite struct PendingWorkModelTests {
  private func account(_ did: String, mode: String = "backend", status: AccountStatus = .ready) -> SessionAccount {
    SessionAccount(did: did, mode: mode, status: status)
  }

  @Test func readsEachLongSessionThatIsSignedIn() async {
    let transport = MockTransport()
    transport.on(.predicate("mira's schedule") { $0.url.contains("schedule") && $0.headers.get("authorization") == "Bearer \(token)" }, respond: .json(["success": true, "data": [["status": "pending"]]]))
    transport.on(.urlPrefix("\(server)/api/self-destruct/list"), respond: .json(["success": true, "data": []]))
    let model = PendingWorkModel(backendFor: { did in did == mira ? requester(transport) : nil }, services: services())
    model.update(
      accounts: [account(mira), account(lab), account("did:plc:browser", mode: "browser"), account("did:plc:gone", status: .needsSignIn)],
      enabled: true)
    #expect(model.key == "\(mira) \(lab)")
    #expect(model.checking)
    #expect(await eventually { !model.checking })
    #expect(model.entry(mira) == .counted(PendingWorkCount(posts: 1, timers: 0)))
    // No requester (its token went): nothing is waiting on its behalf here.
    #expect(model.entry(lab) == .counted(PendingWorkCount(posts: 0, timers: 0)))
    #expect(model.entry("did:plc:browser") == .absent)
    #expect(PendingWork.hasPendingWork(model.entry(mira)))
    #expect(PendingWork.hasPendingWork(model.entry(lab)) == false)
  }

  @Test func saysItCouldntCheck() async {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["success": false, "code": "INTERNAL"], status: 500))
    let model = PendingWorkModel(backendFor: { _ in requester(transport) }, services: services())
    model.update(accounts: [account(mira)], enabled: true)
    #expect(await eventually { !model.checking })
    #expect(model.entry(mira) == .unreadable)
    #expect(PendingWork.hasPendingWork(model.entry(mira)))
    #expect(AccountCopy.pendingWorkWarning("Mira", model.entry(mira))?.hasPrefix("Virga couldn’t check whether Mira") == true)
  }

  @Test func asksNothingWhileDisabled() {
    let model = PendingWorkModel(backendFor: { _ in Issue.record("asked"); return nil }, services: services())
    model.update(accounts: [account(mira)], enabled: false)
    #expect(model.key == "")
    #expect(!model.checking)
    #expect(model.byDid.isEmpty)
  }
}

@MainActor
@Suite struct PendingReauthModelTests {
  private let mira = SessionAccount(did: "did:plc:virgaharnessmira2zq4x", handle: "mira.example.com")

  @Test func signsInAfterTheNotice() async {
    var started: [String] = []
    let waits = Locked<[Double]>([])
    let model = PendingReauthModel(onRelogin: { started.append($0.did) }, sleep: { ms in waits.withLock { $0.append(ms) } })
    model.beginPendingReauth(mira)
    #expect(model.pendingReauthAccount == mira)
    #expect(await eventually { started == [mira.did] })
    #expect(waits.wrappedValue == [PendingReauthModel.reauthRedirectDelayMs])
    #expect(await eventually { model.pendingReauthAccount == nil })
  }

  @Test func cancellingStopsIt() async {
    var started = 0
    let model = PendingReauthModel(onRelogin: { _ in started += 1 }, sleep: { _ in try? await Task.sleep(nanoseconds: 20_000_000) })
    model.beginPendingReauth(mira)
    model.cancelPendingReauth()
    #expect(model.pendingReauthAccount == nil)
    try? await Task.sleep(nanoseconds: 60_000_000)
    #expect(started == 0)
  }

  @Test func aSignInThatCantStartIsHeard() async {
    var heard: [String] = []
    let model = PendingReauthModel(
      onRelogin: { _ in throw JSError(message: "x", code: "NETWORK_ERROR") },
      onError: { heard.append(JSErrorFields($0)?.codeString ?? "") },
      sleep: { _ in })
    model.beginPendingReauth(mira)
    #expect(await eventually { heard == ["NETWORK_ERROR"] })
    #expect(model.pendingReauthAccount == nil)
  }

  @Test func aSecondAccountReplacesTheFirst() async {
    var started: [String] = []
    let lab = SessionAccount(did: "did:plc:virgaharnesslab7k2pq")
    let model = PendingReauthModel(onRelogin: { started.append($0.did) }, sleep: { _ in try? await Task.sleep(nanoseconds: 10_000_000) })
    model.beginPendingReauth(mira)
    model.beginPendingReauth(lab)
    #expect(model.pendingReauthAccount == lab)
    #expect(await eventually { started == [lab.did] })
    try? await Task.sleep(nanoseconds: 30_000_000)
    #expect(started == [lab.did])
  }

  @Test func stoppingBeforeTheDelayStartsNothing() async {
    var started = 0
    let model = PendingReauthModel(onRelogin: { _ in started += 1 }, sleep: { _ in try? await Task.sleep(nanoseconds: 10_000_000) })
    model.beginPendingReauth(mira)
    model.stop()
    try? await Task.sleep(nanoseconds: 40_000_000)
    #expect(started == 0)
  }
}
