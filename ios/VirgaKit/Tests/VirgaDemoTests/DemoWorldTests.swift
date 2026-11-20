// DemoWorld's behaviour: both accounts at one `now`, writes landing where
// every reader sees them, the repo CAR rebuilt only after a write, the
// views decoding into VirgaCore's lexicon models, and safety under
// concurrent use. (The worlds themselves are held to the web by the
// parity suites.)

import Foundation
import Testing
import VirgaCore
import VirgaRepo
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct DemoWorldTests {
  static let now = DemoFixtures.now

  @Test func buildsBothAccountsAtOneMoment() {
    let demo = DemoWorld(now: Self.now)
    #expect(demo.worlds.map(\.me.did) == [World.me.did, World.lab.did])
    #expect(demo.worlds.allSatisfy { $0.now == Self.now })
    #expect(demo.world(World.lab.did)?.posts.count == 9)
    #expect(demo.world("did:plc:nobody") == nil)
    let onlyMira = DemoWorld(now: Self.now, accounts: [World.me])
    #expect(onlyMira.worlds.count == 1)
  }

  @Test func theSameMomentGivesTheSameWorld() {
    let a = DemoWorld(now: Self.now)
    let b = DemoWorld(now: Date(timeIntervalSince1970: Self.now / 1000 + 0.0004))
    #expect(b.now == Self.now)
    #expect(a.worlds == b.worlds)
    #expect(DemoWorld(now: Self.now + 1).worlds != a.worlds)
  }

  @Test func previewsShareOneWorldAtTheREADMEsMoment() {
    #expect(DemoWorld.preview.now == 1_794_700_000_000)
    #expect(DemoWorld.preview.worlds.count == 2)
  }

  @Test func aWriteShowsUpEverywhere() throws {
    let demo = DemoWorld(now: Self.now)
    let rkey = "3zzzzzzzzzzz2"
    let uri = "at://\(World.me.did)/app.bsky.feed.post/\(rkey)"
    let before = demo.world(World.me.did)!.posts.count
    let result = try demo.writeRecord(
      did: World.me.did, collection: "app.bsky.feed.post", rkey: rkey,
      record: ["$type": "app.bsky.feed.post", "text": "Hello from iOS", "createdAt": "2026-11-15T10:00:00.000Z"],
      createOnly: true, now: Self.now)
    #expect(result.uri == uri)
    #expect(result.created)
    let mira = try #require(demo.world(World.me.did))
    #expect(mira.posts.count == before + 1)
    #expect(mira.posts.first?.rkey == rkey)
    #expect(mira.profile.postsCount == before + 1)
    #expect(mira.revision == 1)
    let view = try #require(try demo.views.postView(uri, now: Self.now))
    #expect(view["record"]?["text"] == "Hello from iOS")
    #expect(view["cid"] == .string(result.cid))
    let feed = try demo.views.authorFeed(mira, now: Self.now)
    #expect(feed.first?["post"]?["uri"] == .string(uri))
    #expect(try HarnessRepo.listCollection(mira, "app.bsky.feed.post").first?.uri == uri)
    #expect(try demo.views.searchPosts("hello from", now: Self.now).count == 1)

    // A create over it is refused as a PDS refuses it.
    #expect(throws: HarnessRepo.XrpcError(400, "InvalidRequest", "Record already exists at app.bsky.feed.post/\(rkey)")) {
      try demo.writeRecord(
        did: World.me.did, collection: "app.bsky.feed.post", rkey: rkey, record: ["text": "again"], createOnly: true,
        now: Self.now)
    }
    #expect(try demo.removeRecord(did: World.me.did, collection: "app.bsky.feed.post", rkey: rkey))
    #expect(try demo.views.postView(uri, now: Self.now) == nil)
  }

  @Test func anUploadedImageComesBackAsADataURL() throws {
    let demo = DemoWorld(now: Self.now)
    let ref = try demo.storeBlob(did: World.lab.did, bytes: PNG.cardImage(7, width: 4, height: 4), mimeType: "image/png")
    let cid = try #require(ref["ref"]?["$link"]?.stringValue)
    try demo.writeRecord(
      did: World.lab.did, collection: "app.bsky.feed.post", rkey: "3zzzzzzzzzzz2",
      record: [
        "$type": "app.bsky.feed.post", "text": "A picture", "createdAt": "2026-11-15T10:00:00.000Z",
        "embed": ["$type": "app.bsky.embed.images", "images": [["alt": "Sky", "image": ref]]],
      ], now: Self.now)
    let view = try #require(
      try demo.views.postView("at://\(World.lab.did)/app.bsky.feed.post/3zzzzzzzzzzz2", now: Self.now))
    let thumb = try #require(view["embed"]?["images"]?[0]?["thumb"]?.stringValue)
    #expect(thumb.hasPrefix("data:image/png;base64,"))
    #expect(HarnessRepo.readBlob(demo.world(World.lab.did)!, cid)?.mimeType == "image/png")
  }

  @Test func noSuchAccountIsTheHarnessError() {
    let demo = DemoWorld(now: Self.now)
    #expect(throws: DemoWorldError.noAccount("did:plc:nobody")) {
      try demo.removeRecord(did: "did:plc:nobody", collection: "a.b", rkey: "c")
    }
    #expect(DemoWorldError.noAccount("did:plc:x").errorDescription == "harness: no account did:plc:x")
  }

  @Test func theRepoCarIsRebuiltOnlyAfterAWrite() async throws {
    let demo = DemoWorld(now: Self.now, accounts: [World.lab])
    let first = try demo.repoCar(did: World.lab.did)
    #expect(try demo.repoCar(did: World.lab.did) == first)
    try demo.writeRecord(
      did: World.lab.did, collection: "app.bsky.feed.like", rkey: "3zzzzzzzzzzz2",
      record: ["subject": ["uri": "at://x/app.bsky.feed.post/y", "cid": "bafyx"]], now: Self.now)
    let second = try demo.repoCar(did: World.lab.did)
    #expect(second != first)
    let contents = try await CarRepo.readRepoCar(second)
    #expect(contents.entries.contains { $0.uri == "at://\(World.lab.did)/app.bsky.feed.like/3zzzzzzzzzzz2" })
    #expect(contents.entries.count == World.repoRecords(demo.world(World.lab.did)!).count)
  }

  @Test func viewsDecodeIntoTheLexiconModels() throws {
    let demo = DemoWorld(now: Self.now)
    let views = demo.views
    let mira = demo.world(World.me.did)!
    let profile = try #require(views.profileModel(World.me.did))
    #expect(profile.handle == "mira.example.com")
    #expect(profile.followersCount == 4810 + 263)
    #expect(views.profileModel("did:plc:virgaharnesscrowd00007")?.followersCount != nil)
    #expect(views.postModels(mira, now: Self.now).count == mira.posts.count)
    let lab = demo.world(World.lab.did)!
    #expect(views.postModels(lab, now: Self.now).count == lab.posts.count)
    let opener = try #require(mira.posts.first { p in mira.posts.contains { $0.thread?.root == p.rkey } })
    let thread = try #require(views.threadModel("at://\(World.me.did)/app.bsky.feed.post/\(opener.rkey)", now: Self.now))
    #expect(thread.post.uri.hasSuffix(opener.rkey))
    #expect(views.generatorModel(mira.feeds[0].uri)?.displayName == "Allotment people")
    #expect(views.listModel(mira.ownLists[0].uri, now: Self.now)?.name == "Neighbourhood")
    #expect(views.listModel(mira.lists[0].uri, now: Self.now)?.name == "Muted for now")
    #expect(mira.notificationModels.count == mira.notifications.count)
  }

  @Test func concurrentWritesAllLand() async throws {
    let demo = DemoWorld(now: Self.now, accounts: [World.lab])
    try await withThrowingTaskGroup(of: Void.self) { group in
      for i in 0..<40 {
        group.addTask {
          try demo.writeRecord(
            did: World.lab.did, collection: "app.bsky.feed.threadgate", rkey: "g\(i)", record: ["allow": []],
            now: Self.now)
        }
      }
      try await group.waitForAll()
    }
    let lab = try #require(demo.world(World.lab.did))
    #expect(lab.revision == 40)
    #expect(lab.written.count == 40)
    #expect(try HarnessRepo.listCollection(lab, "app.bsky.feed.threadgate").count == 40)
  }

  @Test func theCrowdIsTheViews() {
    let demo = DemoWorld(now: Self.now)
    let post = demo.world(World.me.did)!.posts.first { $0.likes > 3 }!
    let uri = "at://\(World.me.did)/app.bsky.feed.post/\(post.rkey)"
    #expect(demo.crowd.engagersOf(uri) == demo.views.crowd.engagersOf(uri))
    #expect(demo.crowd.engagersOf(uri).like.count == min(post.likes, 1800))
  }
}
