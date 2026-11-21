// veto.js's behaviour where a fixture can't hold it: a read the caller
// stopped (the web's AbortSignal is task cancellation, and a stop is never
// VetoUnreadable), which failure wins when both reads fail, and the reads a
// caller hands in.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
@testable import VirgaDefense

private let owner = "did:plc:owner"

private struct Mine: Error, LocalizedError {
  var errorDescription: String? { "mine" }
}

/// Returns once `transport` has been asked for `method`, and a quarter of a
/// second more: time for that read's failure to be counted first.
private func answered(_ method: String, on transport: MockTransport) async {
  while !transport.requests.contains(where: { $0.url.contains(method) }) {
    try? await Task.sleep(nanoseconds: 1_000_000)
  }
  try? await Task.sleep(nanoseconds: 250_000_000)
}

@Suite struct VetoBehaviour {
  @Test func aStoppedFollowsReadIsTheStopNotUnreadable() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .hang)
    let task = Task { try await Veto.followedNow(owner, ["did:plc:a"], transport: transport) }
    try await Task.sleep(nanoseconds: 5_000_000)
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("a stopped read should throw")
    } catch {
      #expect(error is CancellationError, "\(error)")
    }
  }

  @Test func aStoppedCurationReadIsTheStopNotUnreadable() async throws {
    let transport = MockTransport()
    transport.on(.path("/xrpc/app.bsky.graph.getLists"), respond: .json([
      "lists": [["uri": "at://l/1", "name": "A", "purpose": "app.bsky.graph.defs#curatelist"]]
    ]))
    // Stopped while a page of members is being read.
    transport.on(.path("/xrpc/app.bsky.graph.getList"), respond: .hang)
    let task = Task { try await Veto.curationMembers(owner, transport: transport) }
    while transport.requests.count < 2 { await Task.yield() }
    task.cancel()
    do {
      _ = try await task.value
      Issue.record("a stopped read should throw")
    } catch {
      #expect(error is CancellationError, "\(error)")
    }
  }

  @Test func theReadThatFailsFirstIsTheFailure() async throws {
    // The follows fail at once; the lists fail too, but only well after the
    // follows' answer came back (waiting for it first, so a busy machine
    // can't put the slow read ahead).
    let first = MockTransport()
    first.on(.path("/xrpc/app.bsky.graph.getRelationships"), respond: .status(502))
    first.on(.path("/xrpc/app.bsky.graph.getLists")) { _ in
      await answered("getRelationships", on: first)
      return .status(502)
    }
    do {
      _ = try await Veto.vetoed(ownerDid: owner, dids: ["did:plc:x"], transport: first)
      Issue.record("an unreadable veto should throw")
    } catch {
      #expect((error as? VetoUnreadable)?.message == "Couldn’t check who you follow, so nothing was written.")
      // The slower read was let finish, as the web leaves it running.
      #expect(first.requests.count == 2)
    }

    let second = MockTransport()
    second.on(.path("/xrpc/app.bsky.graph.getRelationships")) { _ in
      await answered("getLists", on: second)
      return .status(502)
    }
    second.on(.path("/xrpc/app.bsky.graph.getLists"), respond: .status(502))
    do {
      _ = try await Veto.vetoed(ownerDid: owner, dids: ["did:plc:x"], transport: second)
      Issue.record("an unreadable veto should throw")
    } catch {
      #expect((error as? VetoUnreadable)?.message == "Couldn’t read the curation lists you made, so nothing was written.")
    }
  }

  @Test func takesTheCallersReads() async throws {
    let transport = MockTransport()
    let out = try await Veto.vetoed(
      ownerDid: owner,
      dids: ["did:plc:f", "did:plc:n", "did:plc:z"],
      curation: { ["did:plc:n": "Mine", "did:plc:f": "Also"] },
      follows: { _, dids in
        #expect(dids == ["did:plc:f", "did:plc:n", "did:plc:z"])
        return ["did:plc:f": ""]
      },
      transport: transport)
    #expect(transport.requests.isEmpty)
    #expect(out["did:plc:f"] == "you follow them")
    #expect(out["did:plc:n"] == "on your list “Mine”")
    #expect(!out.has("did:plc:z"))
  }

  @Test func rethrowsACallersCurationThatFails() async throws {
    let transport = MockTransport()
    transport.on(.any, respond: .json(["relationships": [["did": "did:plc:x"]]]))
    do {
      _ = try await Veto.vetoed(ownerDid: owner, dids: ["did:plc:x"], curation: { throw Mine() }, transport: transport)
      Issue.record("the caller's failure should come through")
    } catch {
      #expect(error is Mine)
    }
  }

  @Test func keysByCodeUnit() {
    var map = ReasonMap()
    map.set("did:plc:caf\u{e9}", "composed")
    map.set("did:plc:cafe\u{301}", "decomposed")
    map.set("did:plc:caf\u{e9}", "again")
    #expect(map.count == 2)
    #expect(map["did:plc:caf\u{e9}"] == "again")
    #expect(map["did:plc:cafe\u{301}"] == "decomposed")
    #expect(!map.has("did:plc:\u{212A}"))
    let merged = ReasonMap([("a", "1"), ("b", "2")]).merging(["b": "3", "c": "4"])
    #expect(merged.keys == ["a", "b", "c"])
    #expect(merged["b"] == "3")
  }
}
