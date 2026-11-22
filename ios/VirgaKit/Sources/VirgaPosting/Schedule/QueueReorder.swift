// Ports src/posting/schedule/queueReorder.js
//
// Re-packing the weekly queue after a drag. The order is drawn from the rows
// that may move; every other queued row keeps its minute and the re-pack
// steps around it (recomputeQueueAssignment's `occupied`). Pure.
//
// Rows are listScheduled's, as loose JSON. Times without an offset are read
// in `timeZone` (the device's; nil for the active one). The web words a
// pinned delete time against Date.now() (scheduledRowTimerProblem); the
// port takes that clock as `now`, the same instant the plan packs from.
//
// A null row in a plan's rows throws the web's TypeError (queueTimerConflict
// reads every row's id). Not reproduced (corrupt input only): the
// standalone queueTimerConflict reads a null row as one without an id, and
// pendingMoves reads an assignment that isn't a list as none, where the web
// throws.

import Foundation
import VirgaCore

/// splitQueueRows' answer: what may move (soonest first) and what holds its
/// minute.
public struct QueueRowsSplit: Hashable, Sendable {
  public var movable: [JSONValue]
  public var occupied: [JSONValue]

  public var json: JSONValue { ["movable": .array(movable), "occupied": .array(occupied)] }
}

/// A row's move to a new slot: `{ id, scheduledFor }` (the id as the row
/// holds it; absent when it has none).
public struct QueueMove: Codable, Hashable, Sendable {
  public var id: JSONValue?
  public var scheduledFor: JSONValue

  public init(id: JSONValue?, scheduledFor: JSONValue) {
    self.id = id
    self.scheduledFor = scheduledFor
  }

  public var json: JSONValue {
    var out: JSONValue = ["scheduledFor": scheduledFor]
    if let id { out["id"] = id }
    return out
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(id, forKey: .id)
    try container.encode(scheduledFor, forKey: .scheduledFor)
  }
}

/// The first move an order would make past a row's pinned delete time.
public struct QueueTimerConflict: Codable, Hashable, Sendable {
  public var id: JSONValue?
  public var message: String
  public var problem: String

  public var json: JSONValue {
    var out: JSONValue = ["message": .string(message), "problem": .string(problem)]
    if let id { out["id"] = id }
    return out
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(id, forKey: .id)
    try container.encode(message, forKey: .message)
    try container.encode(problem, forKey: .problem)
  }
}

/// What the web throws reading a row that isn't one.
public struct QueueReorderError: Error, LocalizedError, ScheduleErrorObject, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
  public var errorObject: JSONValue { ["name": "TypeError", "message": .string(message)] }
}

/// Everything a drag needs: `{ assignment, moves, conflict }`.
public struct QueueReorderPlan: Hashable, Sendable {
  public var assignment: [QueueAssignment]
  public var moves: [QueueMove]
  public var conflict: QueueTimerConflict?

  public var json: JSONValue {
    [
      "assignment": QueueReorder.json(assignment),
      "moves": .array(moves.map(\.json)),
      "conflict": conflict?.json ?? .null,
    ]
  }
}

public enum QueueReorder {
  static func json<T: Encodable>(_ value: T) -> JSONValue {
    (try? JSONValue(encoding: value)) ?? .null
  }

  /// The account's queued rows, split into what may move (pending, none of
  /// a thread out yet, its time still ahead; soonest first) and what may
  /// not (every other queued row, whatever its state, which still holds its
  /// minute).
  ///
  /// A pending row whose time is no later than the first slot a re-pack
  /// can hand out (`now` + minLeadMs) is due, or waiting out a retry after a
  /// failed attempt. It stays where it is: re-packing would give it the next
  /// future slot, delaying it by a slot and pushing every row behind it back
  /// one, and the server's reorder would also clear its retry time.
  public static func splitQueueRows(_ rows: [JSONValue]? = [], now: Double, timeZone: TimeZone? = nil)
    -> QueueRowsSplit
  {
    var movable: [JSONValue] = []
    var occupied: [JSONValue] = []
    for row in rows ?? [] {
      guard ComposerJS.truthy(row["queued"]) else { continue }
      let at = ScheduleJS.instant(row["scheduledFor"], timeZone)
      let due = now.isFinite && at <= now + PostingQueue.minLeadMs
      let moves = row["status"] == "pending" && !ComposerJS.truthy(row["partial"]) && !due
      if moves { movable.append(row) } else { occupied.append(row) }
    }
    movable = TimerJS.v8Sorted(movable) {
      ScheduleJS.instant($0["scheduledFor"], timeZone) - ScheduleJS.instant($1["scheduledFor"], timeZone)
    }
    return QueueRowsSplit(movable: movable, occupied: occupied)
  }

  /// The moves an assignment makes: only rows whose instant changed,
  /// compared as instants (the server writes `+00:00`, toISOString writes
  /// `Z`). A row pushed past the horizon (null) isn't moved.
  public static func pendingMoves(_ assignment: JSONValue?, timeZone: TimeZone? = nil) -> [QueueMove] {
    (assignment?.arrayValue ?? []).compactMap { a -> QueueMove? in
      guard let to = a["newScheduledFor"], to.isTruthy else { return nil }
      let from = ScheduleJS.instant(a["oldScheduledFor"], timeZone)
      let next = ScheduleJS.instant(to, timeZone)
      // `!==`: NaN differs from everything, itself included.
      guard from.isNaN || next.isNaN || from != next else { return nil }
      return QueueMove(id: a["id"], scheduledFor: to)
    }
  }

  public static func pendingMoves(_ assignment: [QueueAssignment], timeZone: TimeZone? = nil) -> [QueueMove] {
    pendingMoves(json(assignment), timeZone: timeZone)
  }

  /// A row's first words, in curly quotes, for a sentence.
  static func nameOf(_ row: JSONValue?) -> String {
    let raw = ScheduleJS.first(row?["payload"]?["posts"])?["record"]?["text"]
    let text = ScheduleJS.collapseSpace(ScheduledPostError.text(raw)).jsTrimmed()
    if text.isEmpty { return "One of these posts" }
    return "“\(text.jsLength > 40 ? "\(text.jsSlice(0, 40).jsTrimmingEnd())…" : text)”"
  }

  /// The first row an assignment would move past its pinned delete time (or
  /// more than 30 days before it, which the server can't hold), with what
  /// to say; else nil. Checked before the new order is drawn, so an order
  /// that can't be saved is never shown. `now` and `locale` are the pin's
  /// words' (the web's Date.now() and active locale).
  public static func queueTimerConflict(
    _ rows: [JSONValue]?, _ assignment: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> QueueTimerConflict? {
    var byId: [String: JSONValue] = [:]
    for row in rows ?? [] {
      let key = row["id"].map(\.jsString) ?? "undefined"
      byId[byId.keys.first { $0.jsEquals(key) } ?? key] = row
    }
    for move in pendingMoves(assignment, timeZone: timeZone) {
      let row = byId.jsValue(move.id.map(\.jsString) ?? "undefined")
      let problem = SelfDestruct.scheduledRowTimerProblem(
        row, move.scheduledFor, now: now, locale: locale, timeZone: timeZone)
      if problem.isEmpty { continue }
      let name = nameOf(row)
      let message =
        SelfDestruct.scheduledRowDeadlineStatus(row, move.scheduledFor, timeZone: timeZone) == "tooLate"
        ? "\(name) has a delete time more than 30 days after the slot this order would give it, so the order wasn’t changed. Edit the post to pick an earlier delete time or a length, then try again."
        : "\(name) has a delete time this order would move it past, so the order wasn’t changed. Edit the post to pick a later delete time or a length, then try again."
      return QueueTimerConflict(id: move.id, message: message, problem: problem)
    }
    return nil
  }

  public static func queueTimerConflict(
    _ rows: [JSONValue]?, _ assignment: [QueueAssignment], now: Double, locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> QueueTimerConflict? {
    queueTimerConflict(rows, json(assignment), now: now, locale: locale, timeZone: timeZone)
  }

  /// Everything a drag needs, from the list and the new order of this app's
  /// rows: `{ assignment, moves, conflict }`. One `now` for the whole
  /// operation, since slots computed twice against different clocks can
  /// shift every row by one. `orderedIds` are the movable rows' ids in
  /// their new order (matched as a Map matches keys: 1 and '1' differ). A
  /// schedule the slot walk can't read throws its error.
  public static func planQueueReorder(
    _ schedule: JSONValue?, _ rows: [JSONValue]?, _ orderedIds: [JSONValue]?, now: Double,
    locale: String? = nil, timeZone: TimeZone? = nil
  ) throws -> QueueReorderPlan {
    let split = splitQueueRows(rows, now: now, timeZone: timeZone)
    // `new Map(movable.map((r) => [r.id, r]))`: the last row with an id wins.
    func index(of id: JSONValue?) -> Int? {
      split.movable.indices.last { ComposerJS.sameValueZero(split.movable[$0]["id"], id) }
    }
    var ordered = (orderedIds ?? []).compactMap { index(of: $0) }
    // A movable row the new order forgot keeps its place at the end, rather
    // than being left on a minute another row may now be given.
    for i in split.movable.indices where !ordered.contains(i) { ordered.append(i) }
    let assignment = try PostingQueue.recomputeQueueAssignment(
      schedule, ordered.map { split.movable[$0] }, now: now, occupied: split.occupied, localZone: timeZone)
    // queueTimerConflict's `Object.fromEntries(rows.map((r) => [r.id, r]))`.
    if (rows ?? []).contains(where: \.isNull) {
      throw QueueReorderError("Cannot read properties of null (reading 'id')")
    }
    return QueueReorderPlan(
      assignment: assignment,
      moves: pendingMoves(assignment, timeZone: timeZone),
      conflict: queueTimerConflict(rows, assignment, now: now, locale: locale, timeZone: timeZone))
  }

  public static func planQueueReorder(
    _ schedule: JSONValue?, _ rows: [JSONValue]?, _ orderedIds: [String], now: Double, locale: String? = nil,
    timeZone: TimeZone? = nil
  ) throws -> QueueReorderPlan {
    try planQueueReorder(
      schedule, rows, orderedIds.map(JSONValue.string), now: now, locale: locale, timeZone: timeZone)
  }
}
