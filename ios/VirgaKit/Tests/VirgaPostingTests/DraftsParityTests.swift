// Parity for src/posting/drafts/drafts.js (fixture publish.drafts): the two
// shapes of a draft, the list rows, the device id, the errors, completing a
// draft's cards, and scripts of drafts calls through Bluesky's AppView
// replayed from MockTransport, with the media store and the events each
// leaves behind.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

enum DraftsFixture {
  static let alice = "did:plc:alice"
  static let bob = "did:plc:bob"
  static let device = "0b6c3c2e-9f0a-4d6e-8a1b-2c3d4e5f6a7b"

  static let readId = try! NSRegularExpression(pattern: "^image-[0-9a-z]+-[0-9]+$")

  /// publish.drafts.js's canon: drafts.js's read ids, then the composer's
  /// fresh ids, named in the order they first appear.
  static func canon(_ value: JSONValue, _ input: JSONValue) -> JSONValue {
    var named: [String: String] = [:]
    func walk(_ v: JSONValue) -> JSONValue {
      switch v {
      case .string(let s):
        let range = NSRange(location: 0, length: s.utf16.count)
        guard readId.firstMatch(in: s, range: range) != nil else { return v }
        if let name = named[s] { return .string(name) }
        let name = "pm00000000read\(named.count + 1)"
        named[s] = name
        return .string(name)
      case .array(let items): return .array(items.map(walk))
      case .object(let members): return .object(members.mapValues(walk))
      default: return v
      }
    }
    return ComposerFixtures.canonIds(walk(value), input)
  }

  /// What a step threw, as the fixture keeps it.
  static func thrown(_ error: any Error) -> JSONValue {
    let drafts = error as? DraftsError
    return [
      "$throws": .string(jsMessage(error)),
      "code": drafts?.code.map(JSONValue.string) ?? .null,
      "postIndex": drafts?.postIndex.map { .number(Double($0)) } ?? .null,
    ]
  }
}

@Suite struct DraftsParity {
  static let f = "publish.drafts"

  @Test func constants() throws {
    for c in try cases(Self.f, "draftsConstants") {
      let l = Drafts.limits
      check(
        [
          "DRAFT_LIMITS": [
            "posts": .number(Double(l.posts)), "textGraphemes": .number(Double(l.textGraphemes)),
            "textBytes": .number(Double(l.textBytes)), "images": .number(Double(l.images)),
            "videos": .number(Double(l.videos)), "langs": .number(Double(l.langs)),
            "altGraphemes": .number(Double(l.altGraphemes)), "pageSize": .number(Double(l.pageSize)),
          ],
          "DRAFT_DEVICE_NAME": .string(Drafts.deviceNameDefault),
          "POSTING_DEVICE_KEY": .string(Drafts.postingDeviceKey),
          "DRAFT_LIMIT_MESSAGE": .string(Drafts.draftLimitMessage),
          "ORPHAN_MEDIA_MIN_AGE_MS": .number(Drafts.orphanMediaMinAgeMs),
        ], c)
    }
  }

  @Test func postingDeviceId() throws {
    for c in try cases(Self.f, "postingDeviceId") {
      let uuids = CountingUUIDs()
      var initial: [String: String] = [:]
      if let stored = c.string("stored") { initial[Drafts.postingDeviceKey] = stored }
      let memory = InMemoryKeyValueStore(initial)
      if c.string("store") == "refusing" { memory.refusesWrites = true }
      let store: (any KeyValueStore)? = c.string("store") == "none" ? nil : memory
      var ids: [JSONValue] = []
      for _ in 0..<(c.input["calls"]?.intValue ?? 1) {
        ids.append(Drafts.postingDeviceId(store, uuid: uuids.next).map(JSONValue.string) ?? .null)
      }
      check(["ids": .array(ids), "stored": memory.getItem(Drafts.postingDeviceKey).map(JSONValue.string) ?? .null], c)
    }
  }

  @Test func isDraftLimitError() throws {
    for c in try cases(Self.f, "isDraftLimitError") {
      check(.bool(Drafts.isDraftLimitError(c.input["error"])), c)
    }
  }

  @Test func composerStateToDraft() throws {
    for c in try cases(Self.f, "composerStateToDraft") {
      let result: JSONValue
      do {
        result = try Drafts.composerStateToDraft(
          c.input["state"], texts: c.input["texts"]?.arrayValue ?? [], deviceId: c.string("deviceId"),
          deviceName: c.string("deviceName"), owner: c.string("owner"), locale: c.string("locale") ?? "en-US")
      } catch {
        result = DraftsFixture.thrown(error)
      }
      check(result, c)
    }
  }

  @Test func draftToComposerState() throws {
    for c in try cases(Self.f, "draftToComposerState") {
      let asDid: String? = c.input.objectValue?.keys.contains("asDid") == true ? c.string("asDid") : DraftsFixture.alice
      let state = Drafts.draftToComposerState(c.input["view"], asDid: asDid, defaults: c.input["defaults"])
      check(DraftsFixture.canon(state, ["view": c.input["view"] ?? .null]), c)
    }
  }

  @Test func rows() throws {
    for c in try cases(Self.f, "draftLocalRefs") {
      check(.array(Drafts.draftLocalRefs(c.input["view"])), c)
    }
    for c in try cases(Self.f, "summarizeDraft") {
      check(Drafts.summarizeDraft(c.input["view"], deviceId: c.string("deviceId")), c)
    }
  }

  @Test func completeDraftCards() async throws {
    for c in try cases(Self.f, "completeDraftCards") {
      let answers = c.input["answers"]?.objectValue ?? [:]
      let calls = Locked<[(String, Double?)]>([])
      let timeoutMs = c.input["timeoutMs"]?.doubleValue ?? Drafts.cardWaitMs
      let cards = await Drafts.completeDraftCards(
        c.input["state"],
        fetchCard: { url, deadline in
          calls.withLock { $0.append((url, deadline)) }
          let answer = answers.jsValue(url)
          if answer == "throw" { throw LinkCardError("card service down") }
          return answer.flatMap { $0.isNull ? nil : $0 }
        }, timeoutMs: timeoutMs)
      let made = calls.wrappedValue
      #expect(made.allSatisfy { $0.1 == timeoutMs }, "\(c): every fetch has the wait as its deadline")
      let recorded = made.map { "\($0.0),true" }.sorted { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }
      let out: JSONValue = [
        "cards": cards.map { .array($0.map { $0 ?? .null }) } ?? .null,
        "calls": .array(recorded.map { _ in .null }),
        "deadlines": [.number(timeoutMs)],
      ]
      var expected = c.output
      // Calls are `[url, true]`; compared as their sorted strings.
      let expectedCalls = (c.output["calls"]?.arrayValue ?? []).map { "\($0[0]?.jsString ?? ""),\($0[1]?.jsString ?? "")" }
      #expect(expectedCalls == recorded, "\(c): calls \(recorded) ≠ \(expectedCalls)")
      expected["calls"] = .array(recorded.map { _ in .null })
      let d = Parity.diff(out, expected)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }

  @Test func draftsScript() async throws {
    for c in try cases(Self.f, "draftsScript") {
      let runner = DraftsScript(c)
      let outcomes = await runner.run()
      let ordered = c.input["cards"] == nil
      checkReplay(
        c, sent: runner.transport.requests, result: DraftsFixture.canon(.array(outcomes), c.input["steps"] ?? []),
        waits: nil, ordered: ordered)
      checkPart(await storeJSON(runner.media).without("persistent"), c.output["store"] ?? .null, c, "store")
      checkPart(.array(runner.heard.wrappedValue), c.output["heard"] ?? [], c, "heard")
    }
  }
}

extension JSONValue {
  func without(_ key: String) -> JSONValue {
    var out = self
    out[key] = nil
    return out
  }
}

/// One script of drafts calls: the steps publish.drafts.js's `run` takes,
/// against the recorded AppView, with one media store and one bus.
struct DraftsScript {
  let c: ParityCase
  let transport: CountingTransport
  let agent: XRPCAgent
  let media = MemoryDraftMedia()
  let bus = PostingEventBus()
  let heard = Locked<[JSONValue]>([])
  let uuids = CountingUUIDs()
  let session = AutosaveSession()

  init(_ c: ParityCase) {
    self.c = c
    transport = CountingTransport(replayTransport(c.output))
    agent = PublishFixture.agent(transport, did: DraftsFixture.alice)
    let heard = self.heard
    _ = try? PostingEvents.onPostingEvent(PostingEvents.drafts, target: bus) { detail in
      heard.withLock { $0.append(detail) }
    }
  }

  func options(_ s: JSONValue) -> DraftSaveOptions {
    let device: DraftSaveOptions.Device
    switch s["deviceId"] {
    case nil: device = .given(DraftsFixture.device)
    case "this-device"?: device = .thisDevice(store: nil)
    case let id?: device = .given(id.stringValue)
    }
    let mentions = s["mentions"]?.objectValue
    return DraftSaveOptions(
      texts: s["texts"]?.arrayValue,
      resolveMention: mentions.map { table -> ResolveMention in { @Sendable handle in table.jsValue(handle)?.stringValue } },
      validationCache: MentionValidationCache(), device: device, media: media, target: bus,
      now: { PublishFixture.now }, newRef: uuids.ref, uuid: uuids.uuid, locale: "en-US")
  }

  func run() async -> [JSONValue] {
    try? await media.put((c.input["media"]?.arrayValue ?? []).map(DraftMediaEntry.init(json:)))
    var outcomes: [JSONValue] = []
    for s in c.input["steps"]?.arrayValue ?? [] {
      do {
        outcomes.append(try await step(s, outcomes))
      } catch {
        outcomes.append(DraftsFixture.thrown(error))
      }
    }
    return outcomes
  }

  func step(_ s: JSONValue, _ outcomes: [JSONValue]) async throws -> JSONValue {
    let who: XRPCAgent? = s["agent"] == "none" ? nil : agent
    switch s["op"]?.stringValue {
    case "create":
      return try await Drafts.createDraft(who, s["state"] ?? .null, options(s)).json
    case "update":
      return try await Drafts.updateDraft(who, s["id"]?.stringValue, s["state"] ?? .null, options(s)).json
    case "delete":
      try await Drafts.deleteDraft(who, s["id"]?.stringValue, localRefs: s["localRefs"]?.arrayValue, media: media, target: bus)
      return .null
    case "list":
      let page = try await Drafts.listDrafts(who, cursor: s["cursor"], limit: s["limit"])
      return ["drafts": .array(page.drafts), "cursor": page.cursor]
    case "listAll":
      let all = try await Drafts.listAllDrafts(who, maxPages: s["maxPages"]?.intValue ?? 50)
      return ["drafts": .array(all.drafts), "complete": .bool(all.complete)]
    case "open":
      let at = s["fromList"]?[0]?.intValue ?? 0
      let index = s["fromList"]?[1]?.intValue ?? 0
      let view = outcomes[at]["drafts"]?[index]
      let named: @Sendable (JSONValue) throws -> String? = { file in "blob:\(file["name"]?.jsString ?? "undefined")" }
      let preview: (@Sendable (JSONValue) throws -> String?)? = s["preview"] == "named" ? named : nil
      let opened = await Drafts.openDraft(
        view, asDid: DraftsFixture.alice, defaults: s["defaults"],
        media: s["media"] == "fresh" ? MemoryDraftMedia() : media, makePreviewUrl: preview,
        fetchCard: s["fetchCard"] == "none" ? nil : Drafts.networkCardFetch(transport: transport))
      return ["state": opened.state, "missing": .array(opened.missing.map(JSONValue.string))]
    case "prune":
      var rows: [String: String] = [:]
      for (key, value) in s["autosave"]?.objectValue ?? [:] { rows[key] = value.stringValue }
      if let state = s["session"] {
        Autosave.saveSessionDraft(DraftsFixture.alice, state, now: PublishFixture.now, session: session)
      }
      defer { Autosave.clearSessionDraft(DraftsFixture.alice, session: session) }
      let did = s["did"].map { $0.stringValue ?? "" } ?? DraftsFixture.alice
      let dropped = try await Drafts.pruneOrphanedDraftMedia(
        who, did, media: media, now: s["now"]?.doubleValue ?? 0,
        minAgeMs: s["minAgeMs"]?.doubleValue ?? Drafts.orphanMediaMinAgeMs, store: InMemoryKeyValueStore(rows),
        session: session)
      return .array(dropped.map(JSONValue.string))
    default:
      throw DraftsError("unknown step")
    }
  }
}

@Suite struct DraftsBehaviour {
  static func agent(_ transport: MockTransport) -> XRPCAgent {
    PublishFixture.agent(transport, did: DraftsFixture.alice)
  }

  /// A page's broken entries are left out (the SDK would refuse the answer;
  /// the port reads what it can).
  @Test func listsOnlyWholeDrafts() async throws {
    let transport = MockTransport()
    transport.on(.any) { _ in
      .json([
        "success": true,
        "data": [
          "drafts": [
            ["id": "3a", "draft": ["posts": [["text": "x"]]]], ["id": "", "draft": [:]], ["draft": [:]],
            ["id": "3b", "draft": "x"], .null,
          ],
          "cursor": "",
        ],
      ])
    }
    let page = try await Drafts.listDrafts(Self.agent(transport))
    #expect(page.drafts.count == 1)
    #expect(page.drafts.first?["id"] == "3a")
    #expect(page.cursor == .null)
    let sent = try #require(transport.requests.first)
    #expect(sent.headers.get("x-atproto-proxy") == "did:web:api.bsky.app#bsky_appview")
    #expect(sent.url.hasSuffix("?limit=50"))
  }

  /// drafts.test.js: saving says so on the drafts-changed event, as the owner.
  @Test func savingIsHeard() async throws {
    let transport = MockTransport()
    transport.on(.any) { _ in .json(["success": true, "data": ["id": "3ldraft222223"]]) }
    let bus = PostingEventBus()
    let heard = Locked<[JSONValue]>([])
    _ = try PostingEvents.onPostingEvent(PostingEvents.drafts, did: DraftsFixture.alice, target: bus) { detail in
      heard.withLock { $0.append(detail) }
    }
    var state = ComposerModel.emptyComposerState(asDid: DraftsFixture.alice)
    state.posts[0].text = "x"
    let media = MemoryDraftMedia()
    let saved = try await Drafts.createDraft(
      Self.agent(transport), state.json,
      DraftSaveOptions(texts: [["text": "x", "facets": []]], device: .given(nil), media: media, target: bus))
    #expect(saved.id == "3ldraft222223")
    #expect(saved.state["source"] == ["kind": "draft", "id": "3ldraft222223", "ownerDid": .string(DraftsFixture.alice)])
    #expect(heard.wrappedValue == [["did": .string(DraftsFixture.alice), "id": "3ldraft222223", "action": "created"]])
  }

  /// The device id is made once and kept in the store, as localStorage keeps it.
  @Test func deviceIdIsKept() {
    let store = InMemoryKeyValueStore()
    let id = Drafts.postingDeviceId(store)
    #expect(id.map(Drafts.isUUIDv4) == true)
    #expect(store.getItem(Drafts.postingDeviceKey) == id)
    #expect(Drafts.postingDeviceId(store) == id)
    #expect(Drafts.postingDeviceId(nil) == nil)
  }

  /// A refusal from Bluesky's limit reads as the sentence, keeping the cause.
  @Test func limitErrors() {
    let refusal = XRPCError(statusCode: 400, error: "DraftLimitReached", message: "DraftLimitReached")
    #expect(Drafts.isDraftLimitError(refusal))
    let made = Drafts.asDraftError(refusal) as? DraftsError
    #expect(made?.code == "DRAFT_LIMIT")
    #expect(made?.message == Drafts.draftLimitMessage)
    #expect(made?.cause is XRPCError)
    // Read as the web's Error object: `code` set on it, and no longer the AppView's refusal.
    #expect(JSErrorFields(made)?.codeString == "DRAFT_LIMIT")
    #expect(JSErrorFields(made)?.message == Drafts.draftLimitMessage)
    #expect(!Drafts.isDraftLimitError(made))
    #expect(!Drafts.isDraftLimitError(XRPCError(statusCode: 500, error: "InternalServerError", message: "offline")))
  }
}
