// Ports src/posting/timers/timerService.js
//
// Timers on published posts, through Virga's server (/api/self-destruct/*).
//
// A timer is a row on Virga's server, not a record in the repo, because it
// has to act while the app is closed: when it comes due, the server reads
// the post's public counts and deletes it, limits its replies or turns off
// its quotes (the rule model is SelfDestruct; this file is the transport).
//
// Every call takes the requester of the account the post was written as
// (the web's `backendFor(<DID in the post URI>)`): the server takes the
// acting account from the token and refuses a post outside that repo, and a
// timer sent with another account's token would be refused or, worse, look
// like that account's.
//
// Everything but the HTTP call is here: the request bodies, reading the
// server's answers, the error classes, the retry-then-look confirmation of
// a lost answer, the page's availability state and the
// virga:timers-changed events. The call itself goes through
// `TimerRequester`, the seam for VirgaNetwork's VirgaBackend (`req.request`
// on the web): server calls wired to VirgaBackend in wave 2 (composer
// chain).

import Foundation
import VirgaCore

// MARK: - The seam

/// One call to Virga's server, as the web's `req.request(path, { method,
/// query, body })` makes it. `method` nil is a GET.
public struct TimerRequest: Codable, Hashable, Sendable {
  public var path: String
  public var method: String?
  public var query: [String: String]?
  public var body: JSONValue?

  public init(path: String, method: String? = nil, query: [String: String]? = nil, body: JSONValue? = nil) {
    self.path = path
    self.method = method
    self.query = query
    self.body = body
  }
}

/// The requester of one account on Virga's server (the web's
/// `backendFor(did)`): VirgaBackend conforms in wave 2. `request` answers
/// the response body as JSON, or throws the server's refusal (ideally as a
/// `TimerErrorConvertible` error carrying its status, code and payload).
public protocol TimerRequester: Sendable {
  /// The account the requester acts as (`req.did`), when known.
  var did: String? { get }
  func request(_ request: TimerRequest) async throws -> JSONValue?
}

// MARK: - Errors

/// A failure as the timer service reads it: the web's coded errors
/// (`Object.assign(new Error(message), { code, ... })`) and the backend
/// client's request errors (`{ status, code, payload }`, status 0 for no
/// answer). `name` is JavaScript's error name where it matters
/// ('TimeoutError', 'AbortError', 'TypeError').
public struct TimerServiceError: Error, LocalizedError, Codable, Hashable, Sendable {
  public var code: String?
  public var message: String
  public var status: Int?
  public var name: String?
  public var payload: JSONValue?

  public init(code: String? = nil, message: String, status: Int? = nil, name: String? = nil, payload: JSONValue? = nil) {
    self.code = code
    self.message = message
    self.status = status
    self.name = name
    self.payload = payload
  }

  public var errorDescription: String? { message }

  /// Any error as the service reads it: one of these as it is, a
  /// `TimerErrorConvertible` as it says, a cancelled task as an
  /// 'AbortError' (the web's aborted signal), anything else by its message.
  public init(_ error: Error) {
    if let same = error as? TimerServiceError {
      self = same
    } else if let convertible = error as? TimerErrorConvertible {
      self = convertible.timerServiceError
    } else if error is CancellationError {
      self.init(message: "This operation was aborted", name: "AbortError")
    } else {
      self.init(message: (error as? LocalizedError)?.errorDescription ?? "\(error)", name: "Error")
    }
  }
}

/// An error that knows how the timer service should read it (VirgaBackend's
/// request error, in wave 2).
public protocol TimerErrorConvertible: Error {
  var timerServiceError: TimerServiceError { get }
}

// MARK: - Results

/// listTimers' answer: the rows, and whether the server said it can't hold
/// timers at all (not "nothing is counting down").
public struct TimerList: Codable, Hashable, Sendable {
  public var rows: [JSONValue]
  public var unavailable: Bool
}

/// The create body (timerBody). Absent members are left out, as
/// JSON.stringify drops `undefined`.
public struct TimerCreateBody: Codable, Hashable, Sendable {
  public var postUri: String
  public var postCid: String?
  public var extraUris: [String]
  public var snippet: String?
  public var postedAt: String?
  public var lifespanSeconds: Int
  public var conditions: TimerConditions
  public var effects: [TimerEffect]
  public var deleteAt: String?

  public var json: JSONValue {
    var out: [String: JSONValue] = [
      "postUri": .string(postUri),
      "extraUris": .array(extraUris.map(JSONValue.string)),
      "lifespanSeconds": .number(Double(lifespanSeconds)),
      "conditions": conditions.json,
      "effects": .array(effects.map(\.json)),
    ]
    if let postCid { out["postCid"] = .string(postCid) }
    if let snippet { out["snippet"] = .string(snippet) }
    if let postedAt { out["postedAt"] = .string(postedAt) }
    if let deleteAt { out["deleteAt"] = .string(deleteAt) }
    return .object(out)
  }
}

/// What became of an arm whose answer never arrived
/// (confirmArmAfterUnknown): 'armed', 'failed' or 'unconfirmed'.
public struct ArmConfirmation: Hashable, Sendable {
  public var status: String
  public var row: JSONValue?
  public var error: TimerServiceError?
}

/// createTimer's answer: 'armed' (`row` is the server's), 'failed'
/// (`error`), 'confirming' (`confirmation` resolves to what became of a lost
/// answer) or 'none' (the fitted rule is off).
public struct CreateTimerOutcome: Sendable {
  public var status: String
  public var row: JSONValue?
  public var error: TimerServiceError?
  public var adjusted: String?
  public var confirmation: Task<ArmConfirmation, Never>?
}

/// armAfterPublish's answer: 'armed', 'failed', 'unconfirmed' or 'none',
/// with `note` for the "Posted" message when the timer was moved to the
/// five-minute floor.
public struct ArmOutcome: Hashable, Sendable {
  public var status: String
  public var row: JSONValue?
  public var error: TimerServiceError?
  public var adjusted: String?
  public var note: String
}

// MARK: - Page state

/// Whether this server can hold a timer at all, as last heard (the web's
/// module-level `availability`, `probed` and `probing`). Asked once per
/// launch (it only changes with a deploy); any list or arm answer settles it
/// too. Only the server's explicit word hides the feature (`unavailable:
/// true` from the list, or UNAVAILABLE), never a 404 from a deploy that
/// hasn't caught up. 'unknown' still offers timers.
public final class TimerAvailabilityState: Sendable {
  public static let shared = TimerAvailabilityState()

  struct State {
    var availability = "unknown"
    var probed = false
    var probing: Task<String, Never>?
  }

  let state = Locked(State())

  public init() {}

  func settle(_ availability: String) {
    state.withLock {
      $0.availability = availability
      $0.probed = true
    }
  }
}

/// Where the service keeps its state and tells the page: the availability
/// state and the event bus (the web's window). `.shared` is the app's.
public struct TimerServiceContext: Sendable {
  public var availability: TimerAvailabilityState
  public var events: PostingEventBus?

  public init(availability: TimerAvailabilityState = .shared, events: PostingEventBus? = .shared) {
    self.availability = availability
    self.events = events
  }

  public static let shared = TimerServiceContext()
}

// MARK: - The service

public enum TimerService {
  static let base = "/api/self-destruct"

  /// The server keeps at most this much of a post's text beside its timer.
  public static let timerSnippetMax = 200

  /// The server arms a thread of at most this many posts besides the root.
  public static let maxExtraUris = 100

  static func codedError(_ code: String, _ message: String) -> TimerServiceError {
    TimerServiceError(code: code, message: message, name: "Error")
  }

  /// The account a post URI belongs to (`at://<did>/…`), or nil.
  public static func timerDidForUri(_ uri: String?) -> String? {
    guard let uri, PostingJS.hasPrefix(uri, "at://") else { return nil }
    // `uri.slice(5).split('/')[0]`, by code unit.
    let rest = uri.jsSlice(5)
    let slash = rest.jsIndexOf("/")
    let did = slash < 0 ? rest : rest.jsSlice(0, slash)
    return PostingJS.hasPrefix(did, "did:") ? did : nil
  }

  public static func timerDidForUri(_ uri: JSONValue?) -> String? {
    timerDidForUri(uri?.stringValue)
  }

  /// A line of the post for the timer list: one space between words, ≤200
  /// code units with an ellipsis; nil for nothing.
  public static func timerSnippet(_ text: JSONValue?) -> String? {
    let raw = text.flatMap { $0.isTruthy ? $0.jsString : nil } ?? ""
    var flat = ""
    var inSpace = false
    for scalar in raw.unicodeScalars {
      if JSWhitespace.contains(scalar) {
        if !inSpace { flat.unicodeScalars.append(" ") }
        inSpace = true
      } else {
        flat.unicodeScalars.append(scalar)
        inSpace = false
      }
    }
    flat = flat.jsTrimmed()
    if flat.isEmpty { return nil }
    return flat.jsLength > timerSnippetMax ? "\(flat.jsSlice(0, timerSnippetMax - 1).jsTrimmingEnd())…" : flat
  }

  public static func timerSnippet(_ text: String?) -> String? {
    timerSnippet(text.map(JSONValue.string))
  }

  static func needsBackend() -> TimerServiceError {
    codedError("NEEDS_BACKEND", "Timers need this account signed in through Virga’s server.")
  }

  static func checkRequester(_ req: (any TimerRequester)?, _ uri: String?) -> TimerServiceError? {
    guard let req else { return needsBackend() }
    guard let did = timerDidForUri(uri) else {
      return codedError("BAD_POST", "This post couldn’t be read, so its timer couldn’t be set.")
    }
    if let mine = req.did, !mine.isEmpty, !mine.jsEquals(did) {
      return codedError("WRONG_ACCOUNT", "A timer has to be set as the account that wrote the post.")
    }
    return nil
  }

  // MARK: Outcomes

  /// Whether the server said plainly that timers aren't on here (`code:
  /// 'UNAVAILABLE'`, its migrations not applied). The only failure that may
  /// hide the feature for the session.
  public static func isTimersUnavailableError(_ err: Error?) -> Bool {
    guard let err else { return false }
    return TimerServiceError(err).code.jsEquals("UNAVAILABLE")
  }

  /// Whether a failure means this server has no timer endpoints at all: a
  /// missing route (404, or 405 where the path exists for other methods),
  /// or UNAVAILABLE. Real refusals are 400/402/409 with a code.
  public static func isTimersUnsupported(_ err: Error?) -> Bool {
    guard let err else { return false }
    let e = TimerServiceError(err)
    return e.status == 404 || e.status == 405 || e.code.jsEquals("UNAVAILABLE")
  }

  /// Whether a failed arm may still have armed: the request timed out, the
  /// connection dropped, or a gateway gave up (408/502/504), so the server
  /// may have written the timer before the answer was lost. A status of the
  /// server's own (400, 409, 503 UNAVAILABLE) is an answer; so is a request
  /// never sent.
  public static func isArmOutcomeUnknown(_ err: Error?) -> Bool {
    guard let err, !isTimersUnsupported(err) else { return false }
    let e = TimerServiceError(err)
    // By code unit: Swift's == would take a Kelvin sign for the K.
    if e.code.jsEquals("TIMEOUT") || e.code.jsEquals("NETWORK_ERROR") { return true }
    if let status = e.status, status > 0 { return status == 408 || status == 502 || status == 504 }
    if let code = e.code, !code.isEmpty { return false }
    let name = e.name ?? ""
    if name.jsEquals("TimeoutError") || name.jsEquals("AbortError") || name.jsEquals("TypeError") { return true }
    return lostAnswerMessage(e.message)
  }

  /// `/timed out|timeout|failed to fetch|load failed|network|connection/i`:
  /// ASCII letters fold, nothing else does.
  static func lostAnswerMessage(_ message: String) -> Bool {
    var folded = String.UnicodeScalarView()
    for scalar in message.unicodeScalars {
      if scalar.value >= 0x41 && scalar.value <= 0x5A {
        folded.append(Unicode.Scalar(scalar.value + 0x20)!)
      } else {
        folded.append(scalar)
      }
    }
    let text = String(folded)
    return ["timed out", "timeout", "failed to fetch", "load failed", "network", "connection"].contains {
      text.jsIndexOf($0) >= 0
    }
  }

  /// Whether a refusal definitely means the timer was not armed: a 4xx
  /// about the request itself, or the feature being off. Not 408/429 (try
  /// later) or 401/403 (the token, not the timer): after those an earlier
  /// attempt may still have landed.
  public static func isDefiniteArmRefusal(_ err: Error?) -> Bool {
    guard let err else { return false }
    if isTimersUnavailableError(err) { return true }
    guard let status = TimerServiceError(err).status else { return false }
    return status >= 400 && status < 500 && ![401, 403, 408, 429].contains(status)
  }

  /// Timers still counting down (or mid-check).
  public static func isLiveTimer(_ row: JSONValue?) -> Bool {
    SelfDestruct.isLive(row)
  }

  public static func countLiveTimers(_ rows: [JSONValue]?) -> Int {
    (rows ?? []).filter(isLiveTimer).count
  }

  /// The post's page on bsky.app, or nil once it's gone (or isn't a post).
  public static func timerPostUrl(_ row: JSONValue?) -> String? {
    guard let uri = row?["postUri"], uri.isTruthy, row?["status"] != .string("deleted") else { return nil }
    guard let text = uri.stringValue, PostLink.parseRecordUri(text)?.kind == "post" else { return nil }
    return PostLink.bskyUrlFor(text)
  }

  // MARK: Availability

  /// 'available' | 'unavailable' | 'unknown', as last heard.
  public static func timerAvailability(_ context: TimerServiceContext = .shared) -> String {
    context.availability.state.wrappedValue.availability
  }

  /// Ask once whether timers can be armed here. Answers the state; never
  /// throws. A failed probe counts as asked (leaving 'unknown') so a dead
  /// network isn't asked again on every composer open; with no requester
  /// it isn't asked at all. Callers at the same time share one request.
  public static func probeTimerAvailability(
    _ req: (any TimerRequester)?, context: TimerServiceContext = .shared
  ) async -> String {
    let state = context.availability
    let task: Task<String, Never>? = state.state.withLock { s in
      if s.probed || req == nil { return nil }
      if let probing = s.probing { return probing }
      let probing = Task<String, Never> {
        let answer: String
        do {
          _ = try await listTimers(req, context: context)
          answer = state.state.wrappedValue.availability
        } catch {
          answer = state.state.withLock {
            $0.probed = true
            return $0.availability
          }
        }
        state.state.withLock { $0.probing = nil }
        return answer
      }
      s.probing = probing
      return probing
    }
    guard let task else { return state.state.wrappedValue.availability }
    return await task.value
  }

  /// When `err` is the server's explicit UNAVAILABLE, stop offering timers.
  /// Anything else changes nothing. Answers whether it did.
  @discardableResult
  public static func markTimersUnavailable(_ err: Error?, context: TimerServiceContext = .shared) -> Bool {
    guard isTimersUnavailableError(err) else { return false }
    context.availability.settle("unavailable")
    return true
  }

  /// Forget what was heard (tests, and a sign-in to another server).
  public static func resetTimerAvailability(_ context: TimerServiceContext = .shared) {
    context.availability.state.withLock {
      $0.availability = "unknown"
      $0.probed = false
      $0.probing = nil
    }
  }

  // MARK: Reads

  /// The account's timers, and whether this server can hold one. By
  /// default: live ones, ones that gave up, and rules that acted without
  /// deleting in the last week; `history` returns everything settled
  /// instead.
  ///
  /// `unavailable` (the server's migrations aren't applied) is not "nothing
  /// is counting down". A real failure throws.
  public static func listTimers(
    _ req: (any TimerRequester)?, history: Bool = false, context: TimerServiceContext = .shared
  ) async throws -> TimerList {
    guard let req else { throw needsBackend() }
    do {
      let body = try await req.request(
        TimerRequest(path: "\(base)/list", query: history ? ["history": "1"] : nil))
      let unavailable = body?["unavailable"] == .bool(true)
      context.availability.settle(unavailable ? "unavailable" : "available")
      return TimerList(rows: body?["data"]?.arrayValue ?? [], unavailable: unavailable)
    } catch {
      if isTimersUnavailableError(error) {
        context.availability.settle("unavailable")
        return TimerList(rows: [], unavailable: true)
      }
      throw error
    }
  }

  /// Timer slots in use per bucket (SelfDestruct.timerUsage): live timers
  /// plus scheduled posts waiting with one, leaving out the row an edit
  /// rewrites. `scheduledRows` is listScheduled's `rows`. Nil when the timer
  /// list can't be read, so the caller lets the server decide.
  public static func loadTimerUsage(
    _ req: (any TimerRequester)?, scheduledRows: [JSONValue]? = [], exceptScheduledId: JSONValue? = nil,
    context: TimerServiceContext = .shared
  ) async -> TimerUsage? {
    do {
      let list = try await listTimers(req, context: context)
      return SelfDestruct.timerUsage(
        liveRows: list.rows, scheduledRows: scheduledRows, exceptScheduledId: exceptScheduledId)
    } catch {
      return nil
    }
  }

  // MARK: Writes

  /// The create body for a timer, or nil when the fitted rule is off.
  /// Effects are always present: the server reads absent effects as delete,
  /// so a rule that only limits replies would otherwise take the post down.
  /// `postedAt` (ISO) is when the post went up; the window runs from there,
  /// or from `now` when it can't be read. Date-times without an offset
  /// (`postedAt`, the rule's pin) are read in `timeZone`.
  public static func timerBody(
    uri: String, cid: String? = nil, extraUris: [String]? = [], snippet: JSONValue? = nil, postedAt: String? = nil,
    rule: some TimerRuleInput, fit: TimerFit = TimerFit(), now: Double, timeZone: TimeZone? = nil
  ) -> TimerCreateBody? {
    let zone = TimerJS.zone(timeZone)
    let startedAt = postedAt.map { VirgaCore.JSDate.parse($0, timeZone: zone) } ?? .nan
    guard
      let spec = TimerJS.inZone(zone, {
        SelfDestruct.toWireSpec(SelfDestruct.fitTimerToPost(rule, fit), startedAt.isFinite ? startedAt : now)
      })
    else { return nil }
    return TimerCreateBody(
      postUri: uri,
      postCid: cid.flatMap { $0.isEmpty ? nil : $0 },
      extraUris: Array((extraUris ?? []).filter { !$0.isEmpty }.prefix(maxExtraUris)),
      snippet: timerSnippet(snippet),
      postedAt: startedAt.isFinite ? VirgaCore.JSDate.toISOString(startedAt) : nil,
      lifespanSeconds: spec.lifespanSeconds,
      conditions: spec.conditions,
      effects: spec.effects,
      // Only when the writer pinned a time instead of a length.
      deleteAt: spec.deleteAt)
  }

  static func sendCreate(_ req: any TimerRequester, _ body: TimerCreateBody) async throws -> JSONValue? {
    let res = try await req.request(TimerRequest(path: "\(base)/create", method: "POST", body: body.json))
    return res?["data"]
  }

  /// Tell the page (virga:timers-changed). A listener's mistake, or a
  /// detail without an account, must never turn an armed timer into a
  /// failed one.
  static func announce(_ did: String?, _ detail: [String: JSONValue], _ context: TimerServiceContext) {
    var full = detail
    full["did"] = did.map(JSONValue.string)
    _ = try? PostingEvents.emitPostingEvent(PostingEvents.timersChangedEvent, .object(full), target: context.events)
  }

  /// `req.did || timerDidForUri(uri)`.
  static func accountOf(_ req: any TimerRequester, _ uri: String?) -> String? {
    if let did = req.did, !did.isEmpty { return did }
    return timerDidForUri(uri)
  }

  /// `row?.id ?? null`.
  static func idOf(_ row: JSONValue?) -> JSONValue {
    row?["id"] ?? .null
  }

  /// What became of an arm whose answer never arrived. Never throws.
  ///
  /// Retries once (create is idempotent per live post, so a landed first
  /// attempt answers with its timer), then looks for the post among the
  /// live timers. Only a definite refusal of the retry, or the post found
  /// counting down, is conclusive: the list holds at most a page of timers,
  /// so not finding the post there is 'unconfirmed', not 'failed'.
  public static func confirmArmAfterUnknown(
    _ req: any TimerRequester, _ body: TimerCreateBody, firstError: TimerServiceError? = nil,
    context: TimerServiceContext = .shared
  ) async -> ArmConfirmation {
    var retryError: TimerServiceError?
    do {
      let row = try await sendCreate(req, body)
      announce(accountOf(req, body.postUri), ["change": "armed", "postUri": .string(body.postUri), "id": idOf(row)], context)
      return ArmConfirmation(status: "armed", row: row, error: nil)
    } catch {
      markTimersUnavailable(error, context: context)
      if isDefiniteArmRefusal(error) { return ArmConfirmation(status: "failed", row: nil, error: TimerServiceError(error)) }
      retryError = TimerServiceError(error)
    }
    do {
      let list = try await listTimers(req, context: context)
      if let found = list.rows.first(where: {
        ($0["postUri"]?.stringValue).jsEquals(body.postUri) && isLiveTimer($0)
      }) {
        announce(
          accountOf(req, body.postUri), ["change": "armed", "postUri": .string(body.postUri), "id": idOf(found)],
          context)
        return ArmConfirmation(status: "armed", row: found, error: nil)
      }
    } catch {
      // No answer from the list either; it may be armed or not.
    }
    return ArmConfirmation(status: "unconfirmed", row: nil, error: retryError ?? firstError)
  }

  /// Put a timer on a post: one request, never throws.
  ///
  ///   armed       the server has it (`row` is the server's)
  ///   failed      the server said no, the rule can't be kept, or the
  ///               requester isn't the post's account (`error`, with a
  ///               `code` where one is known; QUOTA_EXCEEDED carries
  ///               `payload.feature`)
  ///   confirming  the answer was lost; `confirmation` resolves to what
  ///               became of it (confirmArmAfterUnknown) without holding
  ///               the caller
  ///   none        the fitted rule is off: nothing to send
  ///
  /// `fit` is composerTimerFit's; `postedAt` is when the post went up (the
  /// window runs from there). `preflight` refuses, before sending, a pinned
  /// time that has already passed or is more than 30 days out: right for
  /// putting an existing post on a timer. armAfterPublish turns it off,
  /// because a pin that passed while the post was being written is the
  /// five-minute floor instead. A cancelled task (the web's aborted signal)
  /// fails rather than confirming.
  public static func createTimer(
    _ req: (any TimerRequester)?,
    uri: String?,
    cid: String? = nil,
    extraUris: [String]? = [],
    snippet: JSONValue? = nil,
    postedAt: String? = nil,
    rule: some TimerRuleInput,
    fit: TimerFit = TimerFit(),
    now: Double,
    preflight: Bool = true,
    timeZone: TimeZone? = nil,
    context: TimerServiceContext = .shared
  ) async -> CreateTimerOutcome {
    if let refused = checkRequester(req, uri) {
      return CreateTimerOutcome(status: "failed", error: refused, adjusted: nil)
    }
    guard let req, let uri else { return CreateTimerOutcome(status: "failed", error: needsBackend(), adjusted: nil) }

    let zone = TimerJS.zone(timeZone)
    let fitted = TimerJS.inZone(zone) { SelfDestruct.fitTimerToPost(rule, fit) }
    if !fitted.enabled { return CreateTimerOutcome(status: "none", adjusted: nil) }
    if preflight {
      let problem = SelfDestruct.immediateTimerProblem(fitted, now)
      if !problem.isEmpty {
        return CreateTimerOutcome(status: "failed", error: codedError("TIMER_PROBLEM", problem), adjusted: nil)
      }
    }
    let startedAt = postedAt.map { VirgaCore.JSDate.parse($0, timeZone: zone) } ?? .nan
    let adjusted = SelfDestruct.settleForPublish(fitted, startedAt.isFinite ? startedAt : now).adjusted
    guard
      let body = timerBody(
        uri: uri, cid: cid, extraUris: extraUris, snippet: snippet, postedAt: postedAt, rule: rule, fit: fit,
        now: now, timeZone: zone)
    else { return CreateTimerOutcome(status: "none", adjusted: nil) }

    do {
      let row = try await sendCreate(req, body)
      context.availability.settle("available")
      announce(accountOf(req, uri), ["change": "armed", "postUri": .string(uri), "id": idOf(row)], context)
      return CreateTimerOutcome(status: "armed", row: row, adjusted: adjusted)
    } catch {
      markTimersUnavailable(error, context: context)
      let failure = TimerServiceError(error)
      if isArmOutcomeUnknown(error) && !Task.isCancelled {
        let confirmation = Task { await confirmArmAfterUnknown(req, body, firstError: failure, context: context) }
        return CreateTimerOutcome(status: "confirming", error: failure, adjusted: adjusted, confirmation: confirmation)
      }
      return CreateTimerOutcome(status: "failed", error: failure, adjusted: adjusted)
    }
  }

  /// Arm the timer for what publish just wrote: the root post carries it
  /// and the rest of a thread goes with it. Waits through a lost answer (one
  /// retry, then a look at the timers list); `onConfirming` hears when that
  /// starts, so the composer can say so. Never throws.
  ///
  /// `publishResult` is publish's `{ posts: [{ uri, cid }], root: { uri,
  /// cid } }`; `rule` the writer's TimerRule (unfitted).
  public static func armAfterPublish(
    _ req: (any TimerRequester)?,
    _ publishResult: JSONValue?,
    _ rule: some TimerRuleInput,
    snippet: JSONValue? = nil,
    postedAt: String? = nil,
    fit: TimerFit = TimerFit(),
    onConfirming: (@Sendable () -> Void)? = nil,
    now: Double,
    timeZone: TimeZone? = nil,
    context: TimerServiceContext = .shared
  ) async -> ArmOutcome {
    let root = [publishResult?["root"], publishResult?["posts"]?[0]].lazy.compactMap { $0 }.first { $0.isTruthy }
    guard let root, let rootUri = root["uri"], rootUri.isTruthy else {
      return ArmOutcome(
        status: "failed", error: codedError("BAD_POST", "Nothing was written to put a timer on."), adjusted: nil,
        note: "")
    }
    let extraUris = (publishResult?["posts"]?.arrayValue ?? []).compactMap { post -> String? in
      guard let uri = post["uri"]?.stringValue, !uri.isEmpty, !(rootUri.stringValue).jsEquals(uri) else { return nil }
      return uri
    }
    let start: String
    if let postedAt, !postedAt.isEmpty {
      start = postedAt
    } else if let iso = VirgaCore.JSDate.toISOString(VirgaCore.JSDate.timeClip(now)) {
      start = iso
    } else {
      return ArmOutcome(
        status: "failed", error: TimerServiceError(message: "Invalid time value", name: "RangeError"), adjusted: nil,
        note: "")
    }
    let first = await createTimer(
      req, uri: rootUri.stringValue, cid: root["cid"]?.stringValue, extraUris: extraUris, snippet: snippet,
      postedAt: start, rule: rule, fit: fit, now: now, preflight: false, timeZone: timeZone, context: context)
    let note =
      first.adjusted != nil
      ? SelfDestruct.timerAdjustmentNote(first.adjusted, SelfDestruct.fitTimerToPost(rule, fit).effects) : ""
    guard first.status == "confirming", let confirmation = first.confirmation else {
      return ArmOutcome(status: first.status, row: first.row, error: first.error, adjusted: first.adjusted, note: note)
    }
    onConfirming?()
    let outcome = await confirmation.value
    return ArmOutcome(status: outcome.status, row: outcome.row, error: outcome.error, adjusted: first.adjusted, note: note)
  }

  /// Call a timer off, leaving the post where it is. Answers the server's
  /// row (`{ id, status: 'cancelled' }`). 409 NOT_CANCELLABLE means it is
  /// being checked or has settled: reload rather than patch, the worker may
  /// hold it.
  public static func cancelTimer(
    _ req: (any TimerRequester)?, _ id: JSONValue, context: TimerServiceContext = .shared
  ) async throws -> JSONValue? {
    guard let req else { throw needsBackend() }
    let res = try await req.request(TimerRequest(path: "\(base)/cancel", method: "POST", body: ["id": id]))
    announce(req.did, ["change": "cancelled", "id": id], context)
    return res?["data"]
  }
}
