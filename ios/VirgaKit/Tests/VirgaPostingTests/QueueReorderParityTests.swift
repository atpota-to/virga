// schedule/queueReorder.js held to scheduling.queueReorder: which queued
// rows may move, the moves an assignment makes, a move past a pinned delete
// time and the whole plan, in several zones.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct QueueReorderParity {
  static let f = "scheduling.queueReorder"

  @Test func splitQueueRows() throws {
    for c in try cases(Self.f, "splitQueueRows") {
      let split = QueueReorder.splitQueueRows(
        c.input["rows"]?.arrayValue, now: c.input["now"].jsNumber, timeZone: ComposerFixtures.zone(c))
      check(split.json, c, strictNulls: true)
    }
  }

  @Test func pendingMoves() throws {
    for c in try cases(Self.f, "pendingMoves") {
      let moves = QueueReorder.pendingMoves(c.input["assignment"], timeZone: ComposerFixtures.zone(c))
      check(.array(moves.map(\.json)), c, strictNulls: true)
    }
  }

  @Test func queueTimerConflict() throws {
    for c in try cases(Self.f, "queueTimerConflict") {
      let conflict = QueueReorder.queueTimerConflict(
        c.input["rows"]?.arrayValue, c.input["assignment"], now: c.input["now"].jsNumber, locale: "en-US",
        timeZone: ComposerFixtures.zone(c))
      check(conflict?.json ?? .null, c, strictNulls: true)
    }
  }

  @Test func planQueueReorder() throws {
    for c in try cases(Self.f, "planQueueReorder") {
      let result = outcome {
        try QueueReorder.planQueueReorder(
          c.input["schedule"], c.input["rows"]?.arrayValue, c.input["orderedIds"]?.arrayValue,
          now: c.input["now"].jsNumber, locale: "en-US", timeZone: ComposerFixtures.zone(c)
        ).json
      }
      check(result, c, strictNulls: true)
    }
  }
}
