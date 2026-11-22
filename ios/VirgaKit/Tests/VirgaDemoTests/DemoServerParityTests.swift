// Parity with harness/fakeServer.js and harness/fakeDefense.js: the
// recorded scenarios of ios/parity/fixtures/demo-server.fakeServer.json
// replayed against DemoServer (every route, good and bad input, limits
// reached, the workers run between requests), and the server's tables, its
// log and what the workers wrote into each world compared at the end.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaTestSupport
@testable import VirgaDemo

@Suite struct DemoServerParity {
  /// The generator's `crypto.randomUUID`: a count.
  static func uuid(_ n: Int) -> String {
    let hex = String(n, radix: 16)
    return "00000000-0000-4000-8000-\(String(repeating: "0", count: max(0, 12 - hex.count)))\(hex)"
  }

  /// The generator's `Math.random`: a fixed sequence.
  static func random(_ k: Int) -> Double { Double((k * 37 + 11) % 64) / 64 }

  /// A scenario's server, as the generator's `run` makes it.
  static func server(_ c: ParityCase, world: DemoWorld, clock: Locked<Double>) -> DemoServer {
    let options = c["options"]
    let uuids = Locked(0)
    let randoms = Locked(0)
    return DemoServer(
      world: world, terms: options["terms"]?.stringValue ?? "agreed", limits: options["limits"] ?? [:],
      aiLimits: options["aiLimits"] ?? [:], seed: options["seed"]?.boolValue ?? true,
      aiDelayMs: options["aiDelayMs"]?.doubleValue ?? 0, ai: options["ai"]?.stringValue ?? "ok",
      defenseWrites: options["defenseWrites"]?.boolValue ?? true, moderator: options["moderator"]?.stringValue ?? "on",
      now: { clock.wrappedValue }, sleep: { _ in }, randomBytes: RepeatableBytes().generator,
      uuid: { uuid(uuids.withLock { $0 += 1; return $0 }) },
      random: { random(randoms.withLock { k in defer { k += 1 }; return k }) }, tidClockId: 0)
  }

  /// `worldState(w)`: what the workers wrote into a world.
  static func worldState(_ w: AccountWorld) throws -> JSONValue {
    let written = w.posts.filter { $0.record != nil }.map { p -> JSONValue in
      ["rkey": .string(p.rkey), "cid": p.cid.map(JSONValue.string) ?? .null, "record": p.record ?? .null]
    }
    let blobs = w.blobs.entries.map { entry -> JSONValue in
      var blob: [String: JSONValue] = ["size": .number(Double(entry.value.size))]
      if let type = entry.value.mimeType { blob["mimeType"] = .string(type) }
      return [.string(entry.key), .object(blob)]
    }
    return [
      "revision": .number(Double(w.revision)),
      "posts": .number(Double(w.posts.count)),
      "writtenPosts": DemoNetwork.shrink(.array(written)),
      "written": DemoNetwork.shrink(.array(try w.written.entries.map { [.string($0.key), try DemoFixtures.json($0.value)] })),
      "removed": .array(w.removed.elements.map(JSONValue.string)),
      "blobs": DemoNetwork.shrink(.array(blobs)),
      "listItems": .number(Double(try HarnessRepo.listCollection(w, "app.bsky.graph.listitem").count)),
    ]
  }

  /// The defense's tables as `inspect()` gives them.
  static func defenseJSON(_ t: DefenseTables) -> JSONValue {
    var links: [String: JSONValue] = [:]
    for (did, link) in t.links.entries { links[did] = link }
    return [
      "lists": .array(t.lists), "kept": .array(t.kept), "plans": .array(t.plans), "decisions": .array(t.decisions),
      "jobs": .array(t.jobs), "links": .object(links),
    ]
  }

  /// One scenario, replayed: each step's outcome, and the end.
  static func replay(_ c: ParityCase) async throws -> (steps: [JSONValue], end: JSONValue) {
    let flags = Harness.readFlags(c["search"].stringValue ?? "")
    let zone = TimeZone(identifier: c["zone"].stringValue ?? "UTC") ?? .gmt
    let world = DemoWorld(now: DemoNetwork.now, accounts: flags.accounts, scope: flags.scope, timeZone: zone)
    let clock = Locked(DemoNetwork.now)
    let server = server(c, world: world, clock: clock)
    var tokens: [String] = []
    var out: [JSONValue] = []
    for step in c["steps"].arrayValue ?? [] {
      if let did = step["mint"]?.stringValue {
        tokens.append(server.mintToken(did))
        out.append(["token": .string(tokens[tokens.count - 1])])
      } else if let ms = step["advance"]?.doubleValue {
        clock.withLock { $0 += ms }
        out.append(.null)
      } else if step["cron"] != nil || step["schedule"] != nil || step["timers"] != nil || step["defense"] != nil {
        func rows(_ list: [ScheduledRow]) -> JSONValue {
          .array(list.map { [.string($0.id), .string($0.status), $0.last_error_code] })
        }
        func timers(_ list: [TimerRow]) -> JSONValue {
          .array(list.map { [.string($0.id), .string($0.status), $0.resolution.map(JSONValue.string) ?? .null] })
        }
        var ran: [String: JSONValue] = [:]
        if step["cron"] != nil {
          let run = await server.runCron()
          ran = ["published": rows(run.published), "settled": timers(run.settled), "listed": .number(Double(run.listed))]
        } else if step["schedule"] != nil {
          ran = ["published": rows(server.runSchedule())]
        } else if step["timers"] != nil {
          ran = ["settled": timers(server.runTimers())]
        } else {
          ran = ["listed": .number(Double(await server.runDefense()))]
        }
        out.append(.object(ran))
      } else if let did = step["refuse"]?.stringValue {
        server.refuseGrant(did)
        out.append(.null)
      } else if let did = step["expire"]?.stringValue {
        server.expireAccount(did)
        out.append(.null)
      } else if let k = step["signOut"]?.intValue {
        let result = server.signOutToken(tokens[k])
        out.append(["found": .bool(result.found), "grantRevoked": .bool(result.grantRevoked)])
      } else if let write = step["write"] {
        let result = try world.writeRecord(
          did: write["did"]?.stringValue ?? "", collection: write["collection"]?.stringValue, rkey: write["rkey"]?.stringValue,
          record: write["record"], now: clock.wrappedValue)
        out.append(["uri": .string(result.uri), "cid": .string(result.cid), "created": .bool(result.created)])
      } else if let remove = step["remove"] {
        let found = try world.removeRecord(
          did: remove["did"]?.stringValue ?? "", collection: remove["collection"]?.stringValue ?? "",
          rkey: remove["rkey"]?.stringValue ?? "")
        out.append(.bool(found))
      } else if let set = step["setScope"] {
        try world.update(set["did"]?.stringValue ?? "") { $0.scope = set["scope"]?.stringValue }
        out.append(.null)
      } else if let change = step["timerStatus"] {
        server.withRows { _, timers in
          if let i = timers.firstIndex(where: { $0.id == change["id"]?.stringValue }) {
            timers[i].status = change["status"]?.stringValue ?? ""
          }
        }
        out.append(.null)
      } else if let cap = step["fillTimers"]?.intValue {
        let count = server.withRows { _, timers -> Int in
          let live = timers.first { $0.id == step["from"]?.stringValue }!
          let count = timers.filter { $0.user_did == World.me.did && ["armed", "checking"].contains($0.status) }.count
          for i in stride(from: count, to: cap, by: 1) {
            var filler = live
            filler.id = "filler-\(i)"
            filler.post_uri = "\(live.post_uri)-filler-\(i)"
            timers.append(filler)
          }
          return count
        }
        out.append(.number(Double(count)))
      } else {
        var headers = HTTPHeaders()
        let text = step["text"]?.stringValue
        if text != nil { headers.set("content-type", "application/json") }
        for (name, value) in step["headers"]?.objectValue ?? [:] { headers.set(name, value.stringValue ?? "") }
        if let k = step["token"]?.intValue { headers.set("authorization", "Bearer \(tokens[k])") }
        let request = HTTPRequest(
          method: step["method"]?.stringValue ?? "GET", url: "\(FakeServer.serverOrigin)\(step["path"]?.stringValue ?? "")",
          headers: headers, body: text.map { Data($0.utf8) })
        let answer = DemoNetwork.answerOf(await server.route(request))
        out.append(answer)
      }
    }
    let log = server.state.withLock { $0.log }.map { entry -> JSONValue in ["at": .string(entry.at), "line": .string(entry.line)] }
    let end: JSONValue = [
      "scheduled": DemoNetwork.shrink(.array(server.scheduled.map(\.json))),
      "timers": DemoNetwork.shrink(.array(server.timers.map(\.json))),
      "defense": DemoNetwork.shrink(defenseJSON(server.defense.tables)),
      "log": DemoNetwork.shrink(.array(log)),
      "worlds": .array(try world.worlds.map(worldState)),
    ]
    return (out, end)
  }

  @Test(arguments: try Parity.cases("demo-server.fakeServer", fn: "server").map(\.id))
  func server(_ id: String) async throws {
    try await Self.check("demo-server.fakeServer", id)
  }

  @Test(arguments: try Parity.cases("demo-server.fakeDefense", fn: "server").map(\.id))
  func defense(_ id: String) async throws {
    try await Self.check("demo-server.fakeDefense", id)
  }

  static func check(_ fixture: String, _ id: String) async throws {
    let c = try #require(try Parity.cases(fixture, fn: "server").first { $0.id == id })
    let (steps, end) = try await Self.replay(c)
    let want = c.output["steps"]?.arrayValue ?? []
    #expect(steps.count == want.count, "\(c)")
    let input = c["steps"].arrayValue ?? []
    for (i, (got, expected)) in zip(steps, want).enumerated() {
      // A quiet step keeps the status and the code only.
      var got = got
      if expected.objectValue?.keys.sorted() == ["code", "status"] {
        got = ["status": got["status"] ?? .null, "code": got["json"]?["code"] ?? .null]
      }
      let d = Exact.diff(got, expected)
      #expect(d == nil, "\(c) #\(i) \(input[i].jsonString().prefix(240)): \(d ?? "") got \(got.jsonString().prefix(400))")
    }
    for key in ["scheduled", "timers", "defense", "log", "worlds"] {
      let d = Exact.diff(end[key] ?? .null, c.output["end"]?[key] ?? .null)
      #expect(d == nil, "\(c) end.\(key): \(d ?? "")")
    }
  }
}
