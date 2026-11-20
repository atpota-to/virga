// Parity with harness/views.js, against
// ios/parity/fixtures/demo-world.views.json: pages, TID times, live counts,
// people, every post as a view, embeds (the malformed ones too), author
// feeds, threads, feeds and lists, and search, over worlds that first take
// the same writes the generator made.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct ViewsParity {
  static let fixture = "demo-world.views"
  /// demo-world.views.js's VIEW_NOW.
  static let viewNow = DemoFixtures.now + 3 * 3_600_000

  /// Mira and Field Lab after the generator's writes (its `prepare`).
  static let worlds: [AccountWorld] = {
    var mira = World.buildWorld(now: DemoFixtures.now)
    var lab = World.buildWorld(now: DemoFixtures.now, account: World.lab)
    let done = (try? Parity.cases(fixture, fn: "writes"))?.first?.output ?? [:]
    for blob in done["blobs"]?.arrayValue ?? [] {
      let bytes = (blob["bytes"]?.arrayValue ?? []).map { UInt8($0.intValue ?? 0) }
      HarnessRepo.storeBlob(&mira, bytes, mimeType: blob["mimeType"]?.stringValue)
    }
    func apply(_ world: inout AccountWorld, _ writes: [JSONValue]) {
      for w in writes {
        _ = try? HarnessRepo.writeRecord(
          &world, collection: w["collection"]?.stringValue, rkey: w["rkey"]?.stringValue, record: w["record"],
          now: w["now"]?.doubleValue ?? .nan)
      }
    }
    apply(&mira, done["mira"]?.arrayValue ?? [])
    apply(&lab, done["lab"]?.arrayValue ?? [])
    return [mira, lab]
  }()

  static let views = Views.createViews(worlds)

  static func check(_ actual: JSONValue, _ c: ParityCase) {
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(c) \(c.input.jsonString().prefix(200)): \(d ?? "")")
  }

  static func outcome(_ body: () throws -> JSONValue?) -> JSONValue {
    do {
      return try body() ?? ["$undefined": true]
    } catch let e as HarnessJSError {
      return ["$throws": .string(e.message), "name": .string(e.name)]
    } catch {
      return ["$throws": .string("\(error)")]
    }
  }

  @Test func theWritesWereReplayed() throws {
    let mira = Self.worlds[0]
    #expect(mira.blobs.count == 2)
    #expect(mira.posts.contains { $0.rkey == "3zzzzzzzzzzl2" && $0.writtenAt != nil })
    #expect(mira.written.has("app.bsky.feed.threadgate/3zzzzzzzzzzl2"))
    #expect(Self.worlds[1].posts.first?.rkey == "3zzzzzzzzzzz2")
  }

  @Test func pageOf() throws {
    for c in try Parity.cases(Self.fixture, fn: "pageOf") {
      let page = Views.pageOf(Array(0..<(c["length"].intValue ?? 0)), limit: c.input["limit"], cursor: c.input["cursor"])
      var actual: [String: JSONValue] = ["rows": .array(page.rows.map { .number(Double($0)) })]
      if let cursor = page.cursor { actual["cursor"] = .string(cursor) }
      Self.check(.object(actual), c)
    }
  }

  @Test func tidTime() throws {
    for c in try Parity.cases(Self.fixture, fn: "tidTime") {
      Self.check(Views.tidTime(c["rkey"].stringValue).map(JSONValue.number) ?? .null, c)
    }
  }

  @Test func liveCounts() throws {
    for c in try Parity.cases(Self.fixture, fn: "liveCounts") {
      let post = try c["post"].decode(WorldPost.self)
      let counts = Views.liveCounts(post, now: c["now"].doubleValue ?? .nan)
      Self.check(try DemoFixtures.json(counts), c)
    }
  }

  @Test func people() throws {
    for c in try Parity.cases(Self.fixture, fn: "card") {
      Self.check(Self.views.card(c["did"].stringValue ?? ""), c)
    }
    for c in try Parity.cases(Self.fixture, fn: "person") {
      Self.check(Self.views.person(c.input["actor"]?.stringValue) ?? .null, c)
    }
    for c in try Parity.cases(Self.fixture, fn: "resolveHandle") {
      Self.check(Self.views.resolveHandle(c.input["handle"]?.stringValue).map(JSONValue.string) ?? .null, c)
    }
  }

  @Test func postViewOfEveryPost() throws {
    let c = try Parity.cases(Self.fixture, fn: "postView-every-post")[0]
    let all = try Self.worlds.flatMap { w in
      try w.posts.map { p in
        try Self.views.postView("at://\(w.me.did)/app.bsky.feed.post/\(p.rkey)", now: Self.viewNow) ?? .null
      }
    }
    Self.check(CanonicalJSON.part(all), c)
  }

  @Test func postView() throws {
    for c in try Parity.cases(Self.fixture, fn: "postView") {
      Self.check(try Self.views.postView(c.input["uri"]?.stringValue, now: Self.viewNow) ?? .null, c)
    }
  }

  @Test func embedView() throws {
    for c in try Parity.cases(Self.fixture, fn: "embedView") {
      let actual = Self.outcome {
        try Self.views.embedView(
          c.input["embed"], did: c["did"].stringValue ?? "", depth: c["depth"].intValue ?? 1, now: Self.viewNow)
      }
      Self.check(actual, c)
    }
  }

  @Test func authorFeed() throws {
    for c in try Parity.cases(Self.fixture, fn: "authorFeed") {
      let world = c["world"].stringValue == "lab" ? Self.worlds[1] : Self.worlds[0]
      Self.check(CanonicalJSON.part(try Self.views.authorFeed(world, now: Self.viewNow)), c)
    }
  }

  @Test func threadView() throws {
    for c in try Parity.cases(Self.fixture, fn: "threadView") {
      let actual = try Self.views.threadView(
        c["uri"].stringValue ?? "", depth: c["depth"].intValue ?? 6, parentHeight: c["parentHeight"].intValue ?? 80,
        now: Self.viewNow)
      Self.check(actual ?? .null, c)
    }
  }

  @Test func threadViewOfALongChain() throws {
    for c in try Parity.cases(Self.fixture, fn: "threadView-long-chain") {
      var lab = World.buildWorld(now: DemoFixtures.now, account: World.lab)
      let letters = Array("abcdefghij")
      func key(_ i: Int) -> String {
        "3zzzzzzzzz" + String(String.zeroPadded(i, 3).map { letters[Int(String($0))!] })
      }
      let posts = c["posts"].intValue ?? 0
      let cycle = c["cycle"].boolValue ?? false
      for i in 0..<posts {
        var record: JSONValue = [
          "$type": "app.bsky.feed.post", "text": .string("Part \(i)"),
          "createdAt": .string(World.iso(DemoFixtures.now + Double(i))),
        ]
        if i > 0 || cycle {
          record["reply"] = ["parent": ["uri": .string("at://\(World.lab.did)/app.bsky.feed.post/\(key(cycle ? i : i - 1))")]]
        }
        try HarnessRepo.writeRecord(
          &lab, collection: "app.bsky.feed.post", rkey: key(i), record: record, now: DemoFixtures.now)
      }
      let views = Views.createViews([lab])
      let thread = try #require(
        try views.threadView(
          "at://\(World.lab.did)/app.bsky.feed.post/\(key(posts - 1))", parentHeight: c["parentHeight"].intValue ?? 80,
          now: Self.viewNow))
      var levels = 0
      var node = thread
      while let parent = node["parent"] {
        levels += 1
        node = parent
      }
      Self.check(["levels": .number(Double(levels)), "sha256": .string(CanonicalJSON.sha256(thread))], c)
    }
  }

  @Test func feedsAndLists() throws {
    for c in try Parity.cases(Self.fixture, fn: "generatorView") {
      Self.check(Self.views.generatorView(c.input["uri"]?.stringValue) ?? .null, c)
    }
    for c in try Parity.cases(Self.fixture, fn: "listView") {
      Self.check(Self.views.listView(c.input["uri"]?.stringValue, now: Self.viewNow) ?? .null, c)
    }
    for c in try Parity.cases(Self.fixture, fn: "listMembers") {
      Self.check(.array(Self.views.listMembers(c["uri"].stringValue ?? "")), c)
    }
  }

  @Test func searchPosts() throws {
    for c in try Parity.cases(Self.fixture, fn: "searchPosts") {
      Self.check(CanonicalJSON.part(try Self.views.searchPosts(c.input["q"]?.stringValue, now: Self.viewNow)), c)
    }
  }

  @Test func searchActors() throws {
    for c in try Parity.cases(Self.fixture, fn: "searchActors") {
      Self.check(.array(Self.views.searchActors(c.input["q"]?.stringValue, limit: c.input["limit"])), c)
    }
  }

  @Test func viewsFollowTheWorldsAsTheyChange() throws {
    // A write after the views are made shows up once the views are given
    // the changed worlds, as the web's views read their live worlds.
    var worlds = Self.worlds
    let uri = "at://\(World.lab.did)/app.bsky.feed.post/3zzzzzzzzzzy2"
    #expect(try Self.views.postView(uri, now: Self.viewNow) == nil)
    try HarnessRepo.writeRecord(
      &worlds[1], collection: "app.bsky.feed.post", rkey: "3zzzzzzzzzzy2",
      record: ["$type": "app.bsky.feed.post", "text": "Later", "createdAt": "2026-11-20T10:00:00.000Z"],
      now: Self.viewNow)
    let later = Self.views.with(worlds: worlds)
    let view = try #require(try later.postView(uri, now: Self.viewNow))
    #expect(view["record"]?["text"] == "Later")
    #expect(view["likeCount"] == .number(0))
  }
}
