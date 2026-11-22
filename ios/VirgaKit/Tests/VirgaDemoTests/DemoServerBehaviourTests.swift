// harness/fakeServer.test.js (scheduled posts, timers, the adviser and alt
// text, scheduled replies, repeating posts) and harness/fakeDefense.test.js,
// ported where they cover the routes DemoServer answers, run through the
// app's own clients: VirgaBackend, TimerService (through a TimerRequester
// over VirgaBackend) and DefenseService. The composer's serializer isn't in
// this base, so the bodies are written out as it writes them. Also: the
// harness's workers (DemoHarness.cron, startCron, stopCron) on a clock whose
// waits a test releases, and the flags reaching the server.

import Foundation
import Testing
import VirgaCore
import VirgaDefense
import VirgaNetwork
import VirgaPosting
import VirgaTestSupport
@testable import VirgaDemo

/// fakeServer.test.js's `setup({ limits, aiLimits, seed, terms })` for these routes.
struct WorkerSetup {
  static let now: Double = JSDate.parse("2026-11-12T12:00:00.000Z", timeZone: .gmt)
  static let hour: Double = 3_600_000
  static let day: Double = 86_400_000

  let world: DemoWorld
  let server: DemoServer
  let transport: DemoTransport
  let clock: Locked<Double>
  let sleeps: Locked<[Double]>

  init(
    limits: JSONValue = [:], aiLimits: JSONValue = [:], seed: Bool = true, scope: String = "atproto", ai: String = "ok",
    defenseWrites: Bool = true, aiDelayMs: Double = 0
  ) {
    let clock = Locked(Self.now)
    let sleeps = Locked<[Double]>([])
    self.clock = clock
    self.sleeps = sleeps
    world = DemoWorld(now: Self.now, scope: scope)
    let net = NetworkClock(now: { clock.wrappedValue }, sleep: { _ in await Task.yield() })
    server = DemoServer(
      world: world, limits: limits, aiLimits: aiLimits, seed: seed, aiDelayMs: aiDelayMs, ai: ai,
      defenseWrites: defenseWrites, now: net.now, sleep: { ms in sleeps.withLock { $0.append(ms) } })
    transport = DemoTransport(world: world, server: server, latency: 0, clock: net)
  }

  var mira: AccountWorld { world.world(World.me.did)! }
  var lab: AccountWorld { world.world(World.lab.did)! }
  func advance(_ ms: Double) { clock.withLock { $0 += ms } }
  var now: Double { clock.wrappedValue }

  func requester(_ did: String = World.me.did) -> VirgaBackend {
    let token = server.mintToken(did)
    return VirgaBackend(backendUrl: FakeServer.serverOrigin, token: { token }, did: did, transport: transport)
  }

  /// A body to /api/schedule/create, as scheduleSerialize writes one.
  func body(_ texts: [String], at: Double, payload extra: [String: JSONValue] = [:], queued: Bool = false) -> JSONValue {
    var payload: [String: JSONValue] = [
      "posts": .array(texts.map { ["record": ["text": .string($0), "langs": ["en"]]] }),
      "gates": ["threadgate": .null, "postgate": .null], "tz": "UTC", "selfDestruct": .null,
    ]
    for (key, value) in extra { payload[key] = value }
    return [
      "scheduledFor": .string(World.iso(at)), "target": "bluesky", "queued": .bool(queued), "payload": .object(payload),
    ]
  }

  /// fakeServer.test.js's timer `body(uri, extra)`.
  func arm(_ uri: String, _ extra: [String: JSONValue] = [:]) -> JSONValue {
    var out: [String: JSONValue] = [
      "postUri": .string(uri), "postedAt": .string(World.iso(Self.now)), "lifespanSeconds": 3600, "conditions": [:],
      "effects": [["action": "delete"]],
    ]
    for (key, value) in extra { out[key] = value }
    return .object(out)
  }

  func create(_ req: VirgaBackend, _ body: JSONValue) async throws -> JSONValue {
    try await req.request("/api/schedule/create", method: "POST", body: body)["data"] ?? .null
  }

  func list(_ req: VirgaBackend) async throws -> [JSONValue] {
    try await req.request("/api/schedule/list")["data"]?.arrayValue ?? []
  }

  func update(_ req: VirgaBackend, _ id: JSONValue?, _ fields: [String: JSONValue]) async throws -> JSONValue {
    var body = fields
    body["id"] = id ?? .null
    return try await req.request("/api/schedule/update", method: "POST", body: .object(body))
  }

  func posts(_ did: String = World.me.did) throws -> [HarnessRepo.Row] {
    try HarnessRepo.listCollection(world.world(did)!, "app.bsky.feed.post")
  }
}

/// TimerService's requester over VirgaBackend.
struct BackendTimers: TimerRequester {
  let backend: VirgaBackend
  var did: String? { backend.did }

  func request(_ r: TimerRequest) async throws -> JSONValue? {
    let query = r.query.map { QueryParams($0.sorted { $0.key < $1.key }.map { ($0.key, JSONValue.string($0.value)) }) }
    return try await backend.request(r.path, method: r.method ?? "GET", query: query, body: r.body)
  }
}

func refusal(_ body: () async throws -> Void) async -> BackendError? {
  do {
    try await body()
    return nil
  } catch let error as BackendError {
    return error
  } catch {
    Issue.record("not a BackendError: \(error)")
    return nil
  }
}

@Suite struct ScheduledPostsOnTheDemoServer {
  @Test func listsTheAccountsRowsEveryOneVirgas() async throws {
    let s = WorkerSetup()
    let rows = try await s.list(s.requester())
    #expect(!rows.isEmpty)
    #expect(Set(rows.compactMap { $0["clientKey"]?.stringValue }) == ["virga"])
    #expect(rows.first { $0["status"] == "failed" }?["lastErrorCode"] == "SESSION_UNAVAILABLE")
    let notes = rows.filter { $0["lastErrorCode"] == "TIMER_NOT_ARMED" }
    #expect(notes.count == 1)
    #expect(notes.first?["clientKey"] == "virga")
  }

  @Test func neverShowsOneAccountAnothersRowsOrLetsItTouchThem() async throws {
    let s = WorkerSetup()
    let rows = try await s.list(s.requester())
    let lab = s.requester(World.lab.did)
    #expect(try await s.list(lab).isEmpty)
    let mine = try #require(rows.first { $0["status"] == "pending" })
    let get = await refusal { _ = try await lab.request("/api/schedule/get", query: ["id": mine["id"]]) }
    #expect(get?.status == 404)
    let cancel = await refusal { _ = try await lab.request("/api/schedule/cancel", method: "POST", body: ["id": mine["id"]!]) }
    #expect(cancel?.codeString == "NOT_CANCELLABLE")
  }

  @Test func givesBackTheRowWithItsRecordKeys() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["Scheduled from the harness", "and a second post"], at: s.now + 5 * WorkerSetup.hour))
    #expect(row["status"] == "pending")
    #expect(row["clientKey"] == "virga")
    #expect(row["queued"] == false)
    #expect(row["target"] == "bluesky")
    #expect(row["payload"]?["rkeys"]?.arrayValue?.count == 2)
    let got = try await req.request("/api/schedule/get", query: ["id": row["id"]])
    #expect(got["data"]?["payload"]?["posts"]?[1]?["record"]?["text"] == "and a second post")
    let media = try await req.request("/api/schedule/media", query: ["id": row["id"]])
    #expect(media["data"] == [:])
  }

  @Test func refusesAnyTargetButBlueskyAndAVideo() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    var elsewhere = s.body(["elsewhere"], at: s.now + WorkerSetup.hour)
    elsewhere["target"] = "elsewhere"
    #expect(await refusal { _ = try await s.create(req, elsewhere) }?.status == 400)
    let video = s.body(
      ["hello"], at: s.now + WorkerSetup.hour, payload: ["posts": [["record": ["text": "hello"], "embed": ["type": "video"]]]])
    let refused = await refusal { _ = try await s.create(req, video) }
    #expect(refused?.status == 400)
    #expect(refused?.message == "posts[0]: unknown embed type: video")
  }

  @Test func movesReordersRetriesAndCancelsTheAccountsRows() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let rows = try await s.list(req)
    let queued = try #require(rows.first { $0["queued"] == true && $0["status"] == "pending" })
    let moved = try await s.update(req, queued["id"], ["scheduledFor": .string(World.iso(s.now + 40 * WorkerSetup.hour))])
    #expect(moved["data"]?["scheduledFor"] == .string(World.iso(s.now + 40 * WorkerSetup.hour)))
    #expect(moved["data"]?["clientKey"] == "virga")
    let reordered = try await req.request(
      "/api/schedule/reorder", method: "POST",
      body: ["moves": [["id": queued["id"]!, "scheduledFor": .string(World.iso(s.now + 41 * WorkerSetup.hour))]]])
    #expect(reordered["moved"] == 1)
    let failed = try #require(rows.first { $0["status"] == "failed" })
    #expect(try await s.update(req, failed["id"], ["retry": true])["data"]?["status"] == "pending")
    let atTime = try #require(rows.first { $0["queued"] == false && $0["status"] == "pending" })
    let cancelled = try await req.request("/api/schedule/cancel", method: "POST", body: ["id": atTime["id"]!])
    #expect(cancelled["data"]?["status"] == "cancelled")
  }

  @Test func isUnlimitedByDefaultAndAlwaysReportsTheCaps() async throws {
    let s = WorkerSetup()
    let limits = try await s.requester().request("/api/limits/status")
    #expect(limits["policy"] == "flat")
    #expect(limits["tier"] == .null)
    #expect(limits["isMember"] == false)
    for feature in ["scheduledPosts", "postTimers", "conditionalTimers"] {
      #expect(limits["features"]?[feature] == ["isUnlimited": true, "limit": .null])
    }
    // The seeded one at a time of its own, and the queued one.
    #expect(limits["usage"]?["scheduledPosts"] == 2)
    #expect(limits["caps"] == ["scheduledPosts": 50, "timers": 200])
  }

  @Test func keepsToAScheduledPostsLimitAndSaysWhichLimitWasHit() async throws {
    let s = WorkerSetup(limits: ["scheduledPosts": 3])
    let req = s.requester()
    #expect(try await req.request("/api/limits/status")["features"]?["scheduledPosts"]?["limit"] == 3)
    _ = try await s.create(req, s.body(["third"], at: s.now + 3 * WorkerSetup.hour))
    let refused = await refusal { _ = try await s.create(req, s.body(["fourth"], at: s.now + 4 * WorkerSetup.hour)) }
    #expect(refused?.status == 409)
    #expect(refused?.codeString == "QUOTA_EXCEEDED")
    #expect(refused?.payload?["feature"] == "scheduledPosts")
    #expect(refused?.payload?["limit"] == 3)
  }

  @Test func stopsAtTheFlatCapWithNoLimitSet() async throws {
    let s = WorkerSetup(seed: false)
    let req = s.requester()
    for i in 0..<FakeServer.maxPendingScheduled {
      _ = try await s.create(req, s.body(["post \(i)"], at: s.now + Double(i + 1) * WorkerSetup.hour))
    }
    let refused = await refusal { _ = try await s.create(req, s.body(["one too many"], at: s.now + 99 * WorkerSetup.hour)) }
    #expect(refused?.status == 409)
    #expect(refused?.payload?["limit"] == .number(Double(FakeServer.maxPendingScheduled)))
  }

  @Test func publishesADueRowIntoTheWorldAtItsReservedKeyWithItsGatesAndArmsItsTimer() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let sd: JSONValue = [
      "lifespanSeconds": 10800, "deleteAt": .null,
      "conditions": ["logic": "any", "clauses": [], "sense": "unless", "onSpare": "keep", "maxExtensions": 0],
      "effects": [["action": "delete"]],
    ]
    let row = try await s.create(
      req,
      s.body(
        ["Out at noon", "with a reply"], at: s.now + WorkerSetup.hour,
        payload: ["gates": ["threadgate": [], "postgate": .null], "selfDestruct": sd]))
    #expect(row["payload"]?["selfDestruct"]?.isTruthy == true)
    s.advance(WorkerSetup.hour + 1000)
    let run = await s.server.runCron()
    #expect(run.published.map(\.id) == [row["id"]?.stringValue ?? ""])
    let rkeys = row["payload"]?["rkeys"]?.arrayValue?.compactMap(\.stringValue) ?? []
    let posts = try s.posts()
    let root = try #require(posts.first { $0.uri.hasSuffix("/\(rkeys[0])") })
    #expect(root.value["text"] == "Out at noon")
    #expect(root.value["createdAt"] == .string(World.iso(WorkerSetup.now + WorkerSetup.hour)))
    let reply = try #require(posts.first { $0.uri.hasSuffix("/\(rkeys[1])") })
    #expect(reply.value["reply"]?["parent"]?["uri"] == .string(root.uri))
    let gate = try HarnessRepo.listCollection(s.mira, "app.bsky.feed.threadgate").first { $0.value["post"] == .string(root.uri) }
    #expect(gate?.value["allow"] == [])

    let timers = try await TimerService.listTimers(BackendTimers(backend: req), context: TimerServiceContext())
    let armed = try #require(timers.rows.first { $0["postUri"] == .string(root.uri) })
    #expect(armed["status"] == "armed")
    #expect(armed["clientKey"] == "virga")

    // Three hours on, the timer takes the thread down.
    s.advance(3 * WorkerSetup.hour + 1000)
    #expect(s.now > JSDate.parse(armed["checkAt"]?.stringValue ?? "", timeZone: .gmt))
    _ = await s.server.runCron()
    let left = try s.posts().map(\.uri)
    #expect(!left.contains(root.uri))
    #expect(!left.contains(reply.uri))
    let history = try await TimerService.listTimers(BackendTimers(backend: req), history: true, context: TimerServiceContext())
    #expect(history.rows.first { $0["id"] == armed["id"] }?["status"] == "deleted")
  }

  @Test func failsARowWhoseAccountHasSignedOutOfTheServerEverywhere() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["nobody home"], at: s.now + WorkerSetup.hour))
    // Every token for the account goes, so the grant does too.
    for (token, did) in s.server.tokens where did == World.me.did { s.server.signOutToken(token) }
    s.advance(WorkerSetup.hour + 1000)
    _ = await s.server.runCron()
    let again = try await s.list(s.requester())
    let found = again.first { $0["id"] == row["id"] }
    #expect(found?["status"] == "pending")
    #expect(found?["lastErrorCode"] == "SESSION_UNAVAILABLE")
  }
}

@Suite struct TimersOnTheDemoServer {
  static let gate = "app.bsky.feed.threadgate"

  static func uri(_ rkey: String, _ did: String = World.me.did) -> String { "at://\(did)/app.bsky.feed.post/\(rkey)" }

  /// The account's own first posts with no gate of their own yet.
  static func roots(_ w: AccountWorld) throws -> [WorldPost] {
    try w.posts.filter { p in
      guard p.replyTo == nil else { return false }
      return try HarnessRepo.readRecord(w, gate, p.rkey) == nil
    }
  }

  func arm(_ s: WorkerSetup, _ req: VirgaBackend, _ body: JSONValue) async throws -> JSONValue {
    try await req.request("/api/self-destruct/create", method: "POST", body: body)
  }

  @Test func armsATimerOncePerPost201ForANewOne200ForTheSameOneAgain() async throws {
    let s = WorkerSetup()
    let token = s.server.mintToken(World.me.did)
    let uri = Self.uri(s.mira.posts[5].rkey)
    func send() async throws -> HTTPResponse {
      try await s.transport.send(
        HTTPRequest(
          method: "POST", url: "\(FakeServer.serverOrigin)/api/self-destruct/create",
          headers: ["Authorization": "Bearer \(token)", "Content-Type": "application/json"],
          body: Data(JSONStringify.stringify(s.arm(uri)).utf8)))
    }
    let first = try await send()
    #expect(first.status == 201)
    let firstBody = try first.json()
    #expect(firstBody["data"]?["status"] == "armed")
    #expect(firstBody["data"]?["clientKey"] == "virga")
    let again = try await send()
    #expect(again.status == 200)
    #expect(try again.json()["data"]?["id"] == firstBody["data"]?["id"])
  }

  @Test func keepsToAPlainTimerLimitWhenOneIsSetAndCountsWhatIsLive() async throws {
    let s = WorkerSetup(limits: ["postTimers": 1])
    let req = s.requester()
    let (a, b) = (Self.uri(s.mira.posts[5].rkey), Self.uri(s.mira.posts[6].rkey))
    _ = try await arm(s, req, s.arm(a))
    let refused = await refusal { _ = try await arm(s, req, s.arm(b)) }
    #expect(refused?.status == 409)
    #expect(refused?.codeString == "QUOTA_EXCEEDED")
    #expect(refused?.payload?["feature"] == "postTimers")
    #expect(refused?.payload?["limit"] == 1)
    let limits = try await req.request("/api/limits/status")
    // The seeded live timer is a conditional one.
    #expect(limits["usage"]?["postTimers"] == 1)
    #expect(limits["usage"]?["conditionalTimers"] == 1)
    #expect(limits["features"]?["postTimers"]?["limit"] == 1)
    #expect(limits["features"]?["conditionalTimers"]?["limit"] == .null)
  }

  @Test func refusesATimerOnSomeoneElsesPost() async throws {
    let s = WorkerSetup()
    let refused = await refusal {
      _ = try await arm(s, s.requester(), s.arm(Self.uri(s.lab.posts[0].rkey, World.lab.did)))
    }
    #expect(refused?.status == 400)
    #expect(refused?.message == "you can only set a timer on your own post")
  }

  @Test func sparesAPostWhoseRuleItMeetsAndLimitsRepliesWithoutDeleting() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let picked = s.mira.posts.filter { $0.likes >= 3 && $0.replyTo == nil }
    let (kept, gated) = (Self.uri(picked[0].rkey), Self.uri(picked[1].rkey))
    _ = try await arm(
      s, req, s.arm(kept, ["conditions": ["clauses": [["metric": "likes", "op": "gte", "value": 1]], "sense": "unless"]]))
    _ = try await arm(s, req, s.arm(gated, ["effects": [["action": "limitReplies", "allow": ["following"]]]]))
    s.advance(2 * WorkerSetup.hour)
    _ = await s.server.runCron()
    let rows = try await TimerService.listTimers(BackendTimers(backend: req), history: true, context: TimerServiceContext()).rows
    #expect(rows.first { $0["postUri"] == .string(kept) }?["status"] == "spared")
    #expect(rows.first { $0["postUri"] == .string(gated) }?["status"] == "acted")
    #expect(try s.posts().contains { $0.uri == gated })
    let gate = try HarnessRepo.listCollection(s.mira, Self.gate).first { $0.value["post"] == .string(gated) }
    #expect(gate?.value["allow"] == [["$type": "app.bsky.feed.threadgate#followingRule"]])
  }

  @Test func listsEveryTimerAsVirgasAndCallsOneOff() async throws {
    let s = WorkerSetup()
    let timers = BackendTimers(backend: s.requester())
    let context = TimerServiceContext()
    let rows = try await TimerService.listTimers(timers, history: true, context: context).rows
    #expect(!rows.isEmpty)
    #expect(Set(rows.compactMap { $0["clientKey"]?.stringValue }) == ["virga"])
    let live = try #require(try await TimerService.listTimers(timers, context: context).rows.first { $0["status"] == "armed" })
    _ = try await TimerService.cancelTimer(timers, live["id"]!, context: context)
    #expect(try await TimerService.listTimers(timers, context: context).rows.contains { $0["id"] == live["id"] } == false)
  }

  @Test func keepsOneAccountsTimersFromAnother() async throws {
    let s = WorkerSetup()
    let context = TimerServiceContext()
    let live = try #require(
      try await TimerService.listTimers(BackendTimers(backend: s.requester()), context: context).rows.first { $0["status"] == "armed" })
    let lab = BackendTimers(backend: s.requester(World.lab.did))
    #expect(try await TimerService.listTimers(lab, context: context).rows.isEmpty)
    let refused = await refusal { _ = try await TimerService.cancelTimer(lab, live["id"]!, context: context) }
    #expect(refused?.codeString == "NOT_CANCELLABLE")
  }

  @Test func rewritesAnArmedTimerOnReArm() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let live = try #require(try await req.request("/api/self-destruct/list")["data"]?.arrayValue?.first { $0["status"] == "armed" })
    let res = try await arm(
      s, req,
      s.arm(live["postUri"]?.stringValue ?? "", ["lifespanSeconds": 7200, "effects": [["action": "limitReplies", "allow": ["following"]]]]))
    #expect(res["data"]?["id"] == live["id"])
    #expect(res["data"]?["clientKey"] == "virga")
    #expect(res["data"]?["conditions"]?["clauses"] == [])
    #expect(res["data"]?["lifespanSeconds"] == 7200)
    #expect(res["data"]?["effects"] == [["action": "limitReplies", "allow": ["following"]]])
    #expect(res["data"]?["checkAt"] == .string(World.iso(WorkerSetup.now + 2 * WorkerSetup.hour)))
    let after = try await req.request("/api/self-destruct/list")["data"]?.arrayValue?.first { $0["id"] == live["id"] }
    #expect(after?["lifespanSeconds"] == 7200)
    #expect(after?["attempts"] == 0)
    #expect(after?["lastError"] == .null)
  }

  @Test func leavesATimerThatIsMidCheckAloneOnReArm() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let live = try #require(try await req.request("/api/self-destruct/list")["data"]?.arrayValue?.first { $0["status"] == "armed" })
    s.server.withRows { _, timers in
      if let i = timers.firstIndex(where: { $0.id == live["id"]?.stringValue }) { timers[i].status = "checking" }
    }
    let res = try await arm(s, req, s.arm(live["postUri"]?.stringValue ?? "", ["lifespanSeconds": 7200]))
    #expect(res["data"]?["id"] == live["id"])
    #expect(res["data"]?["lifespanSeconds"] == live["lifespanSeconds"])
    #expect(res["data"]?["checkAt"] == live["checkAt"])
  }

  @Test func narrowsAGateTheAuthorSetNeverOpensItAndLeavesAReplyAlone() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let roots = try Self.roots(s.mira)
    let (mentioned, both) = (roots[0], roots[1])
    let reply = try #require(s.mira.posts.first { $0.replyTo == World.me.did })
    func gate(_ p: WorldPost, _ allow: [JSONValue]) throws {
      try s.world.writeRecord(
        did: World.me.did, collection: Self.gate, rkey: p.rkey,
        record: [
          "$type": .string(Self.gate), "post": .string(Self.uri(p.rkey)), "createdAt": .string(World.iso(WorkerSetup.now)),
          "allow": .array(allow),
        ], now: s.now)
    }
    try gate(mentioned, [["$type": "app.bsky.feed.threadgate#mentionRule"]])
    try gate(both, [["$type": "app.bsky.feed.threadgate#followerRule"], ["$type": "app.bsky.feed.threadgate#mentionRule"]])
    for p in [mentioned, both, reply] {
      _ = try await arm(s, req, s.arm(Self.uri(p.rkey), ["effects": [["action": "limitReplies", "allow": ["follower"]]]]))
    }
    s.advance(2 * WorkerSetup.hour)
    _ = await s.server.runCron()
    let timerFor = { (p: WorldPost) in s.server.timers.first { $0.post_uri == Self.uri(p.rkey) } }
    #expect(try HarnessRepo.readRecord(s.mira, Self.gate, mentioned.rkey)?.value["allow"] == [["$type": "app.bsky.feed.threadgate#mentionRule"]])
    #expect(
      timerFor(mentioned)?.acted
        == [
          [
            "action": "limitReplies", "ok": false,
            "detail": "left the reply settings alone; the rule would have opened them up",
          ]
        ])
    #expect(try HarnessRepo.readRecord(s.mira, Self.gate, both.rkey)?.value["allow"] == [["$type": "app.bsky.feed.threadgate#followerRule"]])
    #expect(timerFor(both)?.acted == [["action": "limitReplies", "ok": true, "detail": "replies limited to your followers"]])
    #expect(try HarnessRepo.readRecord(s.mira, Self.gate, reply.rkey) == nil)
    #expect(timerFor(reply)?.acted[0]?["detail"]?.stringValue?.contains("this post is a reply") == true)
  }

  @Test func holdsTheFlatCapWhereATimerIsArmedAndLetsAPostAtTheCapChangeItsRule() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let live = try #require(s.server.timers.first { $0.user_did == World.me.did && $0.status == "armed" })
    s.server.withRows { _, timers in
      let count = timers.filter { $0.user_did == World.me.did && ["armed", "checking"].contains($0.status) }.count
      for i in count..<FakeServer.maxLiveTimers {
        var filler = live
        filler.id = "filler-\(i)"
        filler.post_uri = "\(live.post_uri)-filler-\(i)"
        timers.append(filler)
      }
    }
    let res = try await arm(s, req, s.arm(live.post_uri, ["lifespanSeconds": 7200]))
    #expect(res["data"]?["id"] == .string(live.id))
    #expect(res["data"]?["lifespanSeconds"] == 7200)
    let fresh = try #require(try Self.roots(s.mira).first { p in !s.server.timers.contains { $0.rkey == p.rkey } })
    let refused = await refusal { _ = try await arm(s, req, s.arm(Self.uri(fresh.rkey))) }
    #expect(refused?.status == 409)
    #expect(refused?.codeString == "QUOTA_EXCEEDED")
    #expect(refused?.payload?["limit"] == .number(Double(FakeServer.maxLiveTimers)))
  }
}

@Suite struct TheAdviserAndAltTextOnTheDemoServer {
  @Test func readsADraftAgainstTheWritersGoalsAndChecksItsWriting() async throws {
    let s = WorkerSetup()
    let res = try await s.requester().request(
      "/api/ai/analyze-post", method: "POST",
      body: [
        "text": "This is the the worst bus timetable", "goals": ["presets": ["reduceNegativity": true]],
        "writingChecks": ["typos": true],
      ])
    #expect(res["overallStatus"] == "caution")
    #expect(res["checks"]?[0]?["id"] == "reduceNegativity")
    #expect(res["checks"]?[0]?["status"] == "caution")
    #expect(res["writing"]?["issues"]?[0]?["type"] == "typo")
    #expect(res["writing"]?["issues"]?[0]?["found"] == "the the")
    #expect(res["writing"]?["issues"]?[0]?["replacement"] == "the")
    #expect(res["usage"] == ["used": 1, "limit": 30])
  }

  @Test func readsATextAsLongAsTheServerDoesALongThreadNotOnePost() async throws {
    #expect(FakeServer.maxAnalyzeText == 8000)
    let s = WorkerSetup()
    let req = s.requester()
    // Eleven posts of about 290 characters, joined as the adviser sends a thread.
    let thread = (0..<11).map { i -> String in
      let start = "Post \(i) "
      return start + String(repeating: "x", count: 290 - start.count)
    }.joined(separator: "\n\n")
    #expect(thread.count > 3000)
    let read = try await req.request("/api/ai/analyze-post", method: "POST", body: ["text": .string(thread), "writingChecks": ["typos": true]])
    #expect(read["overallStatus"] != nil)
    let long = await refusal {
      _ = try await req.request("/api/ai/analyze-post", method: "POST", body: ["text": .string(String(repeating: "x", count: 8001))])
    }
    #expect(long?.status == 413)
  }

  @Test func answersOkWithoutCountingWhenThereIsNothingToCheck() {
    #expect(FakeServer.analyzePost(text: "hello", goals: [:]) == nil)
  }

  @Test func stopsAtTheMonthlyAllowance() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    func send() async throws -> JSONValue {
      try await req.request("/api/ai/synthesize-style", method: "POST", body: ["posts": ["a", "b", "c", "d", "e"]])
    }
    for _ in 0..<3 { #expect(try await send()["summary"]?.isTruthy == true) }
    let refused = await refusal { _ = try await send() }
    #expect(refused?.status == 429)
    #expect(refused?.codeString == "monthly_limit")
    #expect(refused?.payload?["limit"] == 3)
    #expect(refused?.payload?["used"] == 3)
    let few = await refusal { _ = try await req.request("/api/ai/synthesize-style", method: "POST", body: ["posts": ["a"]]) }
    #expect(few?.codeString == "not_enough_posts")
  }

  @Test func countsNothingWhenAnAllowanceIsUnlimitedAndRefusesAllAtZero() async throws {
    let s = WorkerSetup(aiLimits: ["adviser": .null, "altText": 0])
    let req = s.requester()
    let read = try await req.request(
      "/api/ai/analyze-post", method: "POST", body: ["text": "I hate this", "goals": ["presets": ["reduceNegativity": true]]])
    #expect(read["usage"] == nil)
    let refused = await refusal {
      _ = try await req.request("/api/ai/alt-text", method: "POST", body: ["imageBase64": "iVBORw0KGgo=", "mimeType": "image/png"])
    }
    #expect(refused?.status == 429)
    #expect(refused?.codeString == "monthly_limit")
  }

  @Test func writesAltTextAndRevisesItFromANote() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let first = try await req.request("/api/ai/alt-text", method: "POST", body: ["imageBase64": "iVBORw0KGgo=", "mimeType": "image/png"])
    #expect(first["altText"]?.isTruthy == true)
    #expect(first["usage"] == ["used": 1, "limit": 15])
    let second = try await req.request(
      "/api/ai/alt-text", method: "POST",
      body: [
        "imageBase64": "iVBORw0KGgo=", "mimeType": "image/png", "followUp": "Mention the rain",
        "previousAltText": first["altText"] ?? .null,
      ])
    #expect(second["altText"]?.stringValue?.contains("mention the rain") == true)
  }

  @Test func takesAsLongAsItSaysAndCanBeDown() async throws {
    let s = WorkerSetup(aiDelayMs: 900)
    _ = try await s.requester().request("/api/ai/alt-text", method: "POST", body: ["imageBase64": "abc", "mimeType": "image/png"])
    #expect(s.sleeps.wrappedValue == [900])
    let slow = WorkerSetup(ai: "slow")
    _ = try await slow.requester().request("/api/ai/alt-text", method: "POST", body: ["imageBase64": "abc", "mimeType": "image/png"])
    #expect(slow.sleeps.wrappedValue == [14_000])
    let down = WorkerSetup(ai: "down")
    let refused = await refusal {
      _ = try await down.requester().request("/api/ai/alt-text", method: "POST", body: ["imageBase64": "abc", "mimeType": "image/png"])
    }
    #expect(refused?.status == 503)
    #expect(refused?.message == "The AI gateway is unavailable right now.")
    #expect(down.sleeps.wrappedValue.isEmpty)
  }
}

@Suite struct ScheduledRepliesAndRepeatsOnTheDemoServer {
  /// A reply, as the composer sends it, to the first post Field Lab has.
  static func reply(_ s: WorkerSetup) throws -> (payload: [String: JSONValue], ref: JSONValue) {
    let found = try #require(try HarnessRepo.readRecord(s.lab, "app.bsky.feed.post", s.lab.posts[0].rkey))
    let ref: JSONValue = ["uri": .string(found.uri), "cid": .string(found.cid)]
    return (
      [
        "reply": ["root": ref, "parent": ref],
        "replyTo": ["handle": .string(World.lab.handle), "displayName": "Field Lab", "text": found.value["text"] ?? ""],
      ], ref
    )
  }

  @Test func schedulesAReplyListsWhatItAnswersAndPublishesItUnderItsParent() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let (payload, ref) = try Self.reply(s)
    var extra = payload
    extra["gates"] = ["threadgate": [], "postgate": .null]
    let row = try await s.create(req, s.body(["Count me in", "and I’ll bring the ladder"], at: s.now + WorkerSetup.hour, payload: extra))
    #expect(row["payload"]?["reply"] == ["root": ref, "parent": ref])
    #expect(row["payload"]?["replyTo"]?["handle"] == .string(World.lab.handle))
    #expect(row["payload"]?["gates"] == ["threadgate": .null, "postgate": .null])
    s.advance(WorkerSetup.hour + 1000)
    #expect(await s.server.runCron().published.map(\.id) == [row["id"]?.stringValue ?? ""])
    let keys = row["payload"]?["rkeys"]?.arrayValue?.compactMap(\.stringValue) ?? []
    let first = try #require(try HarnessRepo.readRecord(s.mira, "app.bsky.feed.post", keys[0]))
    #expect(first.value["reply"] == ["root": ref, "parent": ref])
    let second = try #require(try HarnessRepo.readRecord(s.mira, "app.bsky.feed.post", keys[1]))
    #expect(second.value["reply"] == ["root": ref, "parent": ["uri": .string(first.uri), "cid": .string(first.cid)]])
    #expect(try HarnessRepo.listCollection(s.mira, "app.bsky.feed.threadgate").contains { $0.value["post"] == .string(first.uri) } == false)
  }

  @Test func doesNotPostAReplyWhoseParentIsGoneByItsTimeAndSaysWhy() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["Too late"], at: s.now + WorkerSetup.hour, payload: try Self.reply(s).payload))
    let before = try s.posts().count
    try s.world.removeRecord(did: World.lab.did, collection: "app.bsky.feed.post", rkey: s.lab.posts[0].rkey)
    s.advance(WorkerSetup.hour + 1000)
    #expect(await s.server.runCron().published.isEmpty)
    #expect(try s.posts().count == before)
    let failed = try await s.list(req).first { $0["id"] == row["id"] }
    #expect(failed?["status"] == "failed")
    #expect(failed?["lastErrorCode"] == "REPLY_TARGET_GONE")
    #expect(failed?["attempts"] == 1)
    #expect(failed?["lastError"]?.stringValue?.contains("has been deleted, so the reply was not posted") == true)
  }

  @Test func keepsAReplyOutOfTheQueueAndFromRepeatingWithTheServersCodes() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let payload = try Self.reply(s).payload
    let queued = await refusal { _ = try await s.create(req, s.body(["hi"], at: s.now + WorkerSetup.hour, payload: payload, queued: true)) }
    #expect(queued?.status == 400)
    #expect(queued?.codeString == "QUEUE_REPLY")
    var repeating = payload
    repeating["repeat"] = ["every": "day", "tz": "UTC"]
    let repeated = await refusal { _ = try await s.create(req, s.body(["hi"], at: s.now + WorkerSetup.hour, payload: repeating)) }
    #expect(repeated?.codeString == "REPEAT_REPLY")
    var half = payload
    half["reply"] = ["root": payload["reply"]?["root"] ?? .null]
    #expect(await refusal { _ = try await s.create(req, s.body(["hi"], at: s.now + WorkerSetup.hour, payload: half)) }?.status == 400)
  }

  @Test func startsASeriesPublishesAnOccurrenceAndLeavesTheNextOneWaiting() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(
      req, s.body(["Every day at one"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "day", "tz": "UTC", "count": 3]]))
    #expect(row["occurrence"] == 1)
    #expect(row["status"] == "pending")
    #expect(row["seriesId"]?.isTruthy == true)
    #expect(
      row["payload"]?["repeat"]
        == [
          "every": "day", "tz": "UTC", "until": .null, "count": 3,
          "anchor": ["date": "2026-11-12", "time": "13:00", "occurrence": 1],
        ])
    let used = try await req.request("/api/limits/status")["usage"]?["scheduledPosts"]
    s.advance(WorkerSetup.hour + 1000)
    #expect(await s.server.runCron().published.map(\.id) == [row["id"]?.stringValue ?? ""])
    let waiting = try await s.list(req).filter { $0["seriesId"] == row["seriesId"] }
    #expect(waiting.count == 1)
    #expect(waiting.first?["status"] == "pending")
    #expect(waiting.first?["occurrence"] == 2)
    #expect(waiting.first?["scheduledFor"] == .string(World.iso(WorkerSetup.now + WorkerSetup.hour + WorkerSetup.day)))
    #expect(waiting.first?["payload"]?["repeat"] == row["payload"]?["repeat"])
    #expect(waiting.first?["payload"]?["rkeys"]?[0] != row["payload"]?["rkeys"]?[0])
    // The series holds one slot, before and after.
    #expect(try await req.request("/api/limits/status")["usage"]?["scheduledPosts"] == used)
    // Each occurrence is a record of its own, and the third is the last.
    for _ in 0..<3 {
      s.advance(WorkerSetup.day)
      _ = await s.server.runCron()
    }
    let mine = try s.posts().filter { $0.value["text"] == "Every day at one" }
    #expect(mine.count == 3)
    #expect(Set(mine.map(\.uri)).count == 3)
    #expect(try await s.list(req).filter { $0["seriesId"] == row["seriesId"] }.isEmpty)
  }

  @Test func skipsAnOccurrenceStopsRepeatingAndEndsASeries() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["Weekly"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "week", "tz": "UTC"]]))
    let skipped = try await s.update(req, row["id"], ["skip": true])
    #expect(skipped["ended"] == false)
    #expect(skipped["data"]?["occurrence"] == 2)
    #expect(skipped["data"]?["seriesId"] == row["seriesId"])
    #expect(skipped["data"]?["scheduledFor"] == .string(World.iso(WorkerSetup.now + WorkerSetup.hour + 7 * WorkerSetup.day)))
    let again = await refusal { _ = try await s.update(req, row["id"], ["skip": true]) }
    #expect(again?.status == 409)
    #expect(again?.codeString == "NOT_SKIPPABLE")
    let next = skipped["data"]?["id"]
    let stopped = try await s.update(req, next, ["stopRepeat": true])
    #expect(stopped["data"]?["payload"]?["repeat"] == nil)
    #expect(await refusal { _ = try await s.update(req, next, ["stopRepeat": true]) }?.codeString == "NOT_REPEATING")
    // It goes out its one last time, and nothing follows.
    s.advance(WorkerSetup.hour + 7 * WorkerSetup.day + 1000)
    #expect(await s.server.runCron().published.map(\.id).contains(next?.stringValue ?? ""))
    #expect(try await s.list(req).filter { $0["seriesId"] == row["seriesId"] }.isEmpty)
    // Removing the waiting occurrence ends a series; skipping the last one ends it too.
    let twice = try await s.create(
      req, s.body(["Twice"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "day", "tz": "UTC", "count": 2]]))
    let last = try await s.update(req, twice["id"], ["skip": true])["data"]?["id"]
    let ended = try await s.update(req, last, ["skip": true])
    #expect(ended["data"] == .null)
    #expect(ended["ended"] == true)
  }

  @Test func keepsARepeatingPostsPictureForTheNextOccurrenceAndDropsItWhenTheSeriesEnds() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(
      req,
      s.body(
        ["With a picture"], at: s.now + WorkerSetup.hour,
        payload: [
          "posts": [["record": ["text": "With a picture"], "embed": ["type": "images", "images": [["mediaId": "p0-img0", "alt": "four bytes"]]]]],
          "mediaBytes": ["p0-img0": ["base64": "AQIDBA==", "encoding": "image/png"]],
          "repeat": ["every": "day", "tz": "UTC", "count": 2],
        ]))
    s.advance(WorkerSetup.hour + 1000)
    _ = await s.server.runCron()
    let next = try #require(try await s.list(req).first { $0["seriesId"] == row["seriesId"] })
    #expect(try await req.request("/api/schedule/media", query: ["id": next["id"]])["data"]?.objectValue?.keys.sorted() == ["p0-img0"])
    s.advance(WorkerSetup.day)
    _ = await s.server.runCron()
    let posts = try s.posts().filter { $0.value["text"] == "With a picture" }
    #expect(posts.count == 2)
    #expect(posts.allSatisfy { $0.value["embed"]?["images"]?.arrayValue?.count == 1 })
    // The series is over: Virga's server no longer holds the picture.
    #expect(try await req.request("/api/schedule/media", query: ["id": next["id"]])["data"] == [:])
  }

  @Test func goesOnFromItsSchedulePastAnOccurrenceThatFailedKeepingTheFailureToRetry() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["Daily"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "day", "tz": "UTC"]]))
    s.server.refuseGrant(World.me.did)
    // Five attempts with backoff use the row up.
    for i in 0..<6 {
      s.advance(i == 0 ? WorkerSetup.hour + 1000 : 61 * 60_000)
      _ = await s.server.runCron()
    }
    let rows = try await s.list(req).filter { $0["seriesId"] == row["seriesId"] }
    #expect(rows.map { [$0["occurrence"] ?? .null, $0["status"] ?? .null] } == [[1, "failed"], [2, "pending"]])
    #expect(rows.first?["payload"]?["repeat"] == nil)
    #expect(rows.last?["payload"]?["repeat"]?["every"] == "day")
  }

  @Test func changesThisAndLaterOccurrencesWhenTheWaitingOneIsEdited() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let row = try await s.create(req, s.body(["Old words"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "day", "tz": "UTC"]]))
    let next = try await s.update(req, row["id"], ["skip": true])["data"]?["id"]
    var edit = s.body(["New words"], at: s.now + 2 * WorkerSetup.day, payload: ["repeat": ["every": "week", "tz": "UTC", "count": 5]])
    let edited = try await s.update(req, next, edit.objectValue ?? [:])["data"]
    #expect(edited?["id"] == next)
    #expect(edited?["seriesId"] == row["seriesId"])
    #expect(edited?["occurrence"] == 2)
    #expect(edited?["payload"]?["repeat"]?["every"] == "week")
    #expect(edited?["payload"]?["repeat"]?["count"] == 5)
    #expect(edited?["payload"]?["repeat"]?["anchor"]?["occurrence"] == 2)
    #expect(edited?["payload"]?["posts"]?[0]?["record"]?["text"] == "New words")
    // Saved without a rule, it stops repeating.
    edit = s.body(["New words"], at: s.now + 2 * WorkerSetup.day)
    let plain = try await s.update(req, next, edit.objectValue ?? [:])["data"]
    #expect(plain?["payload"]?["repeat"] == nil)
  }

  @Test func refusesWhatTheServerRefusesAQueuedRepeatABadRule() async throws {
    let s = WorkerSetup()
    let req = s.requester()
    let queued = await refusal {
      _ = try await s.create(req, s.body(["x"], at: s.now + WorkerSetup.hour, payload: ["repeat": ["every": "day", "tz": "UTC"]], queued: true))
    }
    #expect(queued?.codeString == "QUEUE_REPEAT")
    let words = [
      "repeat.every must be one of: day, week, 2weeks, month",
      "a post that repeats a number of times goes out at least twice.",
      "a repeating post ends on a date or after a number of times, not both.",
      "the date a repeating post ends on is before it next goes out.",
      "repeat.tz must be a time zone this server knows",
    ]
    let rules: [JSONValue] = [
      ["every": "hour", "tz": "UTC"], ["every": "day", "tz": "UTC", "count": 1],
      ["every": "day", "tz": "UTC", "count": 3, "until": "2027-01-01"], ["every": "day", "tz": "UTC", "until": "2026-01-01"],
      ["every": "day", "tz": "Mars/Olympus"],
    ]
    for (rule, word) in zip(rules, words) {
      var body = s.body(["x"], at: s.now + WorkerSetup.hour, payload: ["repeat": rule])
      body["payload"]?["tz"] = nil
      let refused = await refusal { _ = try await s.create(req, body) }
      #expect(refused?.status == 400, "\(rule)")
      #expect(refused?.detail == word, "\(rule)")
    }
  }
}

@Suite struct DefenseOnTheDemoServer {
  static let now: Double = JSDate.parse("2026-11-18T12:00:00.000Z", timeZone: .gmt)

  /// fakeDefense.test.js's `setup({ level, writes })`.
  struct Setup {
    let world: DemoWorld
    let server: DemoServer
    let req: VirgaBackend
    let labReq: VirgaBackend

    init(level: Harness.DefenseLevel = .lists, writes: Bool = true) {
      world = DemoWorld(now: DefenseOnTheDemoServer.now, scope: Harness.withDefense(AppConfig.oauthScope, level))
      server = DemoServer(world: world, seed: false, defenseWrites: writes, now: { DefenseOnTheDemoServer.now })
      let transport = DemoTransport(world: world, server: server, latency: 0, clock: .instant(now: DefenseOnTheDemoServer.now))
      let (mira, lab) = (server.mintToken(World.me.did), server.mintToken(World.lab.did))
      req = VirgaBackend(backendUrl: FakeServer.serverOrigin, token: { mira }, did: World.me.did, transport: transport)
      labReq = VirgaBackend(backendUrl: FakeServer.serverOrigin, token: { lab }, did: World.lab.did, transport: transport)
    }

    var mira: AccountWorld { world.world(World.me.did)! }
    var lab: AccountWorld { world.world(World.lab.did)! }
  }

  struct Row: Encodable {
    var did: String
    var band: String
    var trust: Double?
  }

  /// Who is on one list, by its items in the world's repo.
  static func items(_ w: AccountWorld, _ uri: JSONValue?) throws -> [String] {
    try HarnessRepo.listCollection(w, "app.bsky.graph.listitem").filter { uri == nil || $0.value["list"] == uri }
      .compactMap { $0.value["subject"]?.stringValue }.sorted()
  }

  @Test func makesAListApprovesAPlanAndWritesItOnTheNextTick() async throws {
    let s = Setup()
    let list = try await DefenseService.createList(s.req, name: "Pile-ons", purpose: "block")
    #expect(list["name"] == "Pile-ons")
    #expect(list["purpose"] == "block")
    #expect(list["mode"] == "own")
    #expect(list["listed"] == 0)
    #expect(try HarnessRepo.listCollection(s.mira, "app.bsky.graph.list").contains { $0.value["name"] == "Pile-ons" })

    let followed = try #require(s.mira.follows.first?.value["subject"]?.stringValue)
    let out = try await DefenseService.planAndApprove(
      s.req, listId: list["id"] ?? .null, postUri: nil,
      rows: [
        Row(did: "did:plc:virgaharnesscrowd00001", band: "UNKNOWN", trust: 1),
        Row(did: "did:plc:virgaharnesscrowd00002", band: "UNKNOWN", trust: 1),
        // Followed since the scan: the veto at the write keeps them off.
        Row(did: followed, band: "UNKNOWN", trust: 1),
      ], totals: [String: Int](), bands: ["UNKNOWN"], note: "the quote pile-on")
    #expect(out["queued"] == 3)
    #expect(out["kept"] == 0)
    #expect(out["already"] == 0)
    #expect(try await DefenseService.fetchLists(s.req)["lists"]?[0]?["waiting"] == 3)

    _ = await s.server.runCron()
    #expect(try Self.items(s.mira, list["uri"]) == ["did:plc:virgaharnesscrowd00001", "did:plc:virgaharnesscrowd00002"])
    let history = try await DefenseService.fetchHistory(s.req)
    let vetoed = history["decisions"]?.arrayValue?.first { $0["did"] == .string(followed) }
    #expect(vetoed?["state"] == "vetoed")
    #expect(vetoed?["reason"] == "you follow them")
    #expect(history["plans"]?[0]?["note"] == "the quote pile-on")
    #expect(history["plans"]?[0]?["bands"] == ["UNKNOWN"])
    let after = try await DefenseService.fetchLists(s.req)["lists"]?[0]
    #expect(after?["listed"] == 2)
    #expect(after?["waiting"] == 0)

    _ = try await DefenseService.undoAdds(s.req, planId: history["plans"]?[0]?["id"])
    _ = await s.server.runCron()
    #expect(try Self.items(s.mira, list["uri"]).isEmpty)
  }

  @Test func leavesOutThePeopleKeptByHandAndKeepsOneAccountsListsFromAnothers() async throws {
    let s = Setup()
    let list = try await DefenseService.createList(s.req, name: "Pile-ons", purpose: "mute")
    _ = try await DefenseService.keepAccount(s.req, "did:plc:virgaharnesscrowd00003", "an old friend")
    let out = try await DefenseService.planAndApprove(
      s.req, listId: list["id"] ?? .null, postUri: nil,
      rows: [Row(did: "did:plc:virgaharnesscrowd00003", band: "UNKNOWN"), Row(did: "did:plc:virgaharnesscrowd00004", band: "UNKNOWN")],
      totals: [String: Int](), bands: ["UNKNOWN"], note: nil)
    #expect(out["queued"] == 1)
    #expect(out["kept"] == 1)
    let refused = await refusal {
      _ = try await DefenseService.planAndApprove(
        s.labReq, listId: list["id"] ?? .null, postUri: nil, rows: [Row(did: "did:plc:virgaharnesscrowd00005", band: "UNKNOWN")],
        totals: [String: Int](), bands: ["UNKNOWN"], note: nil)
    }
    #expect(refused?.status == 404)
    #expect(try await DefenseService.fetchLists(s.labReq)["lists"] == [])
    _ = await s.server.runCron()
    #expect(try Self.items(s.mira, list["uri"]) == ["did:plc:virgaharnesscrowd00004"])
    #expect(try Self.items(s.lab, list["uri"]).isEmpty)
  }

  @Test func refusesToMakeAListWithoutThePermissionOrWhileWritesAreOff() async throws {
    let scan = Setup(level: .scan)
    #expect(await refusal { _ = try await DefenseService.createList(scan.req, name: "X", purpose: "block") }?.codeString == "NO_SCOPE")
    let off = Setup(writes: false)
    #expect(try await DefenseService.fetchLists(off.req)["writes"] == false)
    #expect(await refusal { _ = try await DefenseService.createList(off.req, name: "X", purpose: "block") }?.codeString == "WRITES_OFF")
  }
}

/// A clock whose waits a test releases, one at a time: each `sleep` is
/// announced on `requests` only once it is waiting.
final class GatedClock: Sendable {
  let time: Locked<Double>
  let waiting = Locked<[CheckedContinuation<Void, Never>]>([])
  let requests: AsyncStream<Double>
  private let announce: AsyncStream<Double>.Continuation

  init(now: Double) {
    time = Locked(now)
    (requests, announce) = AsyncStream<Double>.makeStream()
  }

  var clock: NetworkClock {
    NetworkClock(
      now: { [time] in time.wrappedValue },
      sleep: { [waiting, announce] ms in
        await withCheckedContinuation { c in
          waiting.withLock { $0.append(c) }
          announce.yield(ms)
        }
      })
  }

  func release() {
    let held = waiting.withLock { held -> [CheckedContinuation<Void, Never>] in
      defer { held.removeAll() }
      return held
    }
    for c in held { c.resume() }
  }
}

@Suite struct TheHarnessWorkers {
  static let now: Double = WorkerSetup.now

  @Test func cronRunsTheServersWorkersNow() async throws {
    let time = Locked(Self.now)
    let harness = DemoHarness(
      flags: Harness.readFlags("?accounts=1"), now: Self.now,
      clock: NetworkClock(now: { time.wrappedValue }, sleep: { _ in await Task.yield() }))
    // The workers act with the grant a sign-in leaves on the server.
    _ = harness.server.mintToken(World.me.did)
    #expect(await harness.cron().published.isEmpty)
    // Three days on, the seeded swap and queued posts are due, and the live timer.
    time.withLock { $0 += 3 * WorkerSetup.day }
    let run = await harness.cron()
    #expect(run.published.count == 2)
    #expect(run.published.allSatisfy { $0.status == "published" })
    #expect(run.settled.count == 1)
    #expect(run.listed == 0)
  }

  @Test func startCronRunsTheWorkersEveryIntervalUntilStopped() async throws {
    let gated = GatedClock(now: Self.now)
    let harness = DemoHarness(flags: Harness.readFlags("?accounts=1&cron=20"), now: Self.now, clock: gated.clock)
    var requests = gated.requests.makeAsyncIterator()
    _ = harness.server.mintToken(World.me.did)
    harness.startCron()
    #expect(harness.cronRunning)
    #expect(await requests.next() == 20_000)
    #expect(harness.server.scheduled.filter { $0.status == "published" }.count == 1)
    // A tick, two days on: the seeded posts that came due go out.
    gated.time.withLock { $0 += 2 * WorkerSetup.day + 60_000 }
    gated.release()
    #expect(await requests.next() == 20_000)
    #expect(harness.server.scheduled.filter { $0.status == "published" }.count == 3)
    harness.stopCron()
    #expect(!harness.cronRunning)
    gated.release()
  }

  @Test func startsNoTimerWhenCronIsZero() {
    let harness = DemoHarness(flags: Harness.readFlags("?cron=0"), now: Self.now, clock: .instant(now: Self.now))
    harness.startCron()
    #expect(!harness.cronRunning)
  }

  @Test func theServersFlagsReachTheServer() async throws {
    let harness = DemoHarness(
      flags: Harness.readFlags("?limits=3,1,0&ailimits=unlimited&ai=down&defensewrites=off&moderator=off"), now: Self.now,
      clock: .instant(now: Self.now))
    #expect(harness.server.featureLimits == ["scheduledPosts": 3, "postTimers": 1])
    #expect(harness.server.aiAllowance.isEmpty)
    #expect(harness.server.ai == "down")
    #expect(harness.server.defense.writes == false)
    #expect(harness.server.defense.moderatorHandle == nil)
    let defaults = DemoHarness(flags: Harness.readFlags(""), now: Self.now, clock: .instant(now: Self.now))
    #expect(defaults.server.aiAllowance == ["adviser": 30, "altText": 15, "style": 3])
    #expect(defaults.server.featureLimits.isEmpty)
    // And through the demo's options.
    let options = DemoOptions.read("?limits=2&ai=slow&moderator=linked&cron=5")
    #expect(options.flags.limits.scheduledPosts == 2)
    #expect(options.flags.ai == "slow")
    #expect(options.flags.moderator == "linked")
    #expect(options.flags.cronSeconds == 5)
  }
}
