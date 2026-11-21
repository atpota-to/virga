// harvest.js's behaviour where a fixture can't hold it: a harvest the
// caller stopped (the web's AbortSignal is task cancellation), and progress
// reported in order however the sources finish (harvest.test.js, "a harvest
// the caller stopped").

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaDefense

private let post = "at://did:plc:a/app.bsky.feed.post/1"

/// A `/links/all` answer listing `n` like-ish sources (distinct paths, so
/// distinct sources), the first the busiest.
private func sources(_ n: Int) -> JSONValue {
  var paths: [String: JSONValue] = [:]
  for i in 0..<n { paths[".subject.uri\(i)"] = ["records": .number(Double(100 - i))] }
  return ["links": ["app.bsky.feed.like": .object(paths)]]
}

@Suite struct HarvestBehaviour {
  @Test func throwsTheStopNotADeadIndexWhenNothingCameBack() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    let task = Task { try await Harvest.harvestPost(post, transport: transport, clock: .instant(now: Fixed.now)) }
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("a stopped harvest should throw")
    } catch {
      #expect(error is CancellationError, "\(error)")
    }
  }

  @Test func saysConstellationDidntAnswerWhenItWasntStopped() async throws {
    let transport = MockTransport()
    transport.on(.path("/links/all"), respond: .status(404))
    do {
      _ = try await Harvest.harvestPost(post, transport: transport, clock: .instant(now: Fixed.now))
      Issue.record("a dead index should throw")
    } catch {
      #expect((error as? HarvestError)?.message == Harvest.constellationDown)
    }
  }

  @Test func doesntAskForAFailedPageAgainOnceStopped() async throws {
    let transport = MockTransport()
    transport.on(.path("/links/all"), respond: .json(sources(1)))
    transport.on(.regex("cursor="), times: 1) { _ in
      // The caller stops while the second page is being read, and it fails.
      withUnsafeCurrentTask { $0?.cancel() }
      return .status(404)
    }
    transport.on(.path("/xrpc/blue.microcosm.links.getBacklinks"), times: 1, respond: .json([
      "records": [["did": "did:plc:first", "rkey": "r"]], "cursor": "c1",
    ]))
    let harvest = try await Harvest.harvestPost(post, transport: transport, clock: .instant(now: Fixed.now))
    #expect(transport.requests.count == 3)
    #expect(harvest.sources?.first?.truncated == true)
    #expect(harvest.sources?.first?.failed == false)
    #expect(harvest.participants.map(\.did) == ["did:plc:first"])
  }

  @Test func reportsProgressInOrderWhateverOrderSourcesFinishIn() async throws {
    let transport = MockTransport()
    transport.on(.path("/links/all"), respond: .json(sources(7)))
    transport.on(.path("/xrpc/blue.microcosm.links.getBacklinks")) { request in
      // The earlier sources answer last.
      let n = Int(request.url.split(separator: "uri").last?.prefix(while: \.isNumber) ?? "") ?? 0
      try await Task.sleep(nanoseconds: UInt64(7 - n) * 3_000_000)
      return .json(["records": [["did": .string("did:plc:p\(n)"), "rkey": "r"]]])
    }
    let heard = Heard<HarvestProgress>()
    let harvest = try await Harvest.harvestPost(
      post,
      onProgress: { p in
        // A slow listener: a report must not overtake the one before it.
        try? await Task.sleep(nanoseconds: 1_000_000)
        heard.add(p)
      },
      transport: transport, clock: .instant(now: Fixed.now))
    #expect(heard.all.map(\.done) == Array(0...7))
    #expect(heard.all.allSatisfy { $0.total == 7 })
    // Folded in the order the sources were listed, however they finished.
    #expect(harvest.participants.map(\.did) == (0..<7).map { "did:plc:p\($0)" })
  }

  @Test func stampsTheHarvestWithTheClockItWasGiven() async throws {
    let transport = MockTransport()
    transport.on(.path("/links/all"), respond: .json(["links": [:]]))
    let harvest = try await Harvest.harvestPost(
      post, transport: transport, clock: .instant(now: Fixed.now), now: { date(ms: 1_773_576_000_123.4) })
    #expect(harvest.harvestedAt == "2026-03-15T12:00:00.123Z")
  }
}
