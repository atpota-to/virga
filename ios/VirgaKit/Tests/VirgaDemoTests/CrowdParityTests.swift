// Parity with harness/crowd.js, against
// ios/parity/fixtures/demo-world.crowd.json: the strangers, who in the cast
// follows whom, profiles, relationships, vouches and every post's crowd.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct CrowdParity {
  static let fixture = "demo-world.crowd"

  /// Mira and Field Lab at the fixtures' `now`, built once for the suite.
  static let worlds: [AccountWorld] = [
    World.buildWorld(now: DemoFixtures.now),
    World.buildWorld(now: DemoFixtures.now, account: World.lab),
  ]

  static func viewer(_ c: ParityCase) -> AccountWorld {
    c["viewer"].stringValue == "lab" ? worlds[1] : worlds[0]
  }

  static func check(_ actual: JSONValue, _ c: ParityCase) {
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(c) \(c.input): \(d ?? "")")
  }

  @Test func castFollows() throws {
    for c in try Parity.cases(Self.fixture, fn: "castFollows") {
      Self.check(.bool(Crowd.castFollows(c["from"].stringValue ?? "", c["to"].stringValue ?? "")), c)
    }
  }

  @Test func strangers() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    Self.check(try CanonicalJSON.part(encoding: crowd.strangers), try Parity.cases(Self.fixture, fn: "strangers")[0])
    for c in try Parity.cases(Self.fixture, fn: "stranger") {
      let did = "did:plc:virgaharnesscrowd\(String.zeroPadded(c["i"].intValue ?? 0, 5))"
      Self.check(try DemoFixtures.json(crowd.stranger(did)), c)
    }
  }

  @Test func profile() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    for c in try Parity.cases(Self.fixture, fn: "profile") {
      Self.check(crowd.profile(c["did"].stringValue ?? "") ?? .null, c)
    }
  }

  @Test func profileAs() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    for c in try Parity.cases(Self.fixture, fn: "profileAs") {
      let actual = crowd.profileAs(Self.viewer(c), c["did"].stringValue ?? "", card: c.input["card"])
      Self.check(actual ?? .null, c)
    }
  }

  @Test func relationship() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    for c in try Parity.cases(Self.fixture, fn: "relationship") {
      Self.check(crowd.relationship(Self.viewer(c), c["did"].stringValue ?? ""), c)
    }
  }

  @Test func knownCount() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    for c in try Parity.cases(Self.fixture, fn: "knownCount") {
      let counts = (c["dids"].arrayValue ?? []).map { did in
        JSONValue.number(Double(crowd.knownCount(Self.viewer(c), did.stringValue ?? "")))
      }
      Self.check(.array(counts), c)
    }
  }

  static func engagers(_ e: CrowdEngagers) -> [String: [JSONValue]] {
    [
      "like": e.like.map(JSONValue.string), "repost": e.repost.map(JSONValue.string),
      "reply": e.reply.map(JSONValue.string), "threadReply": e.threadReply.map(JSONValue.string),
      "quote": e.quote.map(JSONValue.string),
    ]
  }

  @Test func engagersOfEveryPost() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    let uris = Self.worlds.flatMap { w in w.posts.map { "at://\(w.me.did)/app.bsky.feed.post/\($0.rkey)" } }
    let rows: [JSONValue] = try uris.map { uri in [.string(uri), try DemoFixtures.json(crowd.engagersOf(uri))] }
    Self.check(CanonicalJSON.part(rows), try Parity.cases(Self.fixture, fn: "engagersOf-every-post")[0])
  }

  @Test func engagersOf() throws {
    let crowd = Crowd.createCrowd(Self.worlds)
    for c in try Parity.cases(Self.fixture, fn: "engagersOf") {
      let parts = Self.engagers(crowd.engagersOf(c["uri"].stringValue ?? "")).mapValues(CanonicalJSON.part)
      Self.check(.object(parts), c)
    }
  }

  @Test func theSamePostMeetsTheSameCrowd() {
    let a = Crowd.createCrowd(Self.worlds)
    let b = Crowd.createCrowd(Self.worlds)
    let uri = "at://\(World.me.did)/app.bsky.feed.post/\(Self.worlds[0].posts[5].rkey)"
    #expect(a.engagersOf(uri) == b.engagersOf(uri))
    #expect(a.engagersOf(uri) == a.engagersOf(uri))
  }

  @Test func keepsTheCrowdItFirstWorkedOut() {
    // As on the web, a post's crowd is worked out once: deleting the post
    // afterwards doesn't empty it.
    let crowd = Crowd.createCrowd(Self.worlds)
    let post = Self.worlds[0].posts.first { $0.likes > 5 }!
    let uri = "at://\(World.me.did)/app.bsky.feed.post/\(post.rkey)"
    let before = crowd.engagersOf(uri)
    var changed = Self.worlds
    changed[0].posts.removeAll { $0.rkey == post.rkey }
    #expect(crowd.with(worlds: changed).engagersOf(uri) == before)
    #expect(Crowd.createCrowd(changed).engagersOf(uri) == CrowdEngagers())
  }
}
