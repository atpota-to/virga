// Parity with harness/repo.js, against
// ios/parity/fixtures/demo-world.repo.json: AT-URIs, the XRPC error, and
// scenarios of reads, writes, deletes and blobs on fresh worlds, step by
// step, with the world's state after each.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct RepoParity {
  static let fixture = "demo-world.repo"

  static func thrown(_ error: Error) -> JSONValue {
    switch error {
    case let e as HarnessRepo.XrpcError:
      return [
        "$throws": .string(e.message), "name": .string(e.name), "status": .number(Double(e.status)),
        "error": .string(e.error),
      ]
    case let e as HarnessJSError:
      return ["$throws": .string(e.message), "name": .string(e.name)]
    default:
      return ["$throws": .string(error.localizedDescription)]
    }
  }

  static func brief(_ list: JSONValue) -> JSONValue {
    ["count": list["count"] ?? .null, "sha256": list["sha256"] ?? .null]
  }

  /// One step of a scenario (demo-world.repo.js's `run`).
  static func run(_ world: inout AccountWorld, _ step: JSONValue) -> JSONValue {
    do {
      switch step["op"]?.stringValue ?? "" {
      case "list":
        return try CanonicalJSON.part(
          encoding: try HarnessRepo.listCollection(world, step["collection"]?.stringValue ?? ""))
      case "read":
        let row = try HarnessRepo.readRecord(
          world, step["collection"]?.stringValue ?? "", step["rkey"]?.stringValue ?? "")
        return try row.map(DemoFixtures.json) ?? .null
      case "write":
        return try DemoFixtures.json(
          try HarnessRepo.writeRecord(
            &world,
            collection: step["collection"]?.stringValue,
            rkey: step["rkey"]?.stringValue,
            record: step["record"],
            createOnly: step["createOnly"]?.boolValue ?? false,
            now: step["now"]?.doubleValue ?? .nan
          ))
      case "remove":
        return .bool(
          try HarnessRepo.removeRecord(&world, step["collection"]?.stringValue ?? "", step["rkey"]?.stringValue ?? ""))
      case "storeBlob":
        let bytes = (step["bytes"]?.arrayValue ?? []).map { UInt8($0.intValue ?? 0) }
        return HarnessRepo.storeBlob(&world, bytes, mimeType: step["mimeType"]?.stringValue)
      case "readBlob":
        return try HarnessRepo.readBlob(world, step["cid"]?.stringValue ?? "").map(DemoFixtures.json) ?? .null
      default:
        return ["$throws": .string("no op \(step["op"] ?? .null)")]
      }
    } catch {
      return thrown(error)
    }
  }

  /// The state after a step. A part that hasn't changed since the last
  /// step keeps its digest (an unchanged array compares equal at once), so
  /// a scenario over Mira's 5,200 likes doesn't hash them at every step.
  final class StateDigests {
    private var last: [String: (value: AnyHashable, digest: JSONValue)] = [:]

    func brief<T: Hashable>(_ name: String, _ value: T, _ make: () throws -> JSONValue) rethrows -> JSONValue {
      if let hit = last[name], hit.value == AnyHashable(value) { return hit.digest }
      let digest = RepoParity.brief(try make())
      last[name] = (AnyHashable(value), digest)
      return digest
    }

    func state(_ world: AccountWorld) throws -> JSONValue {
      [
        "revision": .number(Double(world.revision)),
        "postsCount": .number(Double(world.profile.postsCount)),
        "posts": try brief("posts", world.posts) { try CanonicalJSON.part(encoding: world.posts) },
        "follows": try brief("follows", world.follows) { try CanonicalJSON.part(encoding: world.follows) },
        "likes": try brief("likes", world.likes) { try CanonicalJSON.part(encoding: world.likes) },
        "written": try brief("written", world.written) {
          CanonicalJSON.part(try world.written.entries.map { [.string($0.key), try DemoFixtures.json($0.value)] })
        },
        "removed": .array(world.removed.elements.map(JSONValue.string)),
        "blobs": try brief("blobs", world.blobs) {
          CanonicalJSON.part(try world.blobs.entries.map { [.string($0.key), try DemoFixtures.json($0.value)] })
        },
      ]
    }
  }

  @Test(arguments: ["lab", "mira"])
  func scenario(_ id: String) throws {
    let c = try #require(try Parity.cases(Self.fixture, fn: "scenario").first { $0.id == id })
    var world = World.buildWorld(
      now: DemoFixtures.now, account: c["account"].stringValue == "lab" ? World.lab : World.me)
    let steps = c["steps"].arrayValue ?? []
    let expected = c.output.arrayValue ?? []
    #expect(steps.count == expected.count)
    let digests = StateDigests()
    for (i, (step, want)) in zip(steps, expected).enumerated() {
      let result = Self.run(&world, step)
      let actual: JSONValue = ["result": result, "state": try digests.state(world)]
      let d = Exact.diff(actual, want)
      #expect(d == nil, "\(id) step \(i) \(step): \(d ?? "")")
      if d != nil { break }  // later steps follow from this one
    }
  }

  @Test func keyOf() throws {
    for c in try Parity.cases(Self.fixture, fn: "keyOf") {
      let actual = HarnessRepo.keyOf(c["collection"].stringValue ?? "", c["rkey"].stringValue ?? "")
      #expect(Exact.diff(.string(actual), c.output) == nil, "\(c)")
    }
  }

  @Test func parseAtUri() throws {
    for c in try Parity.cases(Self.fixture, fn: "parseAtUri") {
      let actual = try HarnessRepo.parseAtUri(c["uri"].stringValue).map(DemoFixtures.json) ?? .null
      #expect(Exact.diff(actual, c.output) == nil, "\(c) \(c["uri"]): \(actual)")
    }
  }

  @Test func xrpcError() throws {
    for c in try Parity.cases(Self.fixture, fn: "XrpcError") {
      let e = HarnessRepo.XrpcError(c["status"].intValue ?? 0, c["error"].stringValue ?? "", c["message"].stringValue)
      let actual: JSONValue = [
        "name": .string(e.name), "status": .number(Double(e.status)), "error": .string(e.error),
        "message": .string(e.message),
      ]
      #expect(Exact.diff(actual, c.output) == nil, "\(c)")
      #expect(e.errorDescription == e.message)
    }
  }

  @Test func blobDataUrl() throws {
    let c = try Parity.cases(Self.fixture, fn: "blobDataUrl")[0]
    var world = World.buildWorld(now: DemoFixtures.now, account: World.lab)
    let a = HarnessRepo.storeBlob(&world, [137, 80, 78, 71], mimeType: "image/png")
    let b = HarnessRepo.storeBlob(&world, [1, 2, 3, 4, 5], mimeType: nil)
    let aCid = a["ref"]?["$link"]?.stringValue ?? ""
    let bCid = b["ref"]?["$link"]?.stringValue ?? ""
    func url(_ s: String?) -> JSONValue { s.map(JSONValue.string) ?? .null }
    let actual: JSONValue = [
      "a": a, "b": b,
      "aUrl": url(HarnessRepo.blobDataUrl(world, aCid)),
      "bUrl": url(HarnessRepo.blobDataUrl(world, bCid)),
      "tooBig": url(HarnessRepo.blobDataUrl(world, aCid, maxBytes: 3)),
      "justFits": url(HarnessRepo.blobDataUrl(world, aCid, maxBytes: 4)),
      "missing": url(HarnessRepo.blobDataUrl(world, "bafkreinothere")),
      "read": try HarnessRepo.readBlob(world, aCid).map(DemoFixtures.json) ?? .null,
    ]
    let d = Exact.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }
}
