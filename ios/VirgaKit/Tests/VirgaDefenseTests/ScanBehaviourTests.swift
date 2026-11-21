// scan.js's behaviour where a fixture can't hold it: a scan the caller
// stopped (the web's AbortSignal is task cancellation, and the scan says
// "The scan was stopped." whatever it was doing), the stages reported in
// order to a slow listener, the signed-in read's fallback, and a scan run
// through the ScanStore as the page runs it.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaDefense

private let owner = "did:plc:owner"
private let author = "did:plc:author"
private let canary = "did:plc:canary"
private let postURI = "at://did:plc:author/app.bsky.feed.post/3abc"

/// A harvest of `dids` liking the post, with the owner and the author among them.
private func harvest(_ dids: [String]) -> Harvest {
  let participants = (dids + [owner, author]).map {
    Participant(did: $0, engagements: ["like": 1], records: [EngagementRecord(kind: "like")], total: 1, primary: "like")
  }
  return Harvest(
    uri: postURI, harvestedAt: "2026-11-17T00:00:00.000Z", sources: [], participants: participants,
    totals: HarvestTotals(participants: participants.count, engagements: ["like": participants.count], records: participants.count),
    truncated: false, unread: [])
}

/// Profiles as the owner sees them: the canary counted.
private let profiles: GetProfiles = { dids in
  dids.map { did in
    let viewer: JSONValue = did == canary ? ["knownFollowers": ["count": 4]] : [:]
    return ["did": .string(did), "handle": .string("\(did.jsSlice(8)).test"), "followersCount": 10, "viewer": viewer]
  }
}

private let noRelationships: GetRelationships = { _, dids in dids.map { ["did": .string($0)] } }

@Suite struct ScanBehaviour {
  @Test func stoppedWhileHarvestingSaysSo() async throws {
    let started = Heard<Bool>()
    let task = Task {
      try await Scan.runScan(
        input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary],
        harvest: { _, _ in
          started.add(true)
          try await Task.sleep(nanoseconds: 60_000_000_000)
          return harvest([])
        },
        getRelationships: noRelationships, readCurated: { _ in ReasonMap() }, retryDelaysMs: [0, 0])
    }
    while started.all.isEmpty { await Task.yield() }
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("a stopped scan should throw")
    } catch {
      #expect((error as? ScanError)?.code == .aborted)
      #expect((error as? ScanError)?.message == "The scan was stopped.")
    }
  }

  @Test func stoppedDuringTheSecondLookStopsAtOnce() async throws {
    let asked = Heard<[String]>()
    let clock = ContinuousClock()
    let begun = clock.now
    // The scan runs in a task of its own, which the read stops.
    let task = Task {
      try await Scan.runScan(
        input: postURI, ownerDid: owner,
        getProfiles: { dids in
          asked.add(dids)
          // The caller stops the scan as the first look comes back empty:
          // the second look's pause (a minute, here) must not be waited out.
          withUnsafeCurrentTask { $0?.cancel() }
          return dids.map { ["did": .string($0), "viewer": [:]] }
        },
        candidates: [canary],
        harvest: { _, _ in harvest(["did:plc:far"]) },
        getRelationships: noRelationships, readCurated: { _ in ReasonMap() }, retryDelaysMs: [60_000, 60_000])
    }
    do {
      _ = try await task.value
      Issue.record("a stopped scan should throw")
    } catch {
      #expect((error as? ScanError)?.code == .aborted)
    }
    #expect(asked.all.count == 1)
    #expect(clock.now - begun < .seconds(30))
  }

  @Test func stoppedPartWayThroughTheWebsHarvestSaysSo() async throws {
    // The default harvest resolves when stopped part way (as harvest.js
    // does), so the scan goes on to the canary stage, where the curation
    // read stops it: "The scan was stopped.", as on the web.
    let transport = MockTransport()
    let outer = Locked<Task<ScanResult, any Error>?>(nil)
    // Five sources: more than are read side by side, so some are still to
    // start when the stop comes.
    var paths: [String: JSONValue] = [:]
    for i in 0..<5 { paths[".subject.uri\(i)"] = ["records": .number(Double(9 - i))] }
    let listed: JSONValue = ["links": ["app.bsky.feed.like": .object(paths)]]
    transport.on(.path("/links/all")) { _ in
      while outer.wrappedValue == nil { await Task.yield() }
      return .json(listed)
    }
    transport.on(.path("/xrpc/blue.microcosm.links.getBacklinks")) { _ in
      outer.wrappedValue?.cancel()
      return .json(["records": [["did": "did:plc:a", "rkey": "r"]], "cursor": "c1"])
    }
    transport.on(.any, respond: .json(["lists": []]))
    let heard = Heard<String>()
    let task = Task {
      try await Scan.runScan(
        input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary],
        onStage: { heard.add($0.stage) }, getRelationships: noRelationships, retryDelaysMs: [0, 0],
        transport: transport)
    }
    outer.withLock { $0 = task }
    do {
      _ = try await task.value
      Issue.record("a stopped scan should throw")
    } catch {
      #expect((error as? ScanError)?.code == .aborted)
      #expect((error as? ScanError)?.message == "The scan was stopped.")
    }
    #expect(heard.all.contains("canary"))
    #expect(!heard.all.contains("score"))
    // The second page was never asked for.
    #expect(!transport.requests.contains { $0.url.contains("cursor=") })
  }

  @Test func aStopWhileReadingTheListsIsAStopNotAnEmptyList() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    let reading = Heard<Bool>()
    let task = Task {
      try await Scan.runScan(
        input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary],
        onStage: { if $0.stage == "canary" { reading.add(true) } },
        harvest: { _, _ in harvest(["did:plc:a"]) },
        getRelationships: noRelationships, transport: transport)
    }
    while reading.all.isEmpty || transport.requests.isEmpty { await Task.yield() }
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("a stopped scan should throw")
    } catch {
      #expect((error as? ScanError)?.code == .aborted)
    }
  }

  @Test func reportsEveryStageInOrderToASlowListener() async throws {
    let heard = Heard<ScanStageReport>()
    let result = try await Scan.runScan(
      input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary],
      onStage: { report in
        try? await Task.sleep(nanoseconds: 1_000_000)
        heard.add(report)
      },
      harvest: { _, onProgress in
        for done in 0...3 { await onProgress(HarvestProgress(done: done, total: 3)) }
        return harvest((0..<30).map { "did:plc:p\($0)" })
      },
      getRelationships: noRelationships, readCurated: { _ in ReasonMap() }, retryDelaysMs: [0, 0],
      now: { date(ms: Fixed.now) })
    let stages = heard.all.map(\.stage)
    #expect(stages.first == "post")
    let firstOf = { (s: String) in stages.firstIndex(of: s) ?? -1 }
    #expect(firstOf("post") < firstOf("harvest"))
    #expect(firstOf("harvest") < firstOf("canary"))
    #expect(firstOf("canary") < firstOf("score"))
    let harvested = heard.all.filter { $0.stage == "harvest" }.compactMap(\.done)
    #expect(harvested == [0, 0, 1, 2, 3])
    let scored = heard.all.filter { $0.stage == "score" }.compactMap(\.done)
    #expect(scored.first == 0)
    #expect(scored == scored.sorted())
    #expect(scored.last == 30)
    #expect(result.startedAt == "2026-03-15T12:00:00.000Z")
    #expect(result.summary.totals.participants == 30)
  }

  @Test func theSignedInReadAsksTheAppViewAndFallsBackToNone() async throws {
    let transport = MockTransport()
    transport.on(.path("/xrpc/app.bsky.actor.getProfiles"), respond: .json([:]))
    let read = Scan.signedInProfiles(XRPCAgent(service: "https://pds.example.com", transport: transport))
    let out = try await read(["did:plc:a", "did:plc:b"])
    #expect(out.isEmpty)
    let sent = try #require(transport.requests.first)
    #expect(sent.headers.get("atproto-proxy") == "did:web:api.bsky.app#bsky_appview")
    #expect(sent.url.hasSuffix("getProfiles?actors=did%3Aplc%3Aa&actors=did%3Aplc%3Ab"))
  }

  @MainActor @Test func runsThroughTheScanStore() async throws {
    let store = ScanStore(now: { date(ms: Fixed.now) })
    let seen = Heard<String>()
    let task = store.startScan(owner, input: postURI) { onStage in
      try await Scan.runScan(
        input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary],
        onStage: { report in
          seen.add(report.stage)
          await onStage(report)
        },
        harvest: { _, _ in harvest(["did:plc:a", "did:plc:b"]) },
        getRelationships: noRelationships, readCurated: { _ in ReasonMap() }, retryDelaysMs: [0, 0])
    }
    await task.value
    let state = store.scanFor(owner)
    #expect(state.status == .done)
    #expect(state.result?.canary == canary)
    #expect(state.result?.summary.rows.map(\.did) == ["did:plc:a", "did:plc:b"])
    #expect(seen.all.contains("score"))
  }

  @MainActor @Test func aScanStoppedInTheStoreLeavesNoTrace() async throws {
    let store = ScanStore(now: { date(ms: Fixed.now) })
    let harvesting = Heard<Bool>()
    let task = store.startScan(owner, input: postURI) { onStage in
      try await Scan.runScan(
        input: postURI, ownerDid: owner, getProfiles: profiles, candidates: [canary], onStage: onStage,
        harvest: { _, _ in
          harvesting.add(true)
          try await Task.sleep(nanoseconds: 60_000_000_000)
          return harvest([])
        },
        getRelationships: noRelationships, readCurated: { _ in ReasonMap() })
    }
    while harvesting.all.isEmpty { await Task.yield() }
    store.stopScan(owner)
    await task.value
    #expect(store.scanFor(owner).status == .idle)
  }

  @MainActor @Test func aFailedScanIsShownWithItsSentence() async throws {
    let store = ScanStore(now: { date(ms: Fixed.now) })
    let task = store.startScan(owner, input: "hello") { onStage in
      try await Scan.runScan(input: "hello", ownerDid: owner, getProfiles: profiles, onStage: onStage)
    }
    await task.value
    let state = store.scanFor(owner)
    #expect(state.status == .failed)
    #expect((state.error as? ScanError)?.code == .link)
    #expect(state.error?.localizedDescription == "That isn’t a link to a post. Paste a bsky.app link to a post, or its at:// address.")
  }
}
