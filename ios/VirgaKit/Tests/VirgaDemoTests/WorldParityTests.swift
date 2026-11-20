// Parity with harness/world.js: the generator, TIDs, the cast, hashes,
// activity, post records, repo records and whole worlds, against
// ios/parity/fixtures/demo-world.world.json.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct WorldParity {
  static let fixture = "demo-world.world"

  @Test func constants() throws {
    let c = try Parity.cases(Self.fixture, fn: "constants")[0]
    let actual: JSONValue = [
      "ME": try DemoFixtures.json(World.me),
      "LAB": try DemoFixtures.json(World.lab),
      "PDS": .string(World.pds),
    ]
    #expect(Exact.diff(actual, c.output) == nil, "\(Exact.diff(actual, c.output) ?? "")")
  }

  @Test func mulberry() throws {
    for c in try Parity.cases(Self.fixture, fn: "mulberry") {
      var rand = World.mulberry(c.number("seed"))
      let actual = JSONValue.array((0..<24).map { _ in .number(rand()) })
      let d = Exact.diff(actual, c.output)
      #expect(d == nil, "\(c) seed \(c["seed"]): \(d ?? "")")
    }
  }

  @Test func tidAt() throws {
    for c in try Parity.cases(Self.fixture, fn: "tidAt") + Parity.cases(Self.fixture, fn: "tidAt-default-clock") {
      let actual: JSONValue
      do {
        let clock = c["clock"].stringValue.map { JSNumber.toNumber($0) } ?? 0
        actual = .string(try World.tidAt(c.number("ms"), clock))
      } catch let error as HarnessJSError {
        actual = ["$throws": .string(error.message)]
      }
      let d = Exact.diff(actual, c.output)
      #expect(d == nil, "\(c) ms \(c["ms"]) clock \(c["clock"]): \(d ?? "")")
    }
  }

  @Test func buildCast() throws {
    let c = try Parity.cases(Self.fixture, fn: "buildCast")[0]
    let d = Exact.diff(try DemoFixtures.json(World.buildCast()), c.output)
    #expect(d == nil, "\(d ?? "")")
  }

  @Test func hashOf() throws {
    for c in try Parity.cases(Self.fixture, fn: "hashOf") {
      let actual = JSONValue.number(Double(World.hashOf(c["text"].stringValue ?? "")))
      #expect(Exact.diff(actual, c.output) == nil, "\(c)")
    }
  }

  @Test func activityOf() throws {
    for c in try Parity.cases(Self.fixture, fn: "activityOf") {
      let actual = try DemoFixtures.json(World.activityOf(c["did"].stringValue ?? ""))
      #expect(Exact.diff(actual, c.output) == nil, "\(c): \(actual) vs \(c.output)")
    }
  }

  @Test func postRecord() throws {
    for c in try Parity.cases(Self.fixture, fn: "postRecord") {
      let post = try c["post"].decode(WorldPost.self)
      let d = Exact.diff(World.postRecord(post), c.output)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func postsDecodeAndEncodeAsTheyCame() throws {
    // A post read from the web's JSON writes the same keys back: nulls where
    // the fixture has them, nothing where it has nothing.
    for c in try Parity.cases(Self.fixture, fn: "postRecord") where c.id != "record-empty-string" {
      let post = try c["post"].decode(WorldPost.self)
      let d = Exact.diff(try DemoFixtures.json(post), c["post"])
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func repoRecords() throws {
    let c = try Parity.cases(Self.fixture, fn: "repoRecords")[0]
    var world = World.buildWorld(now: DemoFixtures.now, account: World.lab)
    let edits = c["edits"]
    for pair in edits["written"]?.arrayValue ?? [] {
      world.written[pair[0]?.stringValue ?? ""] = WorldWritten(value: pair[1] ?? .null, cid: "bafyedit")
    }
    world.others += try (edits["others"] ?? []).decode([WorldOtherRecord].self)
    for key in edits["removed"]?.arrayValue ?? [] { world.removed.add(key.stringValue ?? "") }
    world.written["app.bsky.feed.post/\(world.posts[3].rkey)"] = WorldWritten(
      value: ["$type": "app.bsky.feed.post", "text": "over a fixture"], cid: "bafyedit")
    let actual = JSONValue.array(World.repoRecords(world).map { [.string($0.key), $0.value] })
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }

  static let worldCases = [
    "mira", "mira-fractional-now-seed-7", "mira-before-1970", "mira-wrapping-seed", "lab", "lab-seed-99",
    "someone-else",
  ]

  @Test func everyWorldCaseIsRun() throws {
    let ids = try Parity.cases(Self.fixture, fn: "buildWorld").map(\.id)
    #expect(ids == Self.worldCases)
  }

  @Test(arguments: worldCases)
  func buildWorld(_ id: String) throws {
    let c = try #require(try Parity.cases(Self.fixture, fn: "buildWorld").first { $0.id == id })
    let world = DemoFixtures.world(c)
    let d = Exact.diff(try DemoFixtures.digest(world), c.output)
    #expect(d == nil, "\(c): \(d ?? "")")
  }
}
