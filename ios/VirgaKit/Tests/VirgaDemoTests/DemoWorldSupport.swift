// What the demo-world parity tests share: the worlds the generators build
// (ios/parity/cases/_demoWorld.js), a world as a fixture holds it, and an
// exact comparison of JSON (Parity.diff lets numbers differ in the ninth
// place; the worlds must match to the bit).

import Foundation
import VirgaCore
import VirgaTestSupport
@testable import VirgaDemo

enum DemoFixtures {
  /// The README's example `now` (_demoWorld.js's NOW).
  static let now: Double = 1_794_700_000_000

  /// _demoWorld.js's SOMEONE: neither account, so a quiet world.
  static let someone = WorldAccount(
    did: "did:plc:someoneelseentirely", handle: "someone.example.net", displayName: "Someone Else")

  static func account(_ name: String) -> WorldAccount {
    switch name {
    case "me": return World.me
    case "lab": return World.lab
    default: return someone
    }
  }

  /// `worldFor({ now, seed, account })`.
  static func world(_ c: ParityCase) -> AccountWorld {
    World.buildWorld(
      now: c["now"].doubleValue ?? now,
      seed: c["seed"].doubleValue,
      account: account(c["account"].stringValue ?? "me")
    )
  }

  static func json<T: Encodable>(_ value: T) throws -> JSONValue {
    try JSONValue(encoding: value)
  }

  /// `worldDigest(world)`.
  static func digest(_ world: AccountWorld) throws -> JSONValue {
    var parts: [String: JSONValue] = [
      "cast": try CanonicalJSON.part(encoding: world.cast),
      "followedOnly": try CanonicalJSON.part(encoding: world.followedOnly),
      "posts": try CanonicalJSON.part(encoding: world.posts),
      "followers": try CanonicalJSON.part(encoding: world.followers),
      "follows": try CanonicalJSON.part(encoding: world.follows),
      "notifications": try CanonicalJSON.part(encoding: world.notifications),
      "likes": try CanonicalJSON.part(encoding: world.likes),
      "reposts": try CanonicalJSON.part(encoding: world.reposts),
      "blockers": try CanonicalJSON.part(encoding: world.blockers),
      "lists": try CanonicalJSON.part(encoding: world.lists),
      "others": try CanonicalJSON.part(encoding: world.others),
      "feeds": try CanonicalJSON.part(encoding: world.feeds),
      "ownLists": try CanonicalJSON.part(encoding: world.ownLists),
      "preferences": CanonicalJSON.part(world.preferences),
      "drafts": try CanonicalJSON.part(encoding: world.drafts),
      "bookmarks": try CanonicalJSON.part(encoding: world.bookmarks),
    ]
    parts["written"] = CanonicalJSON.part(
      try world.written.entries.map { [.string($0.key), try json($0.value)] })
    parts["removed"] = CanonicalJSON.part(world.removed.elements.map(JSONValue.string))
    parts["blobs"] = CanonicalJSON.part(try world.blobs.entries.map { [.string($0.key), try json($0.value)] })
    return [
      "me": try json(world.me),
      "now": .number(world.now),
      "start": .number(world.start),
      "profile": try json(world.profile),
      "revision": .number(Double(world.revision)),
      "parts": .object(parts),
      "postRecords": CanonicalJSON.part(world.posts.map(World.postRecord)),
      "repoRecords": CanonicalJSON.part(World.repoRecords(world).map { [.string($0.key), $0.value] }),
    ]
  }
}

enum Exact {
  /// Where `actual` differs from `expected`, numbers compared exactly and
  /// strings by code unit; a member present on one side only is a
  /// difference (`strictNulls`) unless `strictNulls` is false. Iterative.
  static func diff(_ actual: JSONValue, _ expected: JSONValue, strictNulls: Bool = true) -> String? {
    var stack: [(String, JSONValue, JSONValue)] = [("$", actual, expected)]
    while let (path, a, b) = stack.popLast() {
      switch (a, b) {
      case (.number(let x), .number(let y)):
        if x.bitPattern != y.bitPattern && !(x == 0 && y == 0) && !(x.isNaN && y.isNaN) {
          return "\(path): \(x) ≠ expected \(y)"
        }
      case (.string(let x), .string(let y)):
        if !x.jsEquals(y) { return "\(path): \(short(a)) ≠ expected \(short(b))" }
      case (.array(let x), .array(let y)):
        if x.count != y.count { return "\(path): \(x.count) elements ≠ expected \(y.count)" }
        for i in x.indices.reversed() { stack.append(("\(path)[\(i)]", x[i], y[i])) }
      case (.object(let x), .object(let y)):
        let keys = Set(x.keys).union(y.keys).sorted().reversed()
        for key in keys {
          if strictNulls && (x[key] == nil) != (y[key] == nil) {
            return "\(path).\(key): present on one side only (\(x[key] == nil ? "missing" : "extra"))"
          }
          stack.append(("\(path).\(key)", x[key] ?? .null, y[key] ?? .null))
        }
      default:
        if a != b { return "\(path): \(short(a)) ≠ expected \(short(b))" }
      }
    }
    return nil
  }

  private static func short(_ value: JSONValue) -> String {
    let text = CanonicalJSON.text(value)
    return text.count > 300 ? String(text.prefix(300)) + "…" : text
  }
}

extension ParityCase {
  /// A number that travels as a string (NaN, ±Infinity, ones JSON would bend).
  func number(_ key: String) -> Double {
    JSNumber.toNumber(self[key].stringValue ?? "")
  }
}
