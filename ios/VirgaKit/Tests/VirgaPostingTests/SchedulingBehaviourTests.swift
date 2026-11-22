// The scheduling pages' flows wired to the app's services (the `live`
// deps) over MockTransport: posting a scheduled row now goes out through
// publish and takes the row off through Virga's server, and a draft's
// default timer is judged against the server's limits.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct SchedulingLiveBehaviour {
  static let did = "did:plc:writer"
  static let now: Double = 1_794_484_800_000

  static func backend(_ transport: any HTTPTransport) -> VirgaBackend {
    VirgaBackend(backendUrl: PublishFixture.server, token: { PublishFixture.token }, did: did, transport: transport)
  }

  /// Waits that end only when called off: publish's write races always
  /// finish first here.
  static let clock = NetworkClock(now: { now }) { _ in
    while !Task.isCancelled { try? await Task.sleep(nanoseconds: 3_600_000_000_000) }
  }

  final class Heard: Sendable {
    let bus = PostingEventBus()
    private let items = Locked<[String]>([])

    init() {
      for name in [PostingEvents.scheduledChangedEvent, PostingEvents.postsChangedEvent] {
        _ = try? PostingEvents.onPostingEvent(name, target: bus) { [items] detail in
          items.withLock { $0.append("\(name) \(detail["change"]?.stringValue ?? "")") }
        }
      }
    }

    var all: [String] { items.withLock { $0 } }
  }

  @Test func postingARowNowPublishesThenCancelsIt() async throws {
    let transport = MockTransport()
    let uri = "at://\(Self.did)/app.bsky.feed.post/3kposted"
    transport.on(
      "POST",
      .predicate("createRecord through the proxy") {
        $0.headers.get("x-xrpc-method") == "com.atproto.repo.createRecord"
      }
    ) { _ in
      .json(["success": true, "data": ["uri": .string(uri), "cid": "bafyreiposted", "validationStatus": "valid"]])
    }
    transport.on("POST", .url("\(PublishFixture.server)/api/schedule/cancel")) { _ in
      .json(["success": true, "data": ["id": "r1", "status": "cancelled"]])
    }
    let heard = Heard()
    let files = InMemoryComposerFiles(now: { Self.now })
    let media = PublishMedia(files: files, encoder: PublishEncoder(nil), transport: transport, clock: Self.clock)
    let agent = PublishFixture.agent(transport, did: Self.did)
    let deps = PostScheduledNowDeps<PublishTarget?>.live(
      requester: Self.backend(transport), timers: nil, files: files, media: media,
      targetFor: { did in PublishTarget(did: did, agent: agent) }, now: { Self.now }, target: heard.bus,
      timeZone: TimeZone(identifier: "UTC")!)
    let row: JSONValue = [
      "id": "r1", "status": "pending", "queued": false, "scheduledFor": "2026-11-20T09:00:00.000Z",
      "payload": [
        "posts": [["record": ["text": "Posted now from the scheduled list, in a behaviour test"]]],
        "gates": ["threadgate": nil, "postgate": nil],
      ],
    ]
    let out = try await ScheduleModel.postScheduledNow(row, did: Self.did, deps: deps, now: Self.now)
    #expect(out.cancelled)
    #expect(out.notes.isEmpty)
    #expect(out.result["posts"]?[0]?["uri"] == .string(uri))
    let methods = transport.requests.map { $0.headers.get("x-xrpc-method") ?? $0.url }
    #expect(methods == ["com.atproto.repo.createRecord", "\(PublishFixture.server)/api/schedule/cancel"])
    let cancelBody = try transport.requests.last?.body.map { try JSONDecoder().decode(JSONValue.self, from: $0) }
    #expect(cancelBody == ["id": "r1"])
    #expect(heard.all == ["virga:posts-changed ", "virga:scheduled-changed cancelled"])
  }

  @Test func aDraftsDefaultTimerIsJudgedAgainstTheLimits() async throws {
    let transport = MockTransport()
    transport.on("GET", .url("\(PublishFixture.server)/api/limits/status")) { _ in
      .json([
        "success": true, "policy": "membership",
        "features": ["postTimers": ["limit": 1], "conditionalTimers": ["limit": 1]],
        "usage": ["postTimers": 1, "conditionalTimers": 0],
      ])
    }
    let files = InMemoryComposerFiles(now: { Self.now })
    let deps = DraftActionDeps<PublishTarget?>.live(
      did: Self.did, target: nil, requester: Self.backend(transport), timers: nil,
      media: PublishMedia(files: files, encoder: PublishEncoder(nil), transport: transport, clock: Self.clock),
      now: { Self.now })
    let room = try #require(deps.timerRoom)
    let plain = try await room(["enabled": true, "lifespanSeconds": 3600])
    #expect(
      plain == "This account can keep one plain timer at a time, counting scheduled posts, and it’s in use.")
    let conditional = try await room([
      "enabled": true, "lifespanSeconds": 3600, "effects": [["action": "limitReplies", "allow": ["follower"]]],
    ])
    #expect(conditional == "")
  }

  @Test func withoutARequesterADraftCantBeScheduled() async {
    let files = InMemoryComposerFiles(now: { Self.now })
    let deps = DraftActionDeps<PublishTarget?>.live(
      did: Self.did, target: nil, requester: nil, timers: nil,
      media: PublishMedia(files: files, encoder: PublishEncoder(nil), transport: MockTransport(), clock: Self.clock),
      now: { Self.now })
    #expect(deps.timerRoom == nil)
    do {
      _ = try await DraftActions.scheduleDraft(
        ["id": "d1"], did: Self.did, settings: [:], agent: nil, scheduledFor: "2026-11-20T09:00:00.000Z", now: Self.now,
        deps: deps)
      Issue.record("scheduled without a requester")
    } catch {
      #expect(DraftActions.draftActionMessage(error, action: "schedule") == "Scheduling needs this account signed in for a long session.")
    }
  }
}
