// harness/fakeXrpc.test.js, ported: the fake agent checked against the
// code that calls it, VirgaNetwork's XRPCAgent pointed at it, and what it
// writes coming back out of every reader, the public ones included.
//
// Not ported: "is never mistaken for a promise" (the web's Proxy-built
// namespaces; Swift's agent has no thenable to guard against). The tests
// that run the web's publish, drafts service, gates and library readers
// run the calls those make, since only the gates (VirgaPosting's Gates)
// are in this base.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaPosting
import VirgaRepo
import VirgaSession
import VirgaTestSupport
@testable import VirgaDemo

/// fakeXrpc.test.js's `setup({ scope })`.
struct AgentSetup {
  static let now: Double = JSDate.parse("2026-11-12T12:00:00.000Z", timeZone: .gmt)

  let world: DemoWorld
  let agent: FakeAgent
  let xrpc: XRPCAgent
  let transport: DemoTransport

  init(scope: String? = nil) {
    world = DemoWorld(now: Self.now)
    let clock = NetworkClock.instant(now: Self.now)
    var granted: (@Sendable () -> String?)?
    if let scope { granted = { scope } }
    agent = FakeAgent(
      world: world, did: World.me.did, scope: granted, sweepCounter: FakeXrpc.memoryCounter(), clock: clock)
    xrpc = agent.xrpcAgent()
    transport = DemoTransport(world: world, latency: 0, clock: clock)
  }

  var mira: AccountWorld { world.world(World.me.did)! }

  func get(_ url: String) async throws -> JSONValue {
    try await transport.send(HTTPRequest(url: url)).json()
  }

  func agentFor(_ did: String) -> XRPCAgent {
    FakeAgent(world: world, did: did, clock: .instant(now: Self.now)).xrpcAgent()
  }

  static func post(_ text: String) -> JSONValue {
    ["$type": "app.bsky.feed.post", "text": .string(text), "createdAt": .string(World.iso(now))]
  }
}

/// The gates' reads and writes, through an XRPCAgent.
struct XRPCGatesAgent: GatesAgent {
  var agent: XRPCAgent

  func getPreferences() async throws -> JSONValue { try await agent.query("app.bsky.actor.getPreferences").data }
  func getRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue {
    try await agent.query(
      "com.atproto.repo.getRecord", ["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]
    ).data
  }
  func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws {
    _ = try await agent.procedure(
      "com.atproto.repo.putRecord",
      input: .json(["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey), "record": record]))
  }
  func deleteRecord(repo: String, collection: String, rkey: String) async throws {
    _ = try await agent.procedure(
      "com.atproto.repo.deleteRecord", input: .json(["repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)]))
  }
}

func xrpcError(_ body: () async throws -> Void) async -> XRPCError? {
  do {
    try await body()
    return nil
  } catch {
    return error as? XRPCError
  }
}

@Suite struct TheFakeAgent {
  @Test func buildsTheCallFromTheNSIDAndAnswersWithItsData() async throws {
    let s = AgentSetup()
    #expect(s.agent.did == World.me.did)
    let res = try await s.xrpc.query("app.bsky.graph.getFollowers", ["actor": .string(World.me.did), "limit": 3])
    #expect(res.data["followers"]?.arrayValue?.count == 3)
    #expect(res.data["cursor"] == "3")
    let next = try await s.agent.handle("app.bsky.graph.getFollowers", ["limit": 3, "cursor": .string("3")])
    #expect(next.success)
    #expect(next.data["cursor"] == "6")
  }

  @Test func givesAnEquivalentAgentThroughWithProxyForTheSameAccount() async throws {
    let s = AgentSetup()
    let proxied = s.agent.withProxy("bsky_appview", "did:web:api.bsky.app")
    #expect(proxied.did == World.me.did)
    #expect(proxied.proxy == "did:web:api.bsky.app#bsky_appview")
    let res = try await s.xrpc.withBlueskyAppView().query("app.bsky.draft.getDrafts")
    #expect((res.data["drafts"]?.arrayValue?.count ?? 0) > 0)
  }

  @Test func refusesAMethodItHasNoAnswerForAsAnUnimplementedXRPCMethod() async throws {
    let s = AgentSetup()
    let error = await xrpcError { _ = try await s.xrpc.query("app.bsky.unspecced.getSomething") }
    #expect(error?.status == 501)
    #expect(error?.error == "MethodNotImplemented")
  }

  @Test func keepsDraftsAndBookmarksOnBlueskysAppViewOnly() async throws {
    let s = AgentSetup()
    let error = await xrpcError { _ = try await s.xrpc.query("app.bsky.draft.getDrafts") }
    #expect(error?.error == "MethodNotImplemented")
    let bookmarks = await xrpcError { _ = try await s.xrpc.query("app.bsky.bookmark.getBookmarks") }
    #expect(bookmarks?.error == "MethodNotImplemented")
  }

  @Test func changesTheFollowersBetweenSweepsFromTheSecondOn() async throws {
    let s = AgentSetup()
    let first = try await s.xrpc.query("app.bsky.graph.getFollowers", ["limit": 100])
    let second = try await s.xrpc.query("app.bsky.graph.getFollowers", ["limit": 100])
    #expect(first.data["followers"]?[0]?["handle"] != "tove.example.org")
    #expect(second.data["followers"]?[0]?["handle"] == "tove.example.org")
  }

  @Test func countsTheSweepsWhereTheWebDoesInLocalStorage() async throws {
    let store = InMemoryKeyValueStore()
    let world = DemoWorld(now: AgentSetup.now)
    let agent = FakeAgent(
      world: world, did: World.me.did, sweepCounter: FakeXrpc.localStorageCounter(store), clock: .instant(now: AgentSetup.now))
    _ = try await agent.handle("app.bsky.graph.getFollowers", ["limit": 1])
    #expect(store.getItem(FakeXrpc.sweepCountKey) == "1")
    // The count outlives the agent, as it outlives the page.
    let again = FakeAgent(
      world: world, did: World.me.did, sweepCounter: FakeXrpc.localStorageCounter(store), clock: .instant(now: AgentSetup.now))
    let res = try await again.handle("app.bsky.graph.getFollowers", ["limit": 1])
    #expect(store.getItem(FakeXrpc.sweepCountKey) == "2")
    #expect(res.data["followers"]?[0]?["handle"] == "tove.example.org")
  }
}

@Suite struct WritingToTheRepo {
  @Test func storesARecordWithTheCIDAPDSWouldGiveItAndListsItFirst() async throws {
    let s = AgentSetup()
    let record = AgentSetup.post("Hello from the harness")
    let res = try await s.xrpc.procedure(
      "com.atproto.repo.createRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "record": record]))
    #expect(res.data["cid"]?.stringValue == (try RecordCid.computeRecordCid(record)))
    let listed = try await s.xrpc.query(
      "com.atproto.repo.listRecords", ["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "limit": 1])
    #expect(listed.data["records"]?[0]?["uri"] == res.data["uri"])
    #expect(listed.data["records"]?[0]?["cid"] == res.data["cid"])
    #expect(s.mira.profile.postsCount == s.mira.posts.count)
  }

  @Test func refusesACreateOverARecordASwapThatDoesntMatchAndAnotherAccountsRepo() async throws {
    let s = AgentSetup()
    let record: JSONValue = [
      "$type": "net.anisota.feed.template", "name": "x", "text": "y", "createdAt": .string(World.iso(AgentSetup.now)),
    ]
    let create: JSONValue = [
      "repo": .string(World.me.did), "collection": "net.anisota.feed.template", "rkey": "abc", "record": record,
    ]
    _ = try await s.xrpc.procedure("com.atproto.repo.createRecord", input: .json(create))
    let again = await xrpcError { _ = try await s.xrpc.procedure("com.atproto.repo.createRecord", input: .json(create)) }
    #expect(again?.status == 400)
    var swap = create
    swap["swapRecord"] = "bafywrong"
    let swapped = await xrpcError { _ = try await s.xrpc.procedure("com.atproto.repo.putRecord", input: .json(swap)) }
    #expect(swapped?.error == "InvalidSwap")
    var other = create
    other["repo"] = .string(World.lab.did)
    other["rkey"] = nil
    let elsewhere = await xrpcError { _ = try await s.xrpc.procedure("com.atproto.repo.createRecord", input: .json(other)) }
    #expect(elsewhere?.status == 403)
  }

  @Test func answersGetRecordForWhatWasWrittenAndRecordNotFoundOnceDeleted() async throws {
    let s = AgentSetup()
    let res = try await s.xrpc.procedure(
      "com.atproto.repo.createRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "record": AgentSetup.post("Short-lived")]))
    let rkey = res.data["uri"]?.stringValue?.jsSplit("/").last ?? ""
    let params: XRPCParams = ["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "rkey": .string(rkey)]
    let read = try await s.xrpc.query("com.atproto.repo.getRecord", params)
    #expect(read.data["value"]?["text"] == "Short-lived")
    _ = try await s.xrpc.procedure(
      "com.atproto.repo.deleteRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "rkey": .string(rkey)]))
    let gone = await xrpcError { _ = try await s.xrpc.query("com.atproto.repo.getRecord", params) }
    #expect(gone?.error == "RecordNotFound")
  }

  @Test func takesAThreadWithItsGatesAndThePublicViewsShowIt() async throws {
    let s = AgentSetup()
    let did = World.me.did
    let root = "3n2ztestroot2"
    let reply = "3n2ztestrep22"
    let rootRecord = AgentSetup.post("First post of a thread")
    let rootUri = "at://\(did)/app.bsky.feed.post/\(root)"
    let rootCid = try RecordCid.computeRecordCid(rootRecord)
    var replyRecord = AgentSetup.post("And the second")
    replyRecord["reply"] = [
      "root": ["uri": .string(rootUri), "cid": .string(rootCid)], "parent": ["uri": .string(rootUri), "cid": .string(rootCid)],
    ]
    func create(_ collection: String, _ rkey: String, _ value: JSONValue) -> JSONValue {
      ["$type": "com.atproto.repo.applyWrites#create", "collection": .string(collection), "rkey": .string(rkey), "value": value]
    }
    let out = try await s.xrpc.procedure(
      "com.atproto.repo.applyWrites",
      input: .json([
        "repo": .string(did),
        "writes": [
          create("app.bsky.feed.post", root, rootRecord),
          create(
            "app.bsky.feed.threadgate", root,
            [
              "$type": "app.bsky.feed.threadgate", "post": .string(rootUri), "createdAt": .string(World.iso(AgentSetup.now)),
              "allow": [["$type": "app.bsky.feed.threadgate#followingRule"]],
            ]),
          create(
            "app.bsky.feed.postgate", root,
            [
              "$type": "app.bsky.feed.postgate", "post": .string(rootUri), "createdAt": .string(World.iso(AgentSetup.now)),
              "embeddingRules": [["$type": "app.bsky.feed.postgate#disableRule"]],
            ]),
          create("app.bsky.feed.post", reply, replyRecord),
        ],
      ]))
    #expect(out.data["results"]?.arrayValue?.count == 4)
    #expect(out.data["results"]?[0]?["cid"]?.stringValue == rootCid)
    let gates = try HarnessRepo.listCollection(s.mira, "app.bsky.feed.threadgate")
    let allow: JSONValue = [["$type": "app.bsky.feed.threadgate#followingRule"]]
    #expect(gates[0].value["allow"] == allow)

    let feed = try await s.get("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=\(did)&limit=3")
    let uris = feed["feed"]?.arrayValue?.compactMap { $0["post"]?["uri"]?.stringValue } ?? []
    #expect(uris.contains(rootUri))
    #expect(uris.contains("at://\(did)/app.bsky.feed.post/\(reply)"))
    let thread = try await s.get(
      "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=\(JSURI.encodeURIComponent(rootUri))")
    #expect(thread["thread"]?["replies"]?[0]?["post"]?["uri"]?.stringValue == "at://\(did)/app.bsky.feed.post/\(reply)")
    #expect(thread["thread"]?["post"]?["threadgate"]?["record"]?["allow"]?.arrayValue?.count == 1)
  }

  @Test func putsWhatWasWrittenInTheRepoDownload() async throws {
    let s = AgentSetup()
    let res = try await s.xrpc.procedure(
      "com.atproto.repo.createRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "record": AgentSetup.post("In the CAR")]))
    let rkey = res.data["uri"]?.stringValue?.jsSplit("/").last ?? ""
    let car = try await s.transport.send(
      HTTPRequest(url: "\(World.pds)/xrpc/com.atproto.sync.getRepo?did=\(World.me.did)"))
    #expect(car.headers.get("content-type") == "application/vnd.ipld.car")
    let contents = try await CarRepo.readRepoCar(car.body)
    let inCar = contents.entries.contains { $0.collection == "app.bsky.feed.post" && $0.rkey == rkey }
    #expect(inCar)
  }

  @Test func uploadsBlobsWithARealCIDAndRefusesOneWithoutAMediaType() async throws {
    let s = AgentSetup()
    let blob = try await Blobs.uploadBlob(agent: s.xrpc, data: Data([1, 2, 3, 4]), encoding: "image/png")
    #expect(blob.ref.link.hasPrefix("bafkrei"))
    #expect(s.mira.blobs[blob.ref.link]?.size == 4)
    do {
      _ = try await s.agent.handle("com.atproto.repo.uploadBlob", .bytes([1]), [:])
      Issue.record("an upload without a type went through")
    } catch let error as HarnessRepo.XrpcError {
      #expect(error.status == 400)
    }
  }
}

@Suite struct TheSignedInReadsPostingNeeds {
  @Test func keepsDraftsInMemoryPerAccount() async throws {
    let s = AgentSetup()
    let appview = s.xrpc.withBlueskyAppView()
    let before = try await appview.query("app.bsky.draft.getDrafts", ["limit": 100]).data["drafts"]?.arrayValue?.count ?? 0
    let made = try await appview.procedure(
      "app.bsky.draft.createDraft", input: .json(["draft": ["posts": [["text": "A draft"]]]]))
    let id = made.data["id"]?.stringValue ?? ""
    #expect(TID.isTid(id))
    var all = try await appview.query("app.bsky.draft.getDrafts", ["limit": 100]).data["drafts"]?.arrayValue ?? []
    #expect(all.count == before + 1)
    _ = try await appview.procedure(
      "app.bsky.draft.updateDraft", input: .json(["draft": ["id": .string(id), "draft": ["posts": [["text": "A draft, edited"]]]]]))
    all = try await appview.query("app.bsky.draft.getDrafts", ["limit": 100]).data["drafts"]?.arrayValue ?? []
    #expect(all.first { $0["id"]?.stringValue == id }?["draft"]?["posts"]?[0]?["text"] == "A draft, edited")
    _ = try await appview.procedure("app.bsky.draft.deleteDraft", input: .json(["id": .string(id)]))
    all = try await appview.query("app.bsky.draft.getDrafts", ["limit": 100]).data["drafts"]?.arrayValue ?? []
    #expect(all.count == before)
    let lab = try await s.agentFor(World.lab.did).withBlueskyAppView().query("app.bsky.draft.getDrafts")
    #expect(lab.data["drafts"]?.arrayValue?.count == 0)
  }

  @Test func answersTheAccountsDefaultReplyAndQuoteSettings() async throws {
    let s = AgentSetup()
    let mira = await Gates.readDefaultGates(XRPCGatesAgent(agent: s.xrpc))
    let miras: JSONValue = ["reply": [["type": "following"], ["type": "mention"]], "quotes": true]
    #expect(mira?.json == miras)
    let lab = await Gates.readDefaultGates(XRPCGatesAgent(agent: s.agentFor(World.lab.did)))
    let labs: JSONValue = ["reply": nil, "quotes": true]
    #expect(lab?.json == labs)
  }

  @Test func answersBookmarksAndPostSearchWithPostsThePublicViewsCanHydrate() async throws {
    let s = AgentSetup()
    let saved = try await s.xrpc.withBlueskyAppView().query("app.bsky.bookmark.getBookmarks")
    #expect((saved.data["bookmarks"]?.arrayValue?.count ?? 0) > 0)
    let found = try await s.xrpc.query("app.bsky.feed.searchPosts", ["q": "garden"])
    let uri = found.data["posts"]?[0]?["uri"]?.stringValue
    #expect(uri != nil)
    let posts = await PublicAppView.getPosts([uri], transport: s.transport)
    #expect(posts.views.count == 1)
  }

  @Test func mintsServiceAuthTokensTheVideoServiceCanReadAndNoLongerThanAnHour() async throws {
    let s = AgentSetup()
    let exp = (AgentSetup.now / 1000).rounded(.down) + 1800
    let res = try await s.xrpc.query(
      "com.atproto.server.getServiceAuth",
      ["aud": "did:web:video.bsky.app", "lxm": "app.bsky.video.getUploadLimits", "exp": .integer(Int(exp))])
    let claims = FakeXrpc.readServiceToken(res.data["token"]?.stringValue)
    #expect(claims?["iss"]?.stringValue == World.me.did)
    #expect(claims?["aud"] == "did:web:video.bsky.app")
    #expect(claims?["exp"] == .number(exp))
    let error = await xrpcError {
      _ = try await s.xrpc.query(
        "com.atproto.server.getServiceAuth",
        ["aud": "did:web:x", "lxm": "app.bsky.video.getJobStatus", "exp": .integer(Int(exp + 7200))])
    }
    #expect(error?.error == "BadExpiration")
    // And the video service reads it.
    let limits = try await s.transport.send(
      HTTPRequest(
        url: "https://video.bsky.app/xrpc/app.bsky.video.getUploadLimits",
        headers: ["Authorization": "Bearer \(res.data["token"]?.stringValue ?? "")"]))
    #expect(limits.status == 200)
    #expect(try limits.json()["canUpload"] == true)
  }

  @Test func refusesAWriteTheSessionWasntGrantedWithTheWordsTheAppLooksFor() async throws {
    let s = AgentSetup(scope: Harness.readOnlyScope)
    let error = await xrpcError {
      _ = try await s.xrpc.procedure(
        "com.atproto.repo.createRecord",
        input: .json(["repo": .string(World.me.did), "collection": "app.bsky.feed.post", "record": AgentSetup.post("nope")]))
    }
    #expect(error?.status == 403)
    #expect(Scopes.isMissingScopeError(error))
    let follow: JSONValue = [
      "$type": "app.bsky.graph.follow", "subject": .string(s.mira.cast[2].did), "createdAt": .string(World.iso(AgentSetup.now)),
    ]
    let res = try await s.xrpc.procedure(
      "com.atproto.repo.createRecord",
      input: .json(["repo": .string(World.me.did), "collection": "app.bsky.graph.follow", "record": follow]))
    #expect(res.data["uri"] != nil)
  }
}
