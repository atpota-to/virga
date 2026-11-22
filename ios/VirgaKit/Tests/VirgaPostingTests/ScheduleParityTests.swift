// schedule/publishActions.js and postingQueue.js held to composer.queue,
// schedule/repeat.js to composer.repeat: the split button, the weekly
// queue's slot math and repeating posts, in several zones and across their
// clock changes.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

/// A case's device zone (`tz`), UTC when it names none.
private func device(_ c: ParityCase) -> TimeZone { ComposerFixtures.zone(c) }

/// A case's instant: an ISO string as `new Date(iso).getTime()`, or a number.
private func ms(_ value: JSONValue?) -> Double {
  switch value {
  case .number(let n)?: return n
  case .string(let s)?: return JSDate.parse(s, timeZone: TimeZone(identifier: "UTC")!)
  default: return .nan
  }
}

private func iso(_ ms: Double?) -> JSONValue {
  ms.flatMap { JSDate.toISOString($0) }.map(JSONValue.string) ?? .null
}

private func optional(_ text: String?) -> JSONValue { text.map(JSONValue.string) ?? .null }

/// A case's `{ count, first, last }` of a slot walk.
private func sample(_ slots: [Double]) -> JSONValue {
  [
    "count": .number(Double(slots.count)),
    "first": .array(slots.prefix(8).map { iso($0) }),
    "last": .array(slots.suffix(3).map { iso($0) }),
  ]
}

@Suite struct PublishActionsParity {
  static let f = "composer.queue"

  @Test func constants() throws {
    for c in try cases(Self.f, "publishActionConstants") {
      check(
        [
          "PUBLISH_ACTIONS": [
            "POST": .string(PublishActions.post), "SCHEDULE": .string(PublishActions.schedule),
            "QUEUE": .string(PublishActions.queue), "DRAFT": .string(PublishActions.draft),
          ],
          "DEFAULT_PUBLISH_ACTION": .string(PublishActions.defaultPublishAction),
          "PUBLISH_ACTION_OPTIONS": json(PublishActions.publishActionOptions),
          "EMPTY_QUEUE_HINT": .string(PublishActions.emptyQueueHint),
          "NEEDS_BACKEND_HINT": .string(PublishActions.needsBackendHintText),
          "NO_BACKEND_HINT": .string(PublishActions.noBackendHint),
          "QUEUE_REPLY_HINT": .string(PublishActions.queueReplyHint),
          "VIDEO_HINT": .string(PublishActions.videoHint),
        ], c)
    }
  }

  @Test func needsBackendHint() throws {
    for c in try cases(Self.f, "needsBackendHint") {
      check(.string(PublishActions.needsBackendHint(c.input["authMode"])), c)
    }
  }

  @Test func normalizeAndLabel() throws {
    for c in try cases(Self.f, "normalizePublishAction") {
      check(.string(PublishActions.normalizePublishAction(c.input["value"])), c)
    }
    for c in try cases(Self.f, "getPublishActionLabel") {
      check(.string(PublishActions.getPublishActionLabel(c.input["action"])), c)
    }
  }

  @Test func blockReasons() throws {
    for c in try cases(Self.f, "scheduleBlockReason") {
      check(
        optional(
          PublishActions.scheduleBlockReason(
            canSchedule: c.input["canSchedule"]?.boolValue ?? true, video: c.input["video"]?.boolValue ?? false,
            authMode: c.input["authMode"])), c)
    }
    for c in try cases(Self.f, "queueBlockReason") {
      check(optional(PublishActions.queueBlockReason(reply: c.input["reply"]?.boolValue ?? false)), c)
    }
    for c in try cases(Self.f, "publishActionBlockReason") {
      check(
        optional(
          PublishActions.publishActionBlockReason(
            c.input["action"], queueEmpty: c.input["queueEmpty"]?.boolValue ?? false,
            scheduleBlock: c.input["scheduleBlock"]?.stringValue, queueBlock: c.input["queueBlock"]?.stringValue)), c)
    }
  }

  @Test func resolvePrimaryPublishAction() throws {
    for c in try cases(Self.f, "resolvePrimaryPublishAction") {
      check(
        .string(
          PublishActions.resolvePrimaryPublishAction(
            preferred: c.input["preferred"], canSchedule: c.input["canSchedule"]?.boolValue ?? false,
            canSaveDraft: c.input["canSaveDraft"]?.boolValue ?? false)), c)
    }
  }
}

@Suite struct PostingQueueParity {
  static let f = "composer.queue"

  @Test func constants() throws {
    for c in try cases(Self.f, "queueConstants") {
      check(
        [
          "QUEUE_HORIZON_DAYS": .number(Double(PostingQueue.queueHorizonDays)),
          "MIN_LEAD_MS": .number(PostingQueue.minLeadMs),
          "DEFAULT_POSTING_QUEUE": PostingQueue.defaultPostingQueue,
          "WEEKDAYS": json(PostingQueue.weekdays),
        ], c)
    }
  }

  @Test func dayDiffAndBuckets() throws {
    for c in try cases(Self.f, "dayDiff") {
      let d = PostingQueue.dayDiff(c.input["iso"], now: ms(c.input["now"]), timeZone: device(c))
      check(d.isNaN ? .null : .number(d), c)
    }
    for c in try cases(Self.f, "dateBucketLabel") {
      check(
        .string(
          PostingQueue.dateBucketLabel(
            c.input["iso"], now: ms(c.input["now"]), locale: c.string("locale"), timeZone: device(c))), c)
    }
    for c in try cases(Self.f, "groupByDateBucket") {
      check(
        json(
          PostingQueue.groupByDateBucket(
            c.input["rows"]?.arrayValue ?? [], now: ms(c.input["now"]), locale: c.string("locale"),
            timeZone: device(c))), c)
    }
  }

  @Test func readers() throws {
    for c in try cases(Self.f, "resolveTimezone") {
      check(.string(PostingQueue.resolveTimezone(c.input["schedule"], localZone: device(c))), c)
    }
    for c in try cases(Self.f, "isScheduleEmpty") {
      check(.bool(PostingQueue.isScheduleEmpty(c.input["schedule"])), c)
    }
    for c in try cases(Self.f, "isShippedDefaultSchedule") {
      check(.bool(PostingQueue.isShippedDefaultSchedule(c.input["slots"])), c)
    }
  }

  @Test func wallTimes() throws {
    for c in try cases(Self.f, "zonedWallTimeToUtc") {
      check(iso(PostingQueue.zonedWallTimeToUtc(c.input["date"], c.input["time"], c.input["tz"])), c)
    }
    for c in try cases(Self.f, "zonedWallTime") {
      check(json(PostingQueue.zonedWallTime(c.input["value"], c.input["zone"], timeZone: device(c))), c)
    }
  }

  @Test func enumerateSlots() throws {
    for c in try cases(Self.f, "enumerateSlots") {
      let out = outcome {
        sample(
          try PostingQueue.enumerateSlots(
            c.input["schedule"], ms(c.input["from"]), c.string("zone"), localZone: device(c)))
      }
      check(out, c)
    }
  }

  @Test func nextOpenSlot() throws {
    for c in try cases(Self.f, "nextOpenSlot") {
      let out = outcome {
        iso(
          try PostingQueue.nextOpenSlot(
            c.input["schedule"], c.input["rows"]?.arrayValue ?? [], now: ms(c.input["now"]), localZone: device(c)))
      }
      check(out, c)
    }
  }

  @Test func recomputeQueueAssignment() throws {
    for c in try cases(Self.f, "recomputeQueueAssignment") {
      let out = outcome {
        json(
          try PostingQueue.recomputeQueueAssignment(
            c.input["schedule"], c.input["rows"]?.arrayValue ?? [], now: ms(c.input["now"]),
            occupied: c.input["occupied"]?.arrayValue, localZone: device(c)))
      }
      check(out, c)
    }
  }

  @Test func rowReaders() throws {
    for c in try cases(Self.f, "summarizeQueue") {
      check(json(PostingQueue.summarizeQueue(c.input["rows"]?.arrayValue ?? [], timeZone: device(c))), c)
    }
    for c in try cases(Self.f, "relativeWhen") {
      check(.string(PostingQueue.relativeWhen(c.input["iso"], now: ms(c.input["now"]), timeZone: device(c))), c)
    }
    for c in try cases(Self.f, "postSnippet") {
      check(.string(PostingQueue.postSnippet(c.input["row"], max: c.input["max"]?.intValue ?? 60)), c)
    }
    for c in try cases(Self.f, "queueSlotMoveNote") {
      let when: Double? = c.input["when"].map { $0.isNull ? nil : ms($0) } ?? nil
      check(
        .string(
          PostingQueue.queueSlotMoveNote(
            c.input["row"], when: when, now: ms(c.input["now"]),
            minLeadMs: c.input["minLeadMs"]?.doubleValue ?? PostingQueue.minLeadMs, timeZone: device(c))), c)
    }
  }
}

@Suite struct RepeatParity {
  static let f = "composer.repeat"

  @Test func constants() throws {
    for c in try cases(Self.f, "repeatConstants") {
      check(
        [
          "REPEAT_EVERY": .array(Repeat.repeatEvery.map(JSONValue.string)),
          "MAX_REPEAT_COUNT": .number(Repeat.maxRepeatCount),
          "REPEAT_OPTIONS": json(Repeat.repeatOptions),
          "REPEAT_REPLY_HINT": .string(Repeat.repeatReplyHint),
          "REPEAT_QUEUE_HINT": .string(Repeat.repeatQueueHint),
        ], c)
    }
  }

  @Test func normalizeRepeat() throws {
    for c in try cases(Self.f, "normalizeRepeat") { check(json(Repeat.normalizeRepeat(c.input["raw"])), c) }
    for c in try cases(Self.f, "repeatEnds") { check(.string(Repeat.repeatEnds(c.input["raw"])), c) }
  }

  @Test func repeatProblem() throws {
    for c in try cases(Self.f, "repeatProblem") {
      check(
        .string(
          Repeat.repeatProblem(
            c.input["raw"], c.input["at"], c.input["zone"], occurrence: c.input["occurrence"]?.doubleValue ?? 1,
            timeZone: device(c))), c)
    }
  }

  @Test func forServerAndAnchored() throws {
    for c in try cases(Self.f, "repeatForServer") {
      check(Repeat.repeatForServer(c.input["raw"], c.input["zone"]) ?? .null, c)
    }
    for c in try cases(Self.f, "anchoredRepeat") {
      check(
        Repeat.anchoredRepeat(
          c.input["raw"], c.input["at"], c.input["zone"], occurrence: c.input["occurrence"] ?? 1,
          timeZone: device(c)) ?? .null, c)
    }
  }

  @Test func occurrences() throws {
    for c in try cases(Self.f, "occurrenceTime") {
      check(json(Repeat.occurrenceTime(c.input["rule"], c.input["k"])), c)
    }
    for c in try cases(Self.f, "nextOccurrence") {
      check(json(Repeat.nextOccurrence(c.input["rule"], c.input["occurrence"], nowMs: ms(c.input["now"]))), c)
    }
  }

  @Test func words() throws {
    for c in try cases(Self.f, "repeatLabel") { check(.string(Repeat.repeatLabel(c.input["raw"])), c) }
    for c in try cases(Self.f, "repeatClause") { check(.string(Repeat.repeatClause(c.input["raw"])), c) }
    for c in try cases(Self.f, "repeatProgress") {
      check(
        .string(
          Repeat.repeatProgress(
            c.input["raw"], c.input["occurrence"], now: ms(c.input["clock"]), locale: c.string("locale"),
            timeZone: device(c))), c)
    }
    for c in try cases(Self.f, "repeatSummary") {
      check(
        .string(
          Repeat.repeatSummary(
            c.input["raw"], c.input["at"], c.input["zone"], now: ms(c.input["clock"]), locale: c.string("locale"),
            timeZone: device(c))), c)
    }
    for c in try cases(Self.f, "rowRepeat") {
      check(
        json(Repeat.rowRepeat(c.input["row"], now: ms(c.input["now"]), locale: c.string("locale"), timeZone: device(c))),
        c)
    }
  }
}
