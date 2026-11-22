// pages/draftActions.js held to scheduling.draftActions: a draft row's
// meta line and labels, the blocks and messages, preparing, posting and
// scheduling a draft against scripted deps, and the blob loader replayed
// through MockTransport.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct DraftActionsParity {
  static let f = "scheduling.draftActions"
  static let did = "did:plc:mira"
  /// 2026-11-12T12:00:00Z.
  static let now: Double = 1_794_484_800_000

  static func locale(_ c: ParityCase) -> String { c["locale"].stringValue ?? "en-US" }

  @Test func theList() throws {
    for c in try cases(Self.f, "draftMeta") {
      let parts = DraftActions.draftMeta(
        c.input["row"], now: c.input["now"]?.doubleValue ?? Self.now, locale: Self.locale(c),
        timeZone: ComposerFixtures.zone(c))
      check(.array(parts.map(JSONValue.string)), c)
    }
    for c in try cases(Self.f, "editedLabel") {
      check(
        .string(
          DraftActions.editedLabel(
            c.input["iso"], now: c.input["now"]?.doubleValue ?? Self.now, locale: Self.locale(c),
            timeZone: ComposerFixtures.zone(c))), c)
    }
    for c in try cases(Self.f, "draftScheduleBlock") {
      check(.string(DraftActions.draftScheduleBlock(c.input["row"], canSchedule: c.input["can"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "draftPostBlock") {
      check(.string(DraftActions.draftPostBlock(c.input["row"], canPost: c.input["can"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "draftActionMessage") {
      check(.string(DraftActions.draftActionMessage(c.input["err"], action: c.string("action") ?? "")), c)
    }
  }

  /// The generator's scripted deps, every call recorded.
  final class Script: Sendable {
    let script: JSONValue
    private let log = Locked<[JSONValue]>([])

    init(_ script: JSONValue) { self.script = script }

    var calls: [JSONValue] { log.withLock { $0 } }
    func record(_ call: JSONValue) { log.withLock { $0.append(call) } }
    var keys: [String] { script.objectValue?.keys.map { $0 } ?? [] }

    static func baseState(_ over: [String: JSONValue] = [:]) -> JSONValue {
      var state: [String: JSONValue] = [
        "posts": [["id": "p", "text": "hello", "images": [], "video": nil, "record": nil, "card": nil]],
        "reply": nil, "tags": [], "langs": ["en"], "labels": [],
        "gates": ["custom": false, "reply": nil, "quotes": true],
        "asDid": .string(DraftActionsParity.did), "schedule": nil, "lifespan": ["enabled": false],
        "source": ["kind": "draft", "id": "d1", "ownerDid": .string(DraftActionsParity.did)],
      ]
      for (key, value) in over { state[key] = value }
      return .object(state)
    }

    static let result: JSONValue = [
      "posts": [["uri": "at://did:plc:mira/app.bsky.feed.post/1", "cid": "c"]],
      "root": ["uri": "at://did:plc:mira/app.bsky.feed.post/1", "cid": "c"],
      "written": [["uri": "at://did:plc:mira/app.bsky.feed.post/1", "cid": "c", "record": ["text": "hello"]]],
    ]

    var deps: DraftActionDeps<JSONValue> {
      var deps = DraftActionDeps<JSONValue>(
        openDraft: { [self] view, asDid, defaults in
          record(["openDraft", view["id"] ?? .null, .string(asDid), defaults ?? .null])
          if script["open"] == "throw" { throw JSError(message: "could not open") }
          let open = script["open"]
          return DraftMedia.Loaded(
            state: open?["state"] ?? Self.baseState(),
            missing: open?["missing"]?.arrayValue?.compactMap(\.stringValue) ?? [])
        },
        resolveDefaultGates: { [self] settings, agent in
          record(["resolveDefaultGates", settings ?? .null, agent == nil ? .null : "agent"])
          if script["gates"] == "throw" { throw JSError(message: "gates broke") }
          let gates = script["gates"]
          return ResolvedDefaultGates(
            gates: gates?["gates"] ?? ["custom": false, "reply": [["type": "following"]], "quotes": true],
            source: "bluesky", notice: gates?["notice"]?.stringValue)
        },
        targetFor: { [self] did in
          record(["targetFor", .string(did)])
          return ["did": .string(did)]
        },
        publish: { [self] state, target, resolve, requireAltText in
          record(["publish", state, target, .string(resolve == nil ? "undefined" : "function"), .bool(requireAltText)])
          if let message = script["publish"]?["throws"]?.stringValue { throw JSError(message: message) }
          return script["publish"]?["result"] ?? Self.result
        },
        emitPostsChanged: { [self] did, added in
          record(["emitPostsChanged", .string(did), .array(added)])
          if script["emit"] == "throw" { throw JSError(message: "listener broke") }
        },
        deleteDraft: { [self] agent, id in
          record(["deleteDraft", agent == nil ? .null : "agent", id])
          if script["deleteDraft"] == "throw" { throw JSError(message: "x") }
        },
        resolveMention: { _ in nil },
        serializeForSchedule: { [self] state, request in
          record([
            "serializeForSchedule", state,
            [
              "now": .number(request.now), "scheduledFor": request.scheduledFor ?? .null, "queued": .bool(request.queued),
              "resolveMention": .string(request.resolveMention == nil ? "undefined" : "function"),
              "loadImage": .string(request.loadImage == nil ? "undefined" : "function"),
            ],
          ])
          if script["serialize"] == "throw" { throw JSError(message: "Write something first.", code: "EMPTY") }
          var body: [String: JSONValue] = ["queued": .bool(request.queued), "payload": [:]]
          body["scheduledFor"] = request.scheduledFor
          return .object(body)
        },
        createScheduled: { [self] req, body in
          record(["createScheduled", req.did.map(JSONValue.string) ?? .null, body])
          if let message = script["create"]?["throws"]?.stringValue {
            throw JSError(message: message, code: script["create"]?["code"])
          }
          return ["id": "row1"]
        },
        requester: script["requester"] == .bool(false) ? nil : ScheduleModelParity.ScriptedSchedule(did: DraftActionsParity.did))
      if keys.contains("timerRoom") {
        deps.timerRoom = { [self] rule in
          record(["timerRoom", rule])
          return script["timerRoom"]?.stringValue
        }
      }
      if keys.contains("arm") {
        deps.armTimer = { [self] result, state in
          record(["armTimer", result, state["lifespan"] ?? .null])
          let arm = script["arm"] ?? .null
          if arm.isNull { return nil }
          let error = arm["error"]?["message"]?.stringValue.map { TimerServiceError(message: $0) }
          return ArmOutcome(status: arm["status"]?.stringValue ?? "", row: nil, error: error, adjusted: nil, note: "")
        }
      }
      if script["loadImage"] == .bool(true) { deps.loadImage = { _ in nil } }
      return deps
    }
  }

  static func timerJSON(_ timer: ArmOutcome?) -> JSONValue {
    guard let timer else { return .null }
    return ["status": .string(timer.status), "error": timer.error.map { ["message": .string($0.message)] } ?? .null]
  }

  @Test(arguments: ["prepare", "post", "schedule"]) func actions(_ action: String) async throws {
    let view: JSONValue = ["id": "d1", "draft": ["posts": [["text": "hello"]]]]
    for c in try cases(Self.f, action) {
      let script = Script(c.input)
      let deps = script.deps
      let settings = c.input["settings"] ?? [:]
      let agent: XRPCAgent? =
        c.input["agent"] == .bool(true) ? PostedModelParity.agent(MockTransport()) : nil
      var result: JSONValue
      do {
        switch action {
        case "prepare":
          let out = try await DraftActions.prepareDraft(view, did: Self.did, settings: settings, agent: agent, deps: deps)
          result = ["state": out.state, "notes": .array(out.notes.map(JSONValue.string))]
        case "post":
          let out = try await DraftActions.postDraftNow(view, did: Self.did, settings: settings, agent: agent, deps: deps)
          result = [
            "result": out.result, "notes": .array(out.notes.map(JSONValue.string)), "timer": Self.timerJSON(out.timer),
            "deleted": .bool(out.deleted),
          ]
        default:
          let out = try await DraftActions.scheduleDraft(
            view, did: Self.did, settings: settings, agent: agent, scheduledFor: c.input["scheduledFor"],
            queued: c.input["queued"]?.boolValue ?? false, now: Self.now, deps: deps)
          result = ["row": out.row, "notes": .array(out.notes.map(JSONValue.string)), "deleted": .bool(out.deleted)]
        }
      } catch {
        let object = ScheduledPostError.errorObject(error)
        result = ["$error": ["message": object["message"] ?? .null, "code": object["code"] ?? .null]]
      }
      result["calls"] = .array(script.calls)
      check(result, c, strictNulls: true)
    }
  }

  @Test func blobImageLoader() async throws {
    for c in try cases(Self.f, "blobImageLoader") {
      let transport = replayTransport(c.output)
      let load = DraftActions.blobImageLoader(
        did: c.string("did") ?? Self.did, pdsUrl: c.string("pdsUrl"), transport: transport, files: InMemoryComposerFiles())
      var file = (try await load(c.input["image"] ?? [:]))?.json ?? .null
      file["lastModified"] = nil
      file["ref"] = nil
      checkReplay(c, sent: transport.requests, result: file, waits: nil)
    }
  }
}
