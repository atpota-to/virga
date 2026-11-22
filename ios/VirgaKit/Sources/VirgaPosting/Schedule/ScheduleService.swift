// Ports src/posting/schedule/scheduleService.js
//
// Scheduled and queued posts, through Virga's server (/api/schedule/*).
//
// A scheduled post is a row on Virga's server until it goes out: the
// server's worker publishes it, as the account, at its time. Nothing about
// it is in the repo before then. The bodies are the server's
// (ScheduleSerialize builds the create one); a queued post is a scheduled
// row with `queued: true` whose time is a slot of the weekly schedule
// (PostingQueue), which the server never sees.
//
// Every call takes the requester of the account the post is scheduled as
// (the web's `backendFor(asDid)`, VirgaNetwork's VirgaBackend): the server
// takes the account from the token, and listing, editing and cancelling all
// act on that account's rows. A call's AbortSignal is the task's
// cancellation. Rows are the server's JSON; a time without an offset is read
// in `timeZone` (the device's; nil for the active one). Each write announces
// virga:scheduled-changed on `target` (the app's bus by default).

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// One account's requester on Virga's server: the web's
/// `req.request(path, { method, query, body, signal, timeoutMs })`, answering
/// the parsed body or throwing the server's refusal (a BackendError, with
/// its status, code, detail and payload). VirgaBackend is one.
public protocol ScheduleRequester: Sendable {
  /// The account the requester acts as (`req.did`).
  var did: String? { get }
  func request(_ path: String, method: String, query: QueryParams?, body: JSONValue?, timeoutMs: Double)
    async throws -> JSONValue
}

extension VirgaBackend: ScheduleRequester {}

/// A refusal of the service's own: NEEDS_BACKEND (status 0).
public struct ScheduleServiceError: Error, LocalizedError, ScheduleErrorObject, JSErrorConvertible, Hashable, Sendable {
  public var code: String
  public var message: String
  public var status: Int

  public init(code: String, message: String, status: Int = 0) {
    self.code = code
    self.message = message
    self.status = status
  }

  public var errorDescription: String? { message }
  public var errorObject: JSONValue {
    ["name": "Error", "message": .string(message), "code": .string(code), "status": .number(Double(status))]
  }
  public var jsFields: JSErrorFields {
    JSErrorFields(message: message, code: .string(code), status: status)
  }
}

/// listScheduled's answer.
public struct ScheduledList: Hashable, Sendable {
  /// Everything waiting, going out or failed: every count, cap and slot
  /// calculation uses these.
  public var rows: [JSONValue]
  /// The published rows whose timer couldn't be set.
  public var timerNotes: [JSONValue]
  /// The server says scheduling isn't set up there.
  public var unavailable: Bool

  public var json: JSONValue {
    var out: JSONValue = ["rows": .array(rows), "timerNotes": .array(timerNotes)]
    if unavailable { out["unavailable"] = true }
    return out
  }
}

/// skipScheduled's answer: the row now waiting, or `ended` when the one
/// skipped was the last.
public struct SkippedOccurrence: Hashable, Sendable {
  public var next: JSONValue
  public var ended: Bool

  public var json: JSONValue { ["next": next, "ended": .bool(ended)] }
}

/// reorderScheduled's answer.
public struct ReorderResult: Sendable {
  public struct Failure: Sendable {
    public var id: JSONValue
    public var error: any Error
  }

  public var moved: Double
  /// Whether it moved the rows one at a time.
  public var fallback: Bool
  public var failed: [Failure]
  /// The first refusal (an error with a code or a detail), for the page.
  public var refusal: (any Error)?

  public var json: JSONValue {
    [
      "moved": .number(moved), "fallback": .bool(fallback),
      "failed": .array(failed.map { ["id": $0.id, "error": ScheduledPostError.errorObject($0.error)] }),
      "refusal": refusal.map(ScheduledPostError.errorObject) ?? .null,
    ]
  }
}

public enum ScheduleService {
  static let base = "/api/schedule"

  /// The server's flat cap on pending scheduled rows per account, for everyone.
  public static let maxPendingScheduled = 50

  /// Most moves the server takes in one reorder.
  public static let maxReorderMoves = 50

  /// The limits /api/limits/status reports that posting reads.
  public static let limitFeatures = ["scheduledPosts", "postTimers", "conditionalTimers"]

  static func needsBackend() -> ScheduleServiceError {
    ScheduleServiceError(code: "NEEDS_BACKEND", message: "Scheduling needs this account signed in through Virga’s server.")
  }

  static func checkRequester(_ req: (any ScheduleRequester)?) throws -> any ScheduleRequester {
    guard let req else { throw needsBackend() }
    return req
  }

  /// An instant as ISO-Z (the server renders times as `+00:00`), else the
  /// input (nil stays absent).
  static func toIso(_ value: JSONValue?, _ zone: TimeZone?) -> JSONValue? {
    let ms = ScheduleJS.instant(value, zone)
    return ms.isFinite ? JSDate.toISOString(ms).map(JSONValue.string) : value
  }

  static func normalizeRow(_ row: JSONValue?, _ zone: TimeZone?) -> JSONValue {
    guard let row, case .object(var members) = row else { return row ?? .null }
    members["scheduledFor"] = toIso(members["scheduledFor"], zone)
    return .object(members)
  }

  static func announce(_ req: any ScheduleRequester, _ detail: [String: JSONValue], _ target: PostingEventBus?) {
    guard let did = req.did, !did.isEmpty else { return }
    var full = detail
    full["did"] = .string(did)
    // A listener's mistake must not turn a saved post into a failed save.
    _ = try? PostingEvents.emitPostingEvent(PostingEvents.scheduledChangedEvent, .object(full), target: target)
  }

  // MARK: Reading rows

  /// Rows that count toward "scheduled at a time": pending or going out.
  public static func isActiveScheduledRow(_ row: JSONValue?) -> Bool {
    row?["status"] == "pending" || row?["status"] == "publishing"
  }

  /// How many of `rows` count toward the scheduled-at-a-time limit.
  public static func countActiveScheduled(_ rows: [JSONValue]? = []) -> Int {
    (rows ?? []).filter(isActiveScheduledRow).count
  }

  /// Whether a listed row is a published post carrying the "its timer
  /// couldn't be set" note: the only published row the list returns. Not
  /// part of the queue, and never counted.
  public static func isTimerNoteRow(_ row: JSONValue?) -> Bool {
    row?["status"] == "published"
      && (row?["lastErrorCode"] == "TIMER_NOT_ARMED" || row?["last_error_code"] == "TIMER_NOT_ARMED")
  }

  /// The app a row belongs to. Virga's server holds only Virga's rows and
  /// says so (`clientKey: 'virga'`); a row that doesn't say is Virga's too.
  public static func rowClientKey(_ row: JSONValue?) -> String {
    if let key = row?["clientKey"]?.stringValue, !key.isEmpty { return key }
    return "virga"
  }

  /// Whether a row may be opened in the composer and saved back: not
  /// part-way out, and still waiting (or failed, which a full edit revives).
  public static func canEditScheduledRow(_ row: JSONValue?) -> Bool {
    !ComposerJS.truthy(row?["partial"]) && (row?["status"] == "pending" || row?["status"] == "failed")
  }

  /// Whether a row may be cancelled (or, once failed, dismissed).
  public static func canCancelScheduledRow(_ row: JSONValue?) -> Bool {
    row?["status"] == "pending" || row?["status"] == "failed"
  }

  /// Whether a row is the waiting occurrence of a repeating post.
  public static func isRepeatingRow(_ row: JSONValue?) -> Bool {
    ComposerJS.truthy(row?["payload"]?["repeat"]?["every"])
  }

  // MARK: Calls

  /// The account's scheduled posts: `rows` is everything waiting, going out
  /// or failed, `timerNotes` the published rows whose timer couldn't be
  /// set. `unavailable` is the server saying scheduling isn't set up there.
  public static func listScheduled(_ req: (any ScheduleRequester)?, timeZone: TimeZone? = nil) async throws
    -> ScheduledList
  {
    let req = try checkRequester(req)
    let body: JSONValue
    do {
      body = try await req.request("\(base)/list", method: "GET", query: nil, body: nil, timeoutMs: 30_000)
    } catch {
      if ScheduledPostError.errorObject(error)["code"] == "UNAVAILABLE" {
        return ScheduledList(rows: [], timerNotes: [], unavailable: true)
      }
      throw error
    }
    let all = (body["data"]?.arrayValue ?? []).map { normalizeRow($0, timeZone) }
    return ScheduledList(
      rows: all.filter { $0["status"] != "published" },
      timerNotes: all.filter(isTimerNoteRow),
      unavailable: body["unavailable"] == .bool(true))
  }

  /// One row (no `partial` flag; the list has that).
  public static func getScheduled(_ req: (any ScheduleRequester)?, _ id: JSONValue?, timeZone: TimeZone? = nil)
    async throws -> JSONValue
  {
    let req = try checkRequester(req)
    let body = try await req.request("\(base)/get", method: "GET", query: QueryParams([("id", id)]), body: nil, timeoutMs: 30_000)
    return normalizeRow(ComposerJS.coalesce(body["data"], nil), timeZone)
  }

  /// A row's stored images as `{ [mediaId]: { base64, encoding } }`, for
  /// editing. An image the server can no longer read is left out (its
  /// media was swept, or never arrived), so the caller sees what is there.
  public static func getScheduledMedia(_ req: (any ScheduleRequester)?, _ id: JSONValue?) async throws -> JSONValue {
    let req = try checkRequester(req)
    let body = try await req.request("\(base)/media", method: "GET", query: QueryParams([("id", id)]), body: nil, timeoutMs: 60_000)
    let data = body["data"]
    switch data {
    case .object?, .array?: return data!
    default: return [:]
    }
  }

  /// Schedule a post or thread. `body` is ScheduleSerialize's. Answers the
  /// server's row. QUOTA_EXCEEDED (with `payload.feature`) and RATE_LIMITED
  /// arrive as thrown errors.
  public static func createScheduled(
    _ req: (any ScheduleRequester)?, _ body: JSONValue, target: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) async throws -> JSONValue {
    let req = try checkRequester(req)
    // The body carries every image as base64.
    let res = try await req.request("\(base)/create", method: "POST", query: nil, body: body, timeoutMs: 60_000)
    let row = normalizeRow(ComposerJS.coalesce(res["data"], nil), timeZone)
    announce(req, ["change": "created", "id": ComposerJS.coalesce(row["id"], nil) ?? .null], target)
    return row
  }

  /// Change a scheduled row. `patch` is one of the server's six shapes:
  ///   `{ scheduledFor }`        move it (time only)
  ///   the same body as create   rewrite it (every image again)
  ///   `{ retry: true }`         send a failed row again as it is
  ///   `{ acknowledgeTimer: true }`  clear a "timer couldn't be set" note
  ///   `{ skip: true }`          skip a repeating post's waiting occurrence
  ///   `{ stopRepeat: true }`    stop a post repeating
  /// Answers the server's row (for a skip, the occurrence that took its
  /// place, or null when it was the last).
  public static func updateScheduled(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, _ patch: JSONValue? = [:], target: PostingEventBus? = .shared,
    timeZone: TimeZone? = nil
  ) async throws -> JSONValue {
    let req = try checkRequester(req)
    var body = ComposerJS.spread(patch ?? [:])
    body["id"] = id
    if body.keys.contains("scheduledFor") { body["scheduledFor"] = toIso(body["scheduledFor"], timeZone) }
    let content = ComposerJS.truthy(patch?["payload"])
    let res = try await req.request(
      "\(base)/update", method: "POST", query: nil, body: .object(body), timeoutMs: content ? 60_000 : 30_000)
    let row = normalizeRow(ComposerJS.coalesce(res["data"], nil), timeZone)
    let change: String =
      ComposerJS.truthy(patch?["retry"])
      ? "retried"
      : ComposerJS.truthy(patch?["acknowledgeTimer"])
        ? "acknowledged"
        : ComposerJS.truthy(patch?["skip"])
          ? "skipped" : ComposerJS.truthy(patch?["stopRepeat"]) ? "stopped" : content ? "edited" : "moved"
    var detail: [String: JSONValue] = ["change": .string(change)]
    detail["id"] = id
    announce(req, detail, target)
    return row
  }

  /// Skip the waiting occurrence of a repeating post: it doesn't go out,
  /// and the next one takes its place. 409 NOT_SKIPPABLE: it isn't
  /// repeating, or is already going out.
  public static func skipScheduled(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, target: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) async throws -> SkippedOccurrence {
    let next = try await updateScheduled(req, id, ["skip": true], target: target, timeZone: timeZone)
    return SkippedOccurrence(next: next.isTruthy ? next : .null, ended: !next.isTruthy)
  }

  /// Stop a post repeating: the waiting occurrence still goes out at its
  /// time, and nothing follows it. Answers the row. 409 NOT_REPEATING.
  public static func stopRepeating(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, target: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) async throws -> JSONValue {
    try await updateScheduled(req, id, ["stopRepeat": true], target: target, timeZone: timeZone)
  }

  public static func retryScheduled(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, target: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) async throws -> JSONValue {
    try await updateScheduled(req, id, ["retry": true], target: target, timeZone: timeZone)
  }

  public static func acknowledgeTimerNote(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, target: PostingEventBus? = .shared, timeZone: TimeZone? = nil
  ) async throws -> JSONValue {
    try await updateScheduled(req, id, ["acknowledgeTimer": true], target: target, timeZone: timeZone)
  }

  /// Whether a reorder failure means this server has no reorder endpoint
  /// (or too many moves for it), so the caller should move rows one at a
  /// time. Real refusals are 409/400 with a code.
  public static func isReorderUnsupported(_ err: JSONValue?) -> Bool {
    guard let err, err.isTruthy else { return false }
    let status = err["status"]
    return err["reorderUnsupported"] == .bool(true) || ComposerJS.strictEquals(status, .number(404))
      || ComposerJS.strictEquals(status, .number(405))
  }

  public static func isReorderUnsupported(_ error: (any Error)?) -> Bool {
    guard let error else { return false }
    return isReorderUnsupported(ScheduledPostError.errorObject(error))
  }

  /// Move queued posts to new slots, all at once (row-at-a-time writes can
  /// stop half way and leave two posts sharing a minute). The server
  /// refuses the lot (409 NOT_REORDERABLE, or DELETE_TIME_TOO_EARLY naming
  /// one) when any row isn't movable; that throws, and nothing was written.
  ///
  /// Where the endpoint is missing (404/405), or the moves are more than it
  /// takes, it falls back to one time-only update per row, carrying on past
  /// refusals: `failed` lists them, with the first refusal kept as
  /// `refusal`, so the page can reload and try again from what was saved.
  /// Once the task is cancelled the rest are failed with CancellationError.
  public static func reorderScheduled(
    _ req: (any ScheduleRequester)?, _ moves: [JSONValue]?, target: PostingEventBus? = .shared,
    timeZone: TimeZone? = nil
  ) async throws -> ReorderResult {
    let req = try checkRequester(req)
    let body: [(id: JSONValue, scheduledFor: JSONValue)] = (moves ?? []).compactMap { m in
      guard m.isTruthy, let id = m["id"], id.isTruthy, let at = m["scheduledFor"], at.isTruthy else { return nil }
      return (id, toIso(at, timeZone) ?? .null)
    }
    if body.isEmpty { return ReorderResult(moved: 0, fallback: false, failed: [], refusal: nil) }
    func json(_ move: (id: JSONValue, scheduledFor: JSONValue)) -> JSONValue {
      ["id": move.id, "scheduledFor": move.scheduledFor]
    }
    if body.count <= maxReorderMoves {
      do {
        let res = try await req.request(
          "\(base)/reorder", method: "POST", query: nil, body: ["moves": .array(body.map(json))], timeoutMs: 30_000)
        let moved: Double = {
          if case .number(let n)? = res["moved"], n.isFinite { return n }
          return Double(body.count)
        }()
        announce(req, ["change": "reordered", "ids": .array(body.map(\.id))], target)
        return ReorderResult(moved: moved, fallback: false, failed: [], refusal: nil)
      } catch {
        if !isReorderUnsupported(error) { throw error }
      }
    }

    var failed: [ReorderResult.Failure] = []
    var refusal: (any Error)?
    for move in body {
      if Task.isCancelled {
        failed.append(.init(id: move.id, error: CancellationError()))
        continue
      }
      do {
        _ = try await req.request("\(base)/update", method: "POST", query: nil, body: json(move), timeoutMs: 30_000)
      } catch {
        failed.append(.init(id: move.id, error: error))
        let object = ScheduledPostError.errorObject(error)
        if refusal == nil && (ComposerJS.truthy(object["code"]) || ComposerJS.truthy(object["detail"])) {
          refusal = error
        }
      }
    }
    let moved = body.count - failed.count
    if moved > 0 {
      let ids = body.filter { m in !failed.contains { ComposerJS.strictEquals($0.id, m.id) } }.map(\.id)
      announce(req, ["change": "reordered", "ids": .array(ids)], target)
    }
    return ReorderResult(moved: Double(moved), fallback: true, failed: failed, refusal: refusal)
  }

  public static func reorderScheduled(
    _ req: (any ScheduleRequester)?, _ moves: [QueueMove], target: PostingEventBus? = .shared,
    timeZone: TimeZone? = nil
  ) async throws -> ReorderResult {
    try await reorderScheduled(req, moves.map(\.json), target: target, timeZone: timeZone)
  }

  /// Cancel a scheduled post (or dismiss a failed one). Allowed for another
  /// client's row too. 409 NOT_CANCELLABLE: it is already going out, or gone.
  public static func cancelScheduled(
    _ req: (any ScheduleRequester)?, _ id: JSONValue?, target: PostingEventBus? = .shared
  ) async throws -> JSONValue {
    let req = try checkRequester(req)
    var body: [String: JSONValue] = [:]
    body["id"] = id
    let res = try await req.request("\(base)/cancel", method: "POST", query: nil, body: .object(body), timeoutMs: 30_000)
    var detail: [String: JSONValue] = ["change": "cancelled"]
    detail["id"] = id
    announce(req, detail, target)
    return ComposerJS.coalesce(res["data"], nil) ?? .null
  }

  // MARK: Limits

  /// /api/limits/status in one shape: per feature, `limit` (null for no
  /// limit but the flat caps) and `usage` (null where the server didn't
  /// count it), plus the policy it applied (`'flat'`: the same limits for
  /// every account): `{ policy, isMember, features, usage, caps:
  /// { scheduledPosts, timers } }`.
  public static func normalizeLimits(_ body: JSONValue?) -> JSONValue {
    func finite(_ value: JSONValue?) -> Double? {
      if case .number(let n)? = value, n.isFinite { return n }
      return nil
    }
    var features: [String: JSONValue] = [:]
    var usage: [String: JSONValue] = [:]
    for key in limitFeatures {
      let f = body?["features"]?[key]
      let limit = ComposerJS.truthy(f) && f?["isUnlimited"] != .bool(true) ? finite(f?["limit"]) : nil
      features[key] = ["limit": limit.map(JSONValue.number) ?? .null]
      usage[key] = finite(body?["usage"]?[key]).map(JSONValue.number) ?? .null
    }
    // The flat ceilings everyone has (the server reports them beside the policy).
    func cap(_ value: JSONValue?) -> JSONValue {
      guard let n = finite(value), n > 0 else { return .null }
      return .number(n)
    }
    return [
      "policy": body?["policy"]?.stringValue.map(JSONValue.string) ?? .null,
      "isMember": .bool(body?["isMember"] == .bool(true)),
      "features": .object(features),
      "usage": .object(usage),
      "caps": ["scheduledPosts": cap(body?["caps"]?["scheduledPosts"]), "timers": cap(body?["caps"]?["timers"])],
    ]
  }

  /// The account's limits and what it has in use (normalizeLimits).
  public static func getLimits(_ req: (any ScheduleRequester)?) async throws -> JSONValue {
    let req = try checkRequester(req)
    return normalizeLimits(try await req.request("/api/limits/status", method: "GET", query: nil, body: nil, timeoutMs: 30_000))
  }

  /// Why one more post can't be scheduled under the account's limits, or ''
  /// when it can (or when nothing is known: the server decides). Editing an
  /// existing row doesn't take another slot.
  public static func scheduledRoomProblem(_ limits: JSONValue?, editing: Bool = false) -> String {
    guard !editing, let limits, limits.isTruthy else { return "" }
    guard case .number(let limit)? = limits["features"]?["scheduledPosts"]?["limit"], limit.isFinite,
      case .number(let used)? = limits["usage"]?["scheduledPosts"], used.isFinite
    else { return "" }
    if used < limit { return "" }
    return ScheduledPostError.quotaMessage(["feature": "scheduledPosts", "limit": .number(limit)])
  }

  /// "2 of 3 scheduled posts in use" for a limit the server reports, or ''
  /// when there is no limit or no count.
  public static func scheduledUsageLine(_ limits: JSONValue?) -> String {
    guard case .number(let limit)? = limits?["features"]?["scheduledPosts"]?["limit"], limit.isFinite,
      case .number(let used)? = limits?["usage"]?["scheduledPosts"], used.isFinite
    else { return "" }
    return
      "\(JSNumber.format(Swift.min(used, limit))) of \(JSNumber.format(limit)) scheduled \(limit == 1 ? "post" : "posts") in use"
  }
}
