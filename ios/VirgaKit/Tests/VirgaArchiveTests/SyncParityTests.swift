// Parity with src/lib/analyticsSync.js (fixture archive.sync): each sweep
// replayed through MockTransport must send the requests the web sent, wait
// the waits it waited, hand over the same pages and progress reports, and
// reach the same result. `abortAt` calls the sweep off once that request's
// answer is in, as the generator's AbortController does.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaArchive

let syncOwner = "did:plc:archiveowner234567abcd"
let syncNow: Double = 1_794_657_600_000  // 2026-11-14T12:00:00Z

/// A transport that cancels the calling task once request `abortAt` has
/// been answered (the answer still arrives, as the web's fake fetch hands
/// it back after the abort).
final class AbortingTransport: HTTPTransport, @unchecked Sendable {
  let base: any HTTPTransport
  let abortAt: Int?
  private let count = Locked(0)

  init(_ base: any HTTPTransport, abortAt: Int?) {
    self.base = base
    self.abortAt = abortAt
  }

  func send(_ request: HTTPRequest) async throws -> HTTPResponse {
    let index = count.withLock { n -> Int in
      defer { n += 1 }
      return n
    }
    let response = try await base.send(request)
    if index == abortAt { withUnsafeCurrentTask { $0?.cancel() } }
    return response
  }
}

/// What a sweep handed back as it went.
final class SweepLog: @unchecked Sendable {
  private let pages = Locked<[JSONValue]>([])
  private let progress = Locked<[JSONValue]>([])

  func page(_ rows: JSONValue, info: JSONValue? = nil) {
    pages.withLock { $0.append(info.map { ["rows": rows, "info": $0] } ?? ["rows": rows]) }
  }

  func report(_ value: JSONValue) {
    progress.withLock { $0.append(value) }
  }

  var pagesJSON: JSONValue { .array(pages.wrappedValue) }
  var progressJSON: JSONValue { .array(progress.wrappedValue) }
}

/// Runs one recorded sweep case against the port.
func replaySweep(
  _ c: ParityCase, ordered: Bool = true, sourceLocation: SourceLocation = #_sourceLocation,
  _ run: @escaping @Sendable (_ agent: XRPCAgent, _ transport: any HTTPTransport, _ clock: NetworkClock, _ log: SweepLog) async -> JSONValue
) async {
  let recording = RecordedFetch(c.output)
  let mock = recording.transport()
  let transport = AbortingTransport(mock, abortAt: c["abortAt"].intValue)
  let clock = RecordingClock(now: syncNow)
  let agent = XRPCAgent(service: "https://pds.example", transport: transport)
  let log = SweepLog()
  let networkClock = clock.clock
  let result = await Task { await run(agent, transport, networkClock, log) }.value
  let d = recording.check(sent: mock.requests, result: recorded(result), waits: clock.waits, ordered: ordered)
  #expect(d == nil, "\(c): \(d ?? "")", sourceLocation: sourceLocation)
  // Times are epoch milliseconds: compared exactly, not within check's 1e-9.
  let exact = exactDiff(recorded(result), recording.expected)
  #expect(exact == nil, "\(c): \(exact ?? "")", sourceLocation: sourceLocation)
  let exactProgress = exactDiff(log.progressJSON, c.output["progress"] ?? .array([]))
  #expect(exactProgress == nil, "\(c) progress: \(exactProgress ?? "")", sourceLocation: sourceLocation)
  let pages = Parity.diff(log.pagesJSON, c.output["pages"] ?? .array([]))
  #expect(pages == nil, "\(c) pages: \(pages ?? "")", sourceLocation: sourceLocation)
  let progress = Parity.diff(log.progressJSON, c.output["progress"] ?? .array([]))
  #expect(progress == nil, "\(c) progress: \(progress ?? "")", sourceLocation: sourceLocation)
}

private func progressJSON(_ p: SweepProgress) -> JSONValue {
  var members: [String: JSONValue] = ["fetched": .number(Double(p.fetched)), "reachedMs": js(p.reachedMs)]
  if let part = p.part { members["part"] = .number(Double(part)) }
  if let parts = p.parts { members["parts"] = .number(Double(parts)) }
  return .object(members)
}

private func known(_ c: ParityCase) -> Set<JSKey>? {
  c["opts"]["knownUris"]?.arrayValue.map { Set($0.compactMap(\.stringValue).map(JSKey.init)) }
}

private let utc = TimeZone(identifier: "UTC")!

@Suite struct SyncParity {
  @Test func followFromRecord() throws {
    try forEachCase("archive.sync", "followFromRecord") { c in
      AnalyticsSync.followFromRecord(c.input["record"])?.json ?? .null
    }
  }

  @Test func sweepFollowers() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepFollowers") {
      await replaySweep(c) { agent, _, clock, log in
        encoded(await AnalyticsSync.sweepFollowers(agent: agent, did: syncOwner, clock: clock) { log.report(progressJSON($0)) })
      }
    }
  }

  @Test func sweepFollowing() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepFollowing") {
      await replaySweep(c) { agent, _, clock, log in
        encoded(await AnalyticsSync.sweepFollowing(agent: agent, did: syncOwner, clock: clock) { log.report(progressJSON($0)) })
      }
    }
  }

  @Test func sweepBlocks() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepBlocks") {
      // The lists are checked eight at a time, so their requests can go in any order.
      await replaySweep(c, ordered: false) { _, transport, clock, log in
        encoded(
          await AnalyticsSync.sweepBlocks(did: syncOwner, transport: transport, clock: clock, timeZone: utc) {
            log.report(encoded($0))
          })
      }
    }
  }

  @Test func sweepPosts() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepPosts") {
      let opts = c["opts"]
      let rehydrate = opts["rehydrateSinceMs"].map { num($0) } ?? .infinity
      let resume = opts["resumeCursor"]?.stringValue
      let knownUris = known(c)
      await replaySweep(c) { _, transport, clock, log in
        encoded(
          await AnalyticsSync.sweepPosts(
            did: syncOwner, knownUris: knownUris, rehydrateSinceMs: rehydrate, resumeCursor: resume, transport: transport,
            clock: clock, timeZone: utc,
            onPage: { rows, info in log.page(json(rows), info: ["cursor": info.cursor.map(JSONValue.string) ?? .null]) },
            onProgress: { log.report(progressJSON($0)) }))
      }
    }
  }

  @Test func sweepInbound() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepInbound") {
      let opts = c["opts"]
      let cutoff = num(opts["cutoffMs"])
      let covered = opts["coveredToMs"]?.doubleValue
      let knownUris = known(c)
      await replaySweep(c) { agent, _, clock, log in
        encoded(
          await AnalyticsSync.sweepInbound(
            agent: agent, cutoffMs: cutoff, knownUris: knownUris, coveredToMs: covered, clock: clock, timeZone: utc,
            onPage: { log.page(json($0)) }, onProgress: { log.report(progressJSON($0)) }))
      }
    }
  }

  @Test func sweepOutbound() async throws {
    for c in try Parity.cases("archive.sync", fn: "sweepOutbound") {
      let opts = c["opts"]
      let cutoff = num(opts["cutoffMs"])
      let covered = opts["coveredToMs"]?.doubleValue
      let knownUris = known(c)
      await replaySweep(c) { agent, _, clock, log in
        encoded(
          await AnalyticsSync.sweepOutbound(
            agent: agent, did: syncOwner, cutoffMs: cutoff, knownUris: knownUris, coveredToMs: covered, clock: clock,
            timeZone: utc, onPage: { log.page(json($0)) }, onProgress: { log.report(progressJSON($0)) }))
      }
    }
  }

  @Test func hydrateActors() async throws {
    for c in try Parity.cases("archive.sync", fn: "hydrateActors") {
      var cache: [JSKey: ActorCard] = [:]
      for card in (rows(c["cache"]) as [ActorCard]?) ?? [] { cache[JSKey(card.did)] = card }
      let dids: [String?]? = c["dids"].arrayValue?.map(\.stringValue)
      let held = cache
      await replaySweep(c) { _, transport, clock, _ in
        json(await AnalyticsSync.hydrateActors(dids, cache: held, now: syncNow, transport: transport, clock: clock))
      }
    }
  }
}

/// The page caps: past them a sweep says it didn't read everything, never
/// that it did (the fixtures can't hold a thousand pages).
@Suite struct SyncCaps {
  private func endless(_ path: String, _ body: JSONValue) -> MockTransport {
    let transport = MockTransport()
    transport.on(.path(path), respond: .json(body))
    return transport
  }

  @Test func followersPastTheCap() async {
    let page: JSONValue = [
      "subject": ["did": .string(syncOwner), "handle": "owner.test"],
      "followers": [["did": "did:plc:ana", "handle": "ana.test"]], "cursor": "more",
    ]
    let transport = endless("/xrpc/app.bsky.graph.getFollowers", page)
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    let result = await AnalyticsSync.sweepFollowers(agent: agent, did: syncOwner, clock: .instant(now: syncNow))
    #expect(transport.requests.count == AnalyticsSync.caps.followers)
    #expect(result.complete == false)
    #expect(result.error == "more followers than the sweep reads")
    #expect(result.followers.count == AnalyticsSync.caps.followers)
  }

  @Test func followsPastTheCap() async {
    let page: JSONValue = [
      "records": [["uri": .string("at://\(syncOwner)/app.bsky.graph.follow/x"), "cid": "c", "value": ["subject": "did:plc:a"]]],
      "cursor": "more",
    ]
    let transport = endless("/xrpc/com.atproto.repo.listRecords", page)
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    let result = await AnalyticsSync.sweepFollowing(agent: agent, did: syncOwner, clock: .instant(now: syncNow))
    #expect(transport.requests.count == AnalyticsSync.caps.following)
    #expect(result.error == "more follows than the sweep reads")
  }

  @Test func blocksPastTheCap() async {
    let transport = MockTransport()
    let counter = Locked(0)
    transport.on(.path("/xrpc/blue.microcosm.links.getBacklinks")) { _ in
      let n = counter.withLock { n -> Int in
        n += 1
        return n
      }
      return .json(["records": [["did": "did:plc:b", "rkey": .string("k\(n)")]], "cursor": .string("c\(n)")])
    }
    let result = await AnalyticsSync.sweepBlocks(did: syncOwner, transport: transport, clock: .instant(now: syncNow))
    #expect(transport.requests.count == AnalyticsSync.caps.blocks)
    #expect(result.truncated)
    #expect(result.error == "more block records than the sweep reads")
    #expect(result.blocks.isEmpty)
  }

  @Test func postsPastTheCapHandBackTheirCursor() async {
    let transport = MockTransport()
    // An empty page ends a walk, so the cap is reached only by pages that
    // carry posts: the same one, over and over, never known.
    let item: JSONValue = [
      "post": ["uri": .string("at://\(syncOwner)/app.bsky.feed.post/3a"), "record": ["createdAt": "2026-11-01T00:00:00.000Z"]]
    ]
    transport.on(.path("/xrpc/app.bsky.feed.getAuthorFeed"), respond: .json(["feed": [item], "cursor": "next"]))
    let result = await AnalyticsSync.sweepPosts(did: syncOwner, transport: transport, clock: .instant(now: syncNow))
    #expect(transport.requests.count == AnalyticsSync.caps.posts)
    #expect(result.complete == false)
    #expect(result.error == nil)
    #expect(result.cursor == "next")
    #expect(result.fetched == AnalyticsSync.caps.posts)
  }

  @Test func notificationsPastTheCapAreTruncated() async {
    let page: JSONValue = [
      "notifications": [
        [
          "uri": "at://did:plc:f/app.bsky.feed.like/1", "cid": "c", "author": ["did": "did:plc:f", "handle": "f.test"],
          "reason": "like", "record": [:], "isRead": false, "indexedAt": "2026-11-13T00:00:00.000Z",
        ]
      ],
      "cursor": "more",
    ]
    let transport = endless("/xrpc/app.bsky.notification.listNotifications", page)
    let agent = XRPCAgent(service: "https://pds.example", transport: transport)
    let result = await AnalyticsSync.sweepInbound(agent: agent, cutoffMs: syncNow - 365 * 86_400_000, clock: .instant(now: syncNow))
    #expect(transport.requests.count == AnalyticsSync.caps.inbound)
    #expect(result.truncated)
    #expect(result.complete == false)
  }
}
