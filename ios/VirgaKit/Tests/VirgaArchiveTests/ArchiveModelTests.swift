// Behaviour of ArchiveModel beyond the recorded scenarios: what it refuses
// to do, calling a sync off, hearing of posts made elsewhere, follows the
// PDS won't write, an archive that survives a restart in a file store, and
// the exports. Against MockTransport.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaArchive

private let me = "did:plc:modeltestowner2345678ab"
private let cid = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
private let now: Double = 1_794_657_600_000

/// A small account: two followers, no follows or blocks, no repo (so likes
/// and reposts are walked), two posts and one notification.
private func smallWorld(_ transport: MockTransport, hangFeed: Bool = false) {
  let post = { (rkey: String, at: String) -> JSONValue in
    [
      "post": [
        "uri": .string("at://\(me)/app.bsky.feed.post/\(rkey)"), "cid": .string(cid),
        "author": ["did": .string(me), "handle": "owner.test"],
        "record": ["$type": "app.bsky.feed.post", "text": .string("post \(rkey)"), "createdAt": .string(at)],
        "likeCount": 3, "indexedAt": .string(at),
      ]
    ]
  }
  transport
    .on(.path("/xrpc/app.bsky.actor.getProfile"), respond: .json(["did": .string(me), "handle": "owner.test", "followersCount": 2]))
    .on(
      .path("/xrpc/app.bsky.graph.getFollowers"),
      respond: .json([
        "subject": ["did": .string(me), "handle": "owner.test"],
        "followers": [["did": "did:plc:ana", "handle": "ana.test"], ["did": "did:plc:bo", "handle": "bo.test"]],
      ]))
    .on(.path("/xrpc/com.atproto.repo.listRecords"), respond: .json(["records": []]))
    .on(.path("/xrpc/blue.microcosm.links.getBacklinks"), respond: .json(["records": []]))
    .on(.path("/xrpc/blue.microcosm.links.getManyToMany"), respond: .json(["items": []]))
    .on(
      .urlPrefix("https://plc.directory/"),
      respond: .json(["id": .string(me), "service": [["id": "#atproto_pds", "serviceEndpoint": "https://pds.example"]]]))
    .on(.path("/xrpc/com.atproto.sync.getRepo"), respond: .json(["error": "RepoNotFound"], status: 400))
    .on(
      .path("/xrpc/app.bsky.notification.listNotifications"),
      respond: .json([
        "notifications": [
          [
            "uri": "at://did:plc:fan/app.bsky.feed.like/1", "cid": .string(cid), "author": ["did": "did:plc:fan", "handle": "fan.test"],
            "reason": "like", "record": ["createdAt": "2026-11-13T12:00:00.000Z"], "isRead": false,
            "indexedAt": "2026-11-13T12:00:00.000Z",
          ]
        ]
      ]))
  if hangFeed {
    transport.on(.path("/xrpc/app.bsky.feed.getAuthorFeed"), respond: .hang)
  } else {
    transport.on(
      .path("/xrpc/app.bsky.feed.getAuthorFeed"),
      respond: .json(["feed": [post("3b", "2026-11-12T12:00:00.000Z"), post("3a", "2026-11-01T12:00:00.000Z")]]))
  }
}

@MainActor
private func model(
  _ transport: MockTransport, files: (any FileStore)? = nil, registry: AnalyticsStoreRegistry = AnalyticsStoreRegistry(),
  agent: Bool = true, postsChanged: PostsChangedListener? = nil
) -> ArchiveModel {
  let env = ArchiveEnvironment(
    files: files, registry: registry, transport: transport, clock: .instant(now: now), didDocuments: PromiseCache(),
    timeZone: TimeZone(identifier: "UTC")!, locale: "en-US", postsChanged: postsChanged)
  return ArchiveModel(
    agent: agent ? XRPCAgent(service: "https://pds.example", transport: transport) : nil, did: me, handle: "owner.test",
    environment: env)
}

/// A listener the test can fire, as the posting events bus would.
final class FakePostingEvents: @unchecked Sendable {
  private let handlers = Locked<[String: @Sendable (JSONValue) -> Void]>([:])

  var listener: PostsChangedListener {
    { [handlers] did, fn in
      handlers.withLock { $0[did] = fn }
      return { handlers.withLock { $0[did] = nil } }
    }
  }

  var listening: Bool { !handlers.wrappedValue.isEmpty }

  func fire(_ did: String, _ detail: JSONValue) {
    handlers.wrappedValue[did]?(detail)
  }
}

@Suite(.serialized) @MainActor struct ArchiveModelBehaviour {
  @Test func aFirstBuildIsAButtonNeverASurprise() async {
    let transport = MockTransport()
    smallWorld(transport)
    let m = model(transport)
    await m.start()
    #expect(m.data.loaded)
    #expect(m.isBuilt == false)
    #expect(transport.requests.isEmpty)
    await m.runSync()
    #expect(m.isBuilt)
    #expect(m.data.posts.map(\.uri).count == 2)
    #expect(m.data.followers.count == 2)
    #expect(m.data.inbound.count == 1)
    #expect(m.sync == nil)
    #expect(m.syncError == "repo: HTTP 400 from getRepo")
    #expect(m.data.meta.posts?.complete == true)
    #expect(m.data.meta.posts?.shape == Analytics.postRowVersion)
    #expect(m.nowMs == now)
  }

  @Test func nothingSyncsWithoutAnAgent() async {
    let transport = MockTransport()
    smallWorld(transport)
    let m = model(transport, agent: false)
    await m.start()
    await m.runSync()
    #expect(transport.requests.isEmpty)
    #expect(m.sync == nil)
    #expect(m.isBuilt == false)
  }

  @Test func aSecondSyncWhileOneRunsIsIgnored() async {
    let transport = MockTransport()
    smallWorld(transport, hangFeed: true)
    let m = model(transport)
    await m.start()
    let first = Task { await m.runSync() }
    while transport.requests.allSatisfy({ !$0.url.contains("getAuthorFeed") }) { await Task.yield() }
    #expect(m.isSyncing)
    let before = transport.requests.count
    await m.runSync(.full)
    #expect(transport.requests.count == before)
    m.cancelSync()
    await first.value
    #expect(m.isSyncing == false)
  }

  @Test func callingASyncOffKeepsWhatItBanked() async {
    let transport = MockTransport()
    smallWorld(transport, hangFeed: true)
    let m = model(transport)
    await m.start()
    let running = Task { await m.runSync() }
    while transport.requests.allSatisfy({ !$0.url.contains("getAuthorFeed") }) { await Task.yield() }
    m.cancelSync()
    await running.value
    #expect(m.sync == nil)
    #expect(m.syncError == "repo: HTTP 400 from getRepo")
    // The followers were banked before the call-off; the build reads as
    // underway, so the next mount resumes it.
    #expect(m.data.followers.count == 2)
    #expect(m.data.meta.posts?.complete == false)
    #expect(!transport.requests.contains { $0.url.contains("listNotifications") })
  }

  @Test func cancellingTheMountCallsOffItsSync() async {
    let transport = MockTransport()
    smallWorld(transport)
    let registry = AnalyticsStoreRegistry()
    let first = model(transport, registry: registry)
    await first.start()
    await first.runSync()
    first.stop()

    // An hour and more later the mount tops it up; cancelling the mount's
    // task stops the sync it started.
    let late = MockTransport()
    smallWorld(late, hangFeed: true)
    let env = ArchiveEnvironment(
      files: nil, registry: registry, transport: late, clock: .instant(now: now + 2 * 3_600_000), didDocuments: PromiseCache(),
      timeZone: TimeZone(identifier: "UTC")!, locale: "en-US")
    let m = ArchiveModel(agent: XRPCAgent(service: "https://pds.example", transport: late), did: me, handle: nil, environment: env)
    let mount = Task { await m.start() }
    while late.requests.allSatisfy({ !$0.url.contains("getAuthorFeed") }) { await Task.yield() }
    mount.cancel()
    await mount.value
    #expect(m.isSyncing == false)
    #expect(m.sync == nil)
  }

  @Test func hearsOfPostsMadeAndDeletedElsewhere() async throws {
    let transport = MockTransport()
    smallWorld(transport)
    let events = FakePostingEvents()
    let m = model(transport, postsChanged: events.listener)
    await m.start()
    #expect(events.listening)
    // Before the first build: nothing to add to.
    await m.notePosted([PostedItem(uri: "at://\(me)/app.bsky.feed.post/3c", record: ["text": "x", "createdAt": "2026-11-14T00:00:00.000Z"])])
    #expect(m.data.posts.isEmpty)

    await m.runSync()
    let rev = m.data.rev
    events.fire(
      me,
      [
        "did": .string(me),
        "added": [["uri": .string("at://\(me)/app.bsky.feed.post/3c"), "record": ["text": "new", "createdAt": "2026-11-14T00:00:00.000Z"]]],
        "removed": [.string("at://\(me)/app.bsky.feed.post/3a")],
      ])
    for _ in 0..<100 where m.data.rev == rev { await Task.yield() }
    #expect(m.data.rev == rev + 1)
    #expect(m.data.posts.map(\.uri).sorted() == ["at://\(me)/app.bsky.feed.post/3b", "at://\(me)/app.bsky.feed.post/3c"])
    // Another account's post isn't this archive's.
    await m.noteDeleted(["at://did:plc:other/app.bsky.feed.post/3b"])
    #expect(m.data.rev == rev + 1)
    m.stop()
    #expect(events.listening == false)
  }

  @Test func aFollowThePDSWontWriteThrows() async throws {
    let transport = MockTransport()
    smallWorld(transport)
    transport.on("POST", .path("/xrpc/com.atproto.repo.createRecord"), respond: .json(["cid": .string(cid)]))
    let m = model(transport)
    await m.start()
    await #expect(throws: AnalyticsSyncError.self) { try await m.setFollow("did:plc:cy", true) }
    #expect(m.data.following.isEmpty)
    #expect(m.data.followRev == 0)
    // Nobody to follow is nothing to do.
    try await m.setFollow(nil, true)
    try await m.setFollow("", false)
  }

  @Test func followsAreWrittenAndEveryRecordForAnAccountIsDeleted() async throws {
    let transport = MockTransport()
    smallWorld(transport)
    transport
      .on("POST", .path("/xrpc/com.atproto.repo.createRecord"), times: 1, respond: .json(["uri": .string("at://\(me)/app.bsky.graph.follow/3f1"), "cid": .string(cid)]))
      .on("POST", .path("/xrpc/com.atproto.repo.createRecord"), times: 1, respond: .json(["uri": .string("at://\(me)/app.bsky.graph.follow/3f2"), "cid": .string(cid)]))
      .on("POST", .path("/xrpc/com.atproto.repo.deleteRecord"), respond: .json([:]))
    let m = model(transport)
    await m.start()
    try await m.setFollow("did:plc:cy", true)
    try await m.setFollow("did:plc:cy", true)
    #expect(m.data.following.map(\.uri) == ["at://\(me)/app.bsky.graph.follow/3f1", "at://\(me)/app.bsky.graph.follow/3f2"])
    #expect(m.data.following.first?.followedAt == JSDate.toISOString(now))
    #expect(m.data.followRev == 2)
    let create = try #require(transport.requests.first { $0.url.contains("createRecord") })
    let body = try JSONValue.parse(try #require(create.body))
    #expect(body["record"]?["subject"] == .string("did:plc:cy"))
    #expect(body["record"]?["$type"] == .string("app.bsky.graph.follow"))
    try await m.setFollow("did:plc:cy", false)
    #expect(m.data.following.isEmpty)
    #expect(transport.requests.filter { $0.url.contains("deleteRecord") }.count == 2)
    #expect(m.data.followRev == 3)
  }

  @Test func anArchiveInAFileStoreSurvivesARestart() async {
    let files = InMemoryFileStore()
    let transport = MockTransport()
    smallWorld(transport)
    let first = model(transport, files: files)
    await first.start()
    await first.runSync()
    #expect(first.data.persistent)
    first.stop()

    // A new launch: a fresh registry, the same files, and nothing on the network.
    let quiet = MockTransport()
    let again = model(quiet, files: files)
    await again.start()
    #expect(again.data.persistent)
    #expect(again.data.posts.map(\.uri).sorted() == first.data.posts.map(\.uri).sorted())
    #expect(again.data.followers == first.data.followers)
    #expect(again.data.meta == first.data.meta)
    // Fresh (synced just now), so no automatic top-up.
    #expect(quiet.requests.isEmpty)
  }

  @Test func exportsCarryTheAccountsNameAndDay() async throws {
    let transport = MockTransport()
    smallWorld(transport)
    let m = model(transport)
    await m.start()
    await m.runSync()
    let file = try m.exportArchive()
    #expect(file.filename == "owner.test-analytics-2026-11-14.json")
    #expect(file.type == "application/json")
    let doc = try JSONValue.parse(file.text)
    #expect(doc["counts"]?["posts"] == .number(2))
    #expect(doc["did"] == .string(me))
    let csv = m.exportPosts()
    #expect(csv.filename == "owner.test-posts-2026-11-14.csv")
    #expect(csv.text.hasPrefix("\u{FEFF}created_at,kind,text"))
    let rows = m.exportRows("followers", [["did"], [.string("did:plc:ana")]])
    #expect(rows.text == "\u{FEFF}did\r\ndid:plc:ana\r\n")
  }

  @Test func deletingTheArchiveLetsTheNextMountStartAfresh() async {
    let transport = MockTransport()
    smallWorld(transport)
    let m = model(transport)
    await m.start()
    await m.runSync()
    await m.deleteArchive()
    #expect(m.isBuilt == false)
    #expect(m.data.loaded)
    #expect(m.syncError == nil)
    #expect(m.data.posts.isEmpty && m.data.followers.isEmpty && m.data.meta.posts == nil)
  }

  @Test func theResetForTheSessionIsAPlainFunction() {
    // What the session's environment takes (`@MainActor () -> Void`).
    let reset: @MainActor () -> Void = { AnalyticsStore.resetAnalyticsStore() }
    reset()
    #expect(ArchiveContext.isBuilt(ArchiveData.empty) == false)
  }
}
