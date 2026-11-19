// threadBatch.js, embeds.js, gates.js, composeIntent.js and events.js, held
// to the web's output (ios/parity/cases/posting-text.{threadBatch,embeds,
// gates,composeIntent,events}.js).

import Foundation
import Testing
import VirgaCore
import VirgaRepo
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct ThreadBatchParity {
  /// The web's `new Date(now).getTime()` of a fixture's `now`.
  static func nowMs(_ c: ParityCase) -> Double {
    switch c["now"] {
    case .string(let text): return VirgaRepo.JSDate.parse(text, timeZone: TimeZone(identifier: "UTC")!)
    case .number(let ms): return ms
    default: return .nan
    }
  }

  @Test func buildThreadWrites() throws {
    for c in try cases("posting-text.threadBatch", "buildThreadWrites") {
      let replyTo = (try? c.input["replyTo"]?.decode(ThreadReplyTo.self)) ?? nil
      // The fixture's own minter, or the shared clock's where the web used
      // it (only where it throws, so the output holds no clock).
      let mint: (Double) throws -> String
      if c["defaultMinter"].boolValue == true {
        mint = { try ThreadBatch.nextTid($0) }
      } else {
        mint = { "tid" + JSNumber.format($0) }
      }
      let actual = outcome {
        json(
          try ThreadBatch.buildThreadWrites(
            did: "did:plc:testwriter",
            collection: c.string("collection") ?? "app.bsky.feed.post",
            records: c["records"].arrayValue ?? [],
            replyTo: replyTo,
            nowMs: Self.nowMs(c),
            timeZone: TimeZone(identifier: "UTC")!,
            mintTid: mint))
      }
      check(actual, c, strictNulls: true)
    }
  }

  /// The minter is asked for each key before the time is written, so an
  /// invalid time reaches it before "Invalid time value".
  @Test func mintTidCalls() throws {
    for c in try cases("posting-text.threadBatch", "mintTidCalls") {
      var calls: [JSONValue] = []
      var actual: JSONValue
      do {
        let batch = try ThreadBatch.buildThreadWrites(
          did: "did:plc:testwriter", records: c["records"].arrayValue ?? [], nowMs: Self.nowMs(c),
          timeZone: TimeZone(identifier: "UTC")!,
          mintTid: { ms in
            calls.append(.string(JSNumber.format(ms)))
            return "tid" + JSNumber.format(ms)
          })
        actual = ["created": .number(Double(batch.created.count))]
      } catch {
        actual = ["$throws": .string(message(of: error))]
      }
      actual["calls"] = .array(calls)
      check(actual, c, strictNulls: true)
    }
  }

  @Test func eachCidIsTheStoredRecordsAndRepliesChain() throws {
    let records: [JSONValue] = (1...3).map { ["$type": "app.bsky.feed.post", "text": .string("post \($0)")] }
    let batch = try ThreadBatch.buildThreadWrites(
      did: "did:plc:me", records: records, nowMs: 1_800_000_000_000, timeZone: TimeZone(identifier: "UTC")!)
    #expect(batch.writes.count == 3)
    #expect(batch.writes.map(\.rkey) == batch.writes.map(\.rkey).sorted())
    #expect(Set(batch.writes.map(\.rkey)).count == 3)
    for created in batch.created {
      #expect(try RecordCid.computeRecordCid(created.record) == created.cid)
      #expect(TID.isTid(created.rkey))
    }
    #expect(batch.created[2].record["reply"]?["root"]?["uri"]?.stringValue == batch.created[0].uri)
    #expect(batch.created[2].record["reply"]?["parent"]?["cid"]?.stringValue == batch.created[1].cid)
    #expect(json(batch.writes[0])["$type"] == "com.atproto.repo.applyWrites#create")
  }
}

@Suite struct EmbedsParity {
  static let f = "posting-text.embeds"

  @Test func buildRecordEmbed() throws {
    for c in try cases(Self.f, "buildRecordEmbed") {
      check(Embeds.buildRecordEmbed(c["record"]), c, strictNulls: true)
    }
  }

  @Test func combineRecordWithMedia() throws {
    for c in try cases(Self.f, "combineRecordWithMedia") {
      check(Embeds.combineRecordWithMedia(c["record"], c.input["media"]), c, strictNulls: true)
    }
  }

  @Test func buildVideoEmbed() throws {
    for c in try cases(Self.f, "buildVideoEmbed") {
      let embed = Embeds.buildVideoEmbed(blob: c.input["blob"], alt: c.input["alt"], aspectRatio: c.input["aspectRatio"])
      check(embed, c, strictNulls: true)
    }
  }

  @Test func buildImageRecord() throws {
    for c in try cases(Self.f, "buildImageRecord") {
      let record = Embeds.buildImageRecord(alt: c.input["alt"], blob: c.input["blob"], aspectRatio: c.input["aspectRatio"])
      check(record, c, strictNulls: true)
    }
  }

  @Test func buildImagesEmbed() throws {
    for c in try cases(Self.f, "buildImagesEmbed") {
      check(Embeds.buildImagesEmbed(c["records"].arrayValue ?? []), c, strictNulls: true)
    }
  }

  @Test func buildExternalEmbed() throws {
    for c in try cases(Self.f, "buildExternalEmbed") {
      check(Embeds.buildExternalEmbed(c["card"], c.input["thumb"]), c, strictNulls: true)
    }
  }

  @Test func buildPostEmbed() throws {
    for c in try cases(Self.f, "buildPostEmbed") {
      check(Embeds.buildPostEmbed(c.input["post"], c.input["blobs"]) ?? .null, c, strictNulls: true)
    }
  }

  @Test func normalizeImageEmbed() throws {
    for c in try cases(Self.f, "normalizeImageEmbed") {
      check(Embeds.normalizeImageEmbed(c.input["embed"]) ?? .null, c, strictNulls: true)
    }
  }
}

/// The fake agent of gates.test.js: a store of gate records; reading or
/// deleting a missing one throws RecordNotFound.
actor FakeGatesAgent: GatesAgent {
  struct Failure: Error, LocalizedError, XRPCErrorDescribing {
    var message: String
    var xrpcError: String?
    var errorDescription: String? { message }
  }

  var store: [String: JSONValue]
  var reads: [JSONValue] = []
  var writes: [JSONValue] = []
  let failGet: [String: String]
  let failPut: [String: String]
  let failDelete: [String: String]
  let preferences: @Sendable () async throws -> JSONValue

  init(
    store: [String: JSONValue] = [:], failGet: [String: String] = [:], failPut: [String: String] = [:],
    failDelete: [String: String] = [:], preferences: @escaping @Sendable () async throws -> JSONValue = { .null }
  ) {
    self.store = store
    self.failGet = failGet
    self.failPut = failPut
    self.failDelete = failDelete
    self.preferences = preferences
  }

  static func notFound() -> Failure { Failure(message: "Could not locate record", xrpcError: "RecordNotFound") }

  func getPreferences() async throws -> JSONValue { try await preferences() }

  func getRecord(repo: String, collection: String, rkey: String) async throws -> JSONValue {
    reads.append(["op": "get", "repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)])
    if let message = failGet[collection] { throw Failure(message: message) }
    guard let value = store[collection] else { throw Self.notFound() }
    return ["uri": .string("at://\(repo)/\(collection)/\(rkey)"), "value": value]
  }

  func putRecord(repo: String, collection: String, rkey: String, record: JSONValue) async throws {
    writes.append([
      "op": "put", "repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey), "record": record,
    ])
    if let message = failPut[collection] { throw Failure(message: message) }
    store[collection] = record
  }

  func deleteRecord(repo: String, collection: String, rkey: String) async throws {
    writes.append(["op": "delete", "repo": .string(repo), "collection": .string(collection), "rkey": .string(rkey)])
    if let message = failDelete[collection] { throw Failure(message: message) }
    guard store[collection] != nil else { throw Self.notFound() }
    store[collection] = nil
  }

  func sortedReads() -> [JSONValue] {
    reads.sorted { ($0["collection"]?.stringValue ?? "") < ($1["collection"]?.stringValue ?? "") }
  }
}

@Suite struct GatesParity {
  static let f = "posting-text.gates"

  @Test func constants() throws {
    let c = try cases(Self.f, "constants")[0]
    check(
      [
        "MAX_REPLY_RULES": .number(Double(Gates.maxReplyRules)), "EVERYONE_GATES": json(Gates.everyoneGates),
        "DEFAULT_GATES_TIMEOUT_MS": .number(Gates.defaultGatesTimeoutMs),
      ], c, strictNulls: true)
  }

  @Test func gatesToRules() throws {
    for c in try cases(Self.f, "gatesToRules") {
      check(Gates.gatesToRules(c.input["gates"]).json, c, strictNulls: true)
    }
  }

  @Test func gatesFromRules() throws {
    for c in try cases(Self.f, "gatesFromRules") {
      check(json(Gates.gatesFromRules(c.input["rules"])), c, strictNulls: true)
    }
  }

  @Test func gatesEqual() throws {
    for c in try cases(Self.f, "gatesEqual") {
      check(.bool(Gates.gatesEqual(c.input["a"], c.input["b"])), c)
    }
  }

  @Test func defaultGatesFromPreferences() throws {
    for c in try cases(Self.f, "defaultGatesFromPreferences") {
      check(json(Gates.defaultGatesFromPreferences(c.input["preferences"])), c, strictNulls: true)
    }
  }

  @Test func readDefaultGates() async throws {
    for c in try cases(Self.f, "readDefaultGates") {
      let answer = c.input["answer"]
      let fails = c["fails"].boolValue == true
      let never = c["never"].boolValue == true
      let agent = FakeGatesAgent(preferences: {
        if fails { throw FakeGatesAgent.Failure(message: "x") }
        if never { try await Task.sleep(for: .seconds(30)) }
        return answer ?? .null
      })
      let result = await Gates.readDefaultGates(agent, timeoutMs: c["timeoutMs"].doubleValue ?? Gates.defaultGatesTimeoutMs)
      check(json(result), c, strictNulls: true)
    }
  }

  @Test func updatePostGates() async throws {
    for c in try cases(Self.f, "updatePostGates") {
      func table(_ key: String) -> [String: String] {
        (c[key].objectValue ?? [:]).compactMapValues(\.stringValue)
      }
      let agent = FakeGatesAgent(
        store: c["store"].objectValue ?? [:], failGet: table("failGet"), failPut: table("failPut"),
        failDelete: table("failDelete"))
      let change = c["change"]
      let now = Date(timeIntervalSince1970: 1_794_441_600)  // 2026-11-12T00:00:00Z
      let result = await outcome {
        json(
          try await Gates.updatePostGates(
            agent, uri: c.string("uri") ?? "at://did:plc:me/app.bsky.feed.post/3p", reply: change["reply"] ?? .null,
            quotes: change["quotes"]?.boolValue ?? false, now: now))
      }
      let actual: JSONValue = [
        "result": result, "reads": .array(await agent.sortedReads()), "writes": .array(await agent.writes),
        "store": .object(await agent.store),
      ]
      check(actual, c, strictNulls: true)
    }
  }

  @Test func typedGatesRoundTrip() throws {
    for gates in [
      PostGates(reply: nil, quotes: true), PostGates(reply: [], quotes: false),
      PostGates(reply: [.follower, .list("at://did:plc:me/app.bsky.graph.list/3l")], quotes: true),
    ] {
      #expect(Gates.gatesFromRules(Gates.gatesToRules(gates)) == gates)
      #expect(try JSONValue(encoding: gates).decode(PostGates.self) == gates)
    }
    #expect(json(PostGates())["reply"] == .null, "everyone is written as null, as the web stores it")
    #expect(Gates.gatesEqual(PostGates(reply: [.mention, .follower]), PostGates(reply: [.follower, .mention])))
  }
}

@Suite struct ComposeIntentParity {
  static let f = "posting-text.composeIntent"

  @Test func constants() throws {
    let c = try cases(Self.f, "constants")[0]
    check(
      [
        "INTENT_COMPOSE_PATH": .string(ComposeIntent.intentComposePath),
        "MAX_POST_GRAPHEMES": .number(Double(ComposeIntent.maxPostGraphemes)),
        "COMPOSE_INTENT_PARAMS": json(ComposeIntent.composeIntentParams),
      ], c)
  }

  @Test func parseComposeIntent() throws {
    for c in try cases(Self.f, "parseComposeIntent") {
      let search = c.input["search"]
      let parsed: ParsedComposeIntent
      if let pairs = search?["$params"]?.arrayValue {
        parsed = ComposeIntent.parseComposeIntent(
          URLSearchParams(pairs: pairs.map { ($0[0]?.stringValue ?? "", $0[1]?.stringValue ?? "") }))
      } else {
        parsed = ComposeIntent.parseComposeIntent(search)
      }
      check(json(parsed), c, strictNulls: true)
    }
  }

  static func input(_ intent: JSONValue) -> ComposeIntentInput {
    var tags: ComposeIntentInput.Tags?
    if let list = intent["tags"]?.arrayValue {
      tags = .list(list.compactMap(\.stringValue))
    } else if let text = intent["tags"]?.stringValue {
      tags = .text(text)
    }
    return ComposeIntentInput(text: intent["text"]?.stringValue, url: intent["url"]?.stringValue, tags: tags)
  }

  @Test func buildComposeIntentUrl() throws {
    for c in try cases(Self.f, "buildComposeIntentUrl") {
      let actual = outcome { .string(try ComposeIntent.buildComposeIntentUrl(Self.input(c["intent"]), origin: c.string("origin"))) }
      check(actual, c)
    }
  }

  @Test func roundTrip() throws {
    for c in try cases(Self.f, "roundTrip") {
      let url = try ComposeIntent.buildComposeIntentUrl(Self.input(c["intent"]), origin: c.string("origin"))
      check(json(ComposeIntent.parseComposeIntent(url)), c, strictNulls: true)
    }
  }
}

@Suite struct EventsParity {
  static let f = "posting-text.events"

  @Test func names() throws {
    check(json(PostingEvents.postingEvents), try cases(Self.f, "POSTING_EVENTS")[0])
    check(
      [
        "POSTING_SETTINGS_EVENT": .string(PostingEvents.postingSettingsEvent),
        "TEMPLATES_CHANGED_EVENT": .string(PostingEvents.templatesChangedEvent),
        "DRAFTS_CHANGED_EVENT": .string(PostingEvents.draftsChangedEvent),
        "SCHEDULED_CHANGED_EVENT": .string(PostingEvents.scheduledChangedEvent),
        "TIMERS_CHANGED_EVENT": .string(PostingEvents.timersChangedEvent),
        "POSTS_CHANGED_EVENT": .string(PostingEvents.postsChangedEvent),
      ], try cases(Self.f, "names")[0])
  }

  /// The generator's scripts, played on a fresh bus.
  @Test func script() throws {
    for c in try cases(Self.f, "script") {
      let bus = PostingEventBus()
      var offs: [String: PostingEventUnsubscribe] = [:]
      let heard = Locked<[String: [JSONValue]]>([:])
      var results: [JSONValue] = []
      for step in c["steps"].arrayValue ?? [] {
        let target: PostingEventBus? = step["noTarget"]?.boolValue == true ? nil : bus
        let name = step["name"]?.stringValue ?? ""
        do {
          switch step["op"]?.stringValue {
          case "on":
            let id = step["id"]?.stringValue ?? ""
            heard.withLock { $0[id] = [] }
            offs[id] = try PostingEvents.onPostingEvent(name, did: step["did"]?.stringValue, target: target) { detail in
              heard.withLock { $0[id, default: []].append(detail) }
            }
            results.append("function")
          case "off":
            offs[step["id"]?.stringValue ?? ""]?()
            results.append(.null)
          case "emit":
            results.append(.bool(try PostingEvents.emitPostingEvent(name, step["detail"], target: target)))
          case "emitPosts":
            results.append(
              .bool(
                try PostingEvents.emitPostsChanged(
                  step["did"]?.stringValue, added: step["added"]?.arrayValue ?? [],
                  removed: step["removed"]?.arrayValue ?? [], target: target)))
          default:
            break
          }
        } catch {
          results.append(["$throws": .string(message(of: error)), "type": "TypeError"])
        }
      }
      check(["results": .array(results), "heard": .object(heard.wrappedValue.mapValues(JSONValue.array))], c)
    }
  }

  @Test func theSharedBusAndStreams() async throws {
    let did = "did:plc:stream\(UInt32.random(in: 0...UInt32.max))"
    let stream = try PostingEvents.postingEvents(PostingEvents.drafts, did: did)
    try PostingEvents.emitPostingEvent(PostingEvents.drafts, ["did": "did:plc:someone-else"])
    try PostingEvents.emitPostingEvent(PostingEvents.drafts, ["did": .string(did), "id": "d1", "action": "created"])
    var iterator = stream.makeAsyncIterator()
    let first = await iterator.next()
    #expect(first?["id"] == "d1")
  }

  @Test func aListenerRemovedDuringDispatchIsNotCalled() throws {
    let bus = PostingEventBus()
    let calls = Locked<[String]>([])
    let second = Locked<PostingEventUnsubscribe?>(nil)
    _ = try PostingEvents.onPostingEvent(PostingEvents.timers, target: bus) { _ in
      calls.withLock { $0.append("first") }
      second.wrappedValue?()
    }
    second.set(try PostingEvents.onPostingEvent(PostingEvents.timers, target: bus) { _ in
      calls.withLock { $0.append("second") }
    })
    try PostingEvents.emitPostingEvent(PostingEvents.timers, ["did": "did:plc:a"], target: bus)
    #expect(calls.wrappedValue == ["first"])
    #expect(bus.listenerCount(PostingEvents.timers) == 1)
  }
}
