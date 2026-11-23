// pages/scheduleModel.js held to scheduling.scheduleModel: the Scheduled,
// Weekly schedule and Timers pages' logic, in several zones, and posting a
// scheduled row now against scripted deps.

import Foundation
import Testing
import VirgaCore
import VirgaNetwork
import VirgaSession
import VirgaTestSupport
@testable import VirgaPosting

enum ScheduleModelFixture {
  /// 2026-11-12T12:00:00Z, a Thursday.
  static let now: Double = 1_794_484_800_000

  static func now(_ c: ParityCase) -> Double { c.input["now"]?.doubleValue ?? now }
  static func locale(_ c: ParityCase) -> String { c["locale"].stringValue ?? "en-US" }

  static func iso(_ ms: Double) -> JSONValue { ScheduleJS.isoJSON(ms) }
}

@Suite struct ScheduleModelParity {
  static let f = "scheduling.scheduleModel"
  typealias F = ScheduleModelFixture

  static func zone(_ c: ParityCase) -> TimeZone { ComposerFixtures.zone(c) }

  @Test func constants() throws {
    for c in try cases(Self.f, "constants") {
      check(
        [
          "POST_NOW_CUTOFF_MS": .number(ScheduleModel.postNowCutoffMs),
          "SETTLED_LABEL": .object(ScheduleModel.settledLabel.mapValues(JSONValue.string)),
          "COPY_TARGETS": json(ScheduleModel.copyTargets),
        ], c)
    }
  }

  @Test func theList() throws {
    for c in try cases(Self.f, "scheduledSections") {
      check(ScheduleModel.scheduledSections(c.input["rows"]?.arrayValue, timeZone: Self.zone(c)).json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "rowFacts") {
      let facts = ScheduleModel.rowFacts(c.input["row"], now: F.now, locale: F.locale(c), timeZone: Self.zone(c))
      check(["facts": json(facts), "tags": .array(ScheduleModel.rowTags(facts).map(JSONValue.string))], c, strictNulls: true)
    }
    for c in try cases(Self.f, "rowReply") {
      check(json(ScheduleModel.rowReply(c.input["row"])), c, strictNulls: true)
    }
    for c in try cases(Self.f, "rowStatus") {
      check(json(ScheduleModel.rowStatus(c.input["row"], now: F.now, timeZone: Self.zone(c))), c)
    }
    for c in try cases(Self.f, "rowActions") {
      check(
        [
          "actions": json(ScheduleModel.rowActions(c.input["row"], now: F.now, timeZone: Self.zone(c))),
          "dueSoon": .bool(ScheduleModel.rowIsDueSoon(c.input["row"], now: F.now, timeZone: Self.zone(c))),
        ], c)
    }
    for c in try cases(Self.f, "timerNoteActions") {
      check(ScheduleModel.timerNoteActions(c.input["row"]).json, c, strictNulls: true)
    }
  }

  @Test func timesInAZone() throws {
    for c in try cases(Self.f, "zoneLabel") {
      check(.string(ScheduleModel.zoneLabel(c.input["zone"])), c)
    }
    for c in try cases(Self.f, "formatInZone") {
      let weekday = c.input["weekday"]?.boolValue ?? true
      check(
        .string(
          ScheduleModel.formatInZone(
            c.input["value"], c.input["zone"]?.stringValue, now: F.now(c), weekday: weekday, locale: F.locale(c),
            timeZone: Self.zone(c))), c)
    }
    for c in try cases(Self.f, "timeInZone") {
      check(
        .string(
          ScheduleModel.timeInZone(c.input["value"], c.input["zone"]?.stringValue, locale: F.locale(c), timeZone: Self.zone(c))),
        c)
    }
    let runtime = try cases(Self.f, "defaultLocale").first?.output.stringValue ?? "en-US"
    for c in try cases(Self.f, "slotLabel") {
      check(.string(ScheduleModel.slotLabel(c.input["hhmm"], locale: runtime)), c)
    }
    for c in try cases(Self.f, "groupByZonedDay") {
      // An absent zone is the device's; null is a name Intl refuses.
      let zone = c.input["zone"].map { $0.isNull ? "null" : $0.jsString }
      let groups = ScheduleModel.groupByZonedDay(
        c.input["rows"]?.arrayValue, zone, now: F.now, locale: F.locale(c), timeZone: Self.zone(c))
      check(.array(groups.map(\.json)), c, strictNulls: true)
    }
  }

  @Test func reordering() throws {
    for c in try cases(Self.f, "previewOrder") {
      check(.array(ScheduleModel.previewOrder(c.input["rows"]?.arrayValue, c.input["ids"]?.arrayValue ?? [])), c)
    }
    for c in try cases(Self.f, "moveId") {
      let delta = c.input["delta"]?.doubleValue ?? (c.input["delta"] == .null ? 0 : .nan)
      check(.array(ScheduleModel.moveId(c.input["ids"]?.arrayValue ?? [], c.input["id"], delta)), c)
    }
    for c in try cases(Self.f, "moveIdTo") {
      check(
        .array(ScheduleModel.moveIdTo(c.input["ids"]?.arrayValue ?? [], c.input["id"], c.input["index"]?.doubleValue ?? .nan)),
        c)
    }
    for c in try cases(Self.f, "movableIds") {
      check(.array(ScheduleModel.movableIds(c.input["rows"]?.arrayValue, now: F.now, timeZone: Self.zone(c))), c)
    }
    for c in try cases(Self.f, "applyAssignment") {
      check(.array(ScheduleModel.applyAssignment(c.input["rows"]?.arrayValue, c.input["assignment"])), c, strictNulls: true)
    }
  }

  @Test func limits() throws {
    for c in try cases(Self.f, "scheduledLimitsLine") {
      check(.string(ScheduleModel.scheduledLimitsLine(c.input["limits"])), c)
    }
    for c in try cases(Self.f, "timerLimitsLine") {
      check(.string(ScheduleModel.timerLimitsLine(c.input["limits"], c.input["fallback"])), c)
    }
    for c in try cases(Self.f, "fullTimerBuckets") {
      check(.array(ScheduleModel.fullTimerBuckets(c.input["limits"]).map(JSONValue.string)), c)
    }
  }

  @Test func timers() throws {
    for c in try cases(Self.f, "friendlyTimerError") {
      check(.string(ScheduleModel.friendlyTimerError(c.input["code"], c.input["raw"])), c)
    }
    for c in try cases(Self.f, "ruleOfTimerRow") {
      check(ScheduleModel.ruleOfTimerRow(c.input["row"]).json, c, strictNulls: true)
    }
    for c in try cases(Self.f, "timerRowModel") {
      check(
        outcome { try ScheduleModel.timerRowModel(c.input["row"], now: F.now, locale: F.locale(c), timeZone: Self.zone(c)).json },
        c, strictNulls: true)
    }
    for c in try cases(Self.f, "timerSections") {
      let groups = (c.input["groups"]?.arrayValue ?? []).map { g in
        TimerGroup(key: g["key"]?.stringValue ?? "", title: g["title"]?.stringValue ?? "", rows: g["rows"]?.arrayValue ?? [])
      }
      check(json(ScheduleModel.timerSections(groups, c.input["waiting"]?.arrayValue ?? [])), c)
    }
    for c in try cases(Self.f, "deletedPostUris") {
      check(.array(ScheduleModel.deletedPostUris(c.input["rows"]?.arrayValue).map(JSONValue.string)), c)
    }
  }

  @Test func theWeek() throws {
    for c in try cases(Self.f, "weekly") {
      let schedule = c.input["schedule"]
      check(
        [
          "count": .number(Double(ScheduleModel.weeklyCount(schedule))),
          "summary": .string(ScheduleModel.weekSummary(schedule, locale: "en-US")),
          "isDefault": .bool(ScheduleModel.isDefaultWeek(schedule)),
        ], c)
    }
    for c in try cases(Self.f, "editWeek") {
      let s = c.input["schedule"]
      let zone = Self.zone(c)
      let result: JSONValue?
      switch c.input["op"]?.stringValue {
      case "add":
        result = ScheduleModel.addSlot(
          s, c.string("day") ?? "", c.input["time"], deviceZone: c.string("deviceZone"), localZone: zone)
      case "remove": result = ScheduleModel.removeSlot(s, c.string("day") ?? "", c.input["time"])
      case "clear": result = ScheduleModel.clearDay(s, c.string("day") ?? "")
      case "copy": result = ScheduleModel.copyDay(s, c.string("from") ?? "", c.strings("to"), localZone: zone)
      default: result = ScheduleModel.moveToZone(s, c.input["timezone"])
      }
      check(result ?? .null, c, strictNulls: true)
    }
    for c in try cases(Self.f, "nextOpenSlots") {
      check(
        outcome {
          .array(
            try ScheduleModel.nextOpenSlots(
              c.input["schedule"], c.input["rows"]?.arrayValue, now: F.now(c), count: c.input["count"]?.doubleValue ?? 5,
              timeZone: Self.zone(c)
            ).map(F.iso))
        }, c)
    }
    for c in try cases(Self.f, "offScheduleRows") {
      check(
        outcome {
          .array(try ScheduleModel.offScheduleRows(c.input["schedule"], c.input["rows"]?.arrayValue, now: F.now, timeZone: Self.zone(c)))
        }, c)
    }
  }

  @Test func thePicker() throws {
    for c in try cases(Self.f, "quickPicks") {
      let picks = ScheduleModel.quickPicks(
        now: F.now(c), c.input["zone"]?.stringValue, min: c.input["min"]?.doubleValue, max: c.input["max"]?.doubleValue,
        localZone: Self.zone(c))
      check(.array(picks.map(\.json)), c)
    }
    for c in try cases(Self.f, "whenProblem") {
      check(
        .string(
          ScheduleModel.whenProblem(
            c.input["value"], now: F.now(c), min: c.input["min"]?.doubleValue, max: c.input["max"]?.doubleValue,
            timeZone: Self.zone(c))), c)
    }
  }

  /// The generator's scripted deps, every call recorded.
  final class Script: Sendable {
    let script: JSONValue
    private let state = Locked<(calls: [JSONValue], cancels: [JSONValue], skips: [JSONValue])>(([], [], []))

    init(_ script: JSONValue) {
      self.script = script
      state.withLock {
        $0.cancels = script["cancel"]?.arrayValue ?? ["ok"]
        $0.skips = script["skip"]?.arrayValue ?? []
      }
    }

    var calls: [JSONValue] { state.withLock { $0.calls } }

    func record(_ call: JSONValue) { state.withLock { $0.calls.append(call) } }

    func outcome(_ cancel: Bool) throws {
      let next = state.withLock { s -> JSONValue in
        if cancel { return s.cancels.isEmpty ? "ok" : s.cancels.removeFirst() }
        return s.skips.isEmpty ? "ok" : s.skips.removeFirst()
      }
      if next == "ok" { return }
      throw JSError(
        message: next["message"]?.stringValue ?? "", code: next["code"], status: next["status"]?.intValue)
    }

    var deps: PostScheduledNowDeps<JSONValue> {
      let requester = ScriptedSchedule()
      var deps = PostScheduledNowDeps<JSONValue>(
        requester: requester,
        getScheduledMedia: { [self] req, id in
          record(["getScheduledMedia", .string(req?.did ?? ""), id])
          if script["media"] == "throw" { throw JSError(message: "media gone") }
          return script["media"] ?? ["p0-img0": ["base64": "AAAA", "encoding": "image/png"]]
        },
        reconstructFromScheduled: { [self] row, media, did in
          record(["reconstructFromScheduled", row["id"] ?? .null, media, .string(did)])
          return script["state"]
            ?? ["posts": [["text": "Hi", "images": []]], "schedule": ["mode": "at", "at": "x"], "lifespan": ["enabled": true]]
        },
        targetFor: { [self] did in
          record(["targetFor", .string(did)])
          return ["did": .string(did)]
        },
        publish: { [self] state, target, resolve in
          record(["publish", state, target, .string(resolve == nil ? "undefined" : "function")])
          if let message = script["publish"]?["throws"]?.stringValue { throw JSError(message: message) }
          return script["publish"]?["result"] ?? ["written": [["uri": "at://p"]], "root": ["uri": "at://p"]]
        },
        resolveMention: { _ in nil },
        cancelScheduled: { [self] _, id in
          record(["cancelScheduled", id])
          try outcome(true)
        },
        emitPostsChanged: { [self] did, added in
          record(["emitPostsChanged", .string(did), .array(added)])
          if script["emit"] == "throw" { throw JSError(message: "listener broke") }
        })
      if script["skip"] != nil {
        deps.skipScheduled = { [self] _, id in
          record(["skipScheduled", id])
          try outcome(false)
        }
      }
      if script["noArm"] != .bool(true) {
        deps.armTimer = { [self] result, state in
          record(["armTimer", result, state["lifespan"] ?? .null])
          let keys = script.objectValue?.keys.map { $0 } ?? []
          guard keys.contains("arm") else { return ArmOutcome(status: "armed", row: nil, error: nil, adjusted: nil, note: "") }
          let arm = script["arm"] ?? .null
          if arm.isNull { return nil }
          let error = arm["error"]?["message"]?.stringValue.map { TimerServiceError(message: $0) }
          return ArmOutcome(status: arm["status"]?.stringValue ?? "", row: nil, error: error, adjusted: nil, note: "")
        }
      }
      return deps
    }
  }

  /// A requester that is only an account.
  struct ScriptedSchedule: ScheduleRequester {
    var did: String? = "did:plc:me"
    func request(_ path: String, method: String, query: QueryParams?, body: JSONValue?, timeoutMs: Double)
      async throws -> JSONValue
    { throw BackendError(message: "not called") }
  }

  @Test func postScheduledNow() async throws {
    for c in try cases(Self.f, "postScheduledNow") {
      let script = Script(c.input)
      var result: JSONValue
      do {
        let out = try await ScheduleModel.postScheduledNow(
          c.input["row"], did: "did:plc:me", deps: script.deps, now: F.now, timeZone: TimeZone(identifier: "UTC")!)
        var timer: JSONValue = .null
        if let t = out.timer {
          timer = ["status": .string(t.status), "error": t.error.map { ["message": .string($0.message)] } ?? .null]
        }
        result = [
          "result": out.result, "cancelled": .bool(out.cancelled), "timer": timer,
          "notes": .array(out.notes.map(JSONValue.string)),
        ]
      } catch {
        let object = ScheduledPostError.errorObject(error)
        result = ["$error": ["message": object["message"] ?? .null, "code": object["code"] ?? .null]]
      }
      result["calls"] = .array(script.calls)
      check(result, c, strictNulls: true)
    }
  }
}
