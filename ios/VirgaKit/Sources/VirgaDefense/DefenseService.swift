// Ports src/defense/defenseService.js
//
// Defense's lists, plans and history, through Virga's server
// (/api/defense/*). Every call takes the account's requester
// (`backendFor(did)`, VirgaNetwork's VirgaBackend): the server takes the
// owner from the token, and every read and write is that owner's. An
// account without a long session has none, and every call then throws
// NEEDS_BACKEND.
//
// Answers are the server's JSON as it sent it (the envelope's `data`), read
// as loosely as the web reads them. The web's AbortSignal is task
// cancellation: a cancelled call throws CancellationError.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

public enum DefenseService {
  /// BASE.
  static let base = "/api/defense"

  /// The error a call without a long session throws: code NEEDS_BACKEND, status 0.
  public static func needsBackend() -> BackendError {
    BackendError(message: "Defense’s lists need this account signed in through Virga’s server.", status: 0, code: "NEEDS_BACKEND")
  }

  static func check(_ req: VirgaBackend?) throws -> VirgaBackend {
    guard let req else { throw needsBackend() }
    return req
  }

  /// `data(body)`: `body?.data ?? body`.
  static func data(_ body: JSONValue) -> JSONValue {
    body["data"].nonNull ?? body
  }

  /// `value.member` where `value` may be null: JavaScript throws reading a
  /// member of null, and so does this; anything else without the member
  /// reads as nothing.
  static func member(_ value: JSONValue, _ name: String) throws -> JSONValue {
    if value.isNull { throw JSError(name: "TypeError", message: "Cannot read properties of null (reading '\(name)')") }
    return value[name] ?? .null
  }

  /// An object literal's members, a nil value left out as JSON.stringify
  /// leaves out `undefined`.
  static func object(_ members: [(String, JSONValue?)]) -> JSONValue {
    var out: [String: JSONValue] = [:]
    for (name, value) in members { if let value { out[name] = value } }
    return .object(out)
  }

  /// `fetchLists(req, { signal })`: `{ lists, kept, writes }` for the account.
  public static func fetchLists(_ req: VirgaBackend?) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/lists"))
  }

  /// `createList(req, { name, purpose, description })`: makes a moderation
  /// list in the account's own repo, and answers the new list. A
  /// description is sent only when there is one.
  public static func createList(_ req: VirgaBackend?, name: String?, purpose: String?, description: String? = nil) async throws
    -> JSONValue
  {
    let req = try check(req)
    let body = object([
      ("name", name.map(JSONValue.string)), ("purpose", purpose.map(JSONValue.string)),
      ("description", description.flatMap { $0.isEmpty ? nil : .string($0) }),
    ])
    return try member(data(try await req.request("\(base)/list-create", method: "POST", body: body)), "list")
  }

  /// `keepAccount(req, did, reason)`: keep someone by hand (a reason only when given).
  public static func keepAccount(_ req: VirgaBackend?, _ did: String, _ reason: String? = nil) async throws -> JSONValue {
    let req = try check(req)
    let body = object([("did", .string(did)), ("reason", reason.flatMap { $0.isEmpty ? nil : .string($0) })])
    return data(try await req.request("\(base)/keep", method: "POST", body: body))
  }

  /// `unkeepAccount(req, did)`.
  public static func unkeepAccount(_ req: VirgaBackend?, _ did: String) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/unkeep", method: "POST", body: ["did": .string(did)]))
  }

  /// `planAndApprove(req, { listId, postUri, rows, totals, bands, note })`:
  /// store a scan's plan for a list, then approve bands of it, and answer
  /// `{ planId, queued, kept, already }`. Two calls, so a plan is kept even
  /// if approving it fails, and can be approved again. `rows` and `totals`
  /// are sent as they encode (Plan.planRows' rows; the summary's totals
  /// with its bands spread in, as the page sends them); `note` nil is sent
  /// as null, as the page's `cleanNote(note)` gives.
  public static func planAndApprove<Rows: Encodable, Totals: Encodable>(
    _ req: VirgaBackend?,
    listId: JSONValue,
    postUri: String?,
    rows: Rows,
    totals: Totals,
    bands: [String],
    note: String?
  ) async throws -> JSONValue {
    let req = try check(req)
    let planBody: JSONValue = [
      "listId": listId, "postUri": postUri.map(JSONValue.string) ?? .null,
      "rows": try JSONValue(encoding: rows), "totals": try JSONValue(encoding: totals),
    ]
    let plan = data(try await req.request("\(base)/plan", method: "POST", body: planBody))
    // `plan.planId`: read even when it is missing, which then goes unsent.
    let planId: JSONValue? = plan.isNull ? try member(plan, "planId") : plan["planId"]
    let approveBody = object([
      ("planId", planId), ("bands", .array(bands.map(JSONValue.string))), ("note", note.map(JSONValue.string) ?? .null),
    ])
    let approved = data(try await req.request("\(base)/approve", method: "POST", body: approveBody))
    // `{ planId: plan.planId, ...approved }`.
    var out: [String: JSONValue] = [:]
    if let planId { out["planId"] = planId }
    for (name, value) in approved.objectValue ?? [:] { out[name] = value }
    return .object(out)
  }

  /// `fetchHistory(req, { before, list, signal })`: `{ decisions, plans }`,
  /// newest first. `before` (a decision's id) and `list` are sent only when
  /// truthy, `before` as `String(before)`.
  public static func fetchHistory(_ req: VirgaBackend?, before: JSONValue? = nil, list: String? = nil) async throws -> JSONValue {
    let req = try check(req)
    var items: [(String, JSONValue?)] = []
    if let before = before.truthy { items.append(("before", .string(before.jsString))) }
    if let list, !list.isEmpty { items.append(("list", .string(list))) }
    let query = QueryParams(items)
    return data(try await req.request("\(base)/history", query: query))
  }

  /// `undoAdds(req, { planId, ids, note })`: take back a plan's adds, or
  /// some decisions: `{ jobId, cancelled, queued }`. Each is sent only when
  /// truthy (an empty `ids` is sent: an array is truthy).
  public static func undoAdds(_ req: VirgaBackend?, planId: JSONValue? = nil, ids: [JSONValue]? = nil, note: String? = nil)
    async throws -> JSONValue
  {
    let req = try check(req)
    let body = object([
      ("planId", planId.truthy), ("ids", ids.map(JSONValue.array)), ("note", note.flatMap { $0.isEmpty ? nil : .string($0) }),
    ])
    return data(try await req.request("\(base)/undo", method: "POST", body: body))
  }

  /// `defenseErrorMessage(err)`: a sentence for a failed call, from the
  /// server's code where it gave one, else the error's own message.
  public static func defenseErrorMessage(_ error: (any Error)?) -> String {
    let fields = JSErrorFields(error)
    return defenseErrorMessage(code: fields?.code, message: fields?.message)
  }

  /// `defenseErrorMessage(err)` over the two fields it reads. The code is
  /// matched code unit by code unit, as `switch` compares.
  public static func defenseErrorMessage(code: JSONValue?, message: String?) -> String {
    let code = code?.stringValue
    func is_(_ name: String) -> Bool { code.jsEquals(name) }
    if is_("NEEDS_BACKEND") {
      return "Defense’s lists need a long session through Virga’s server. Reconnect this account from the account menu."
    }
    if is_("WRITES_OFF") { return "Defense’s lists aren’t turned on on Virga’s server yet." }
    if is_("NO_SCOPE") { return "This sign-in doesn’t let Virga make lists. Let Defense make lists, below, and try again." }
    if is_("SIGNED_OUT") || is_("FRONTEND_SESSION_INVALID") {
      return "This account’s session on Virga’s server has ended. Sign in again."
    }
    if is_("UNAVAILABLE") { return "Defense isn’t set up on Virga’s server yet." }
    if let message, !message.isEmpty { return message }
    return "Something went wrong on Virga’s server. Try again in a moment."
  }

  // MARK: The moderator (phase 4)

  /// `fetchLink(req, { signal })`: `{ moderator, linked, linkedAt, codeExpiresAt, listId }`.
  public static func fetchLink(_ req: VirgaBackend?) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/link"))
  }

  /// `makeLinkCode(req)`: a new code to send the moderator, `{ code,
  /// expiresAt, moderator }`. Shown once.
  public static func makeLinkCode(_ req: VirgaBackend?) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/link-code", method: "POST", body: [:]))
  }

  /// `unlinkModerator(req)`.
  public static func unlinkModerator(_ req: VirgaBackend?) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/unlink", method: "POST", body: [:]))
  }

  /// `chooseLinkList(req, listId)`: the list "block @someone" adds to (null
  /// for the only one: a falsy `listId` is sent as null).
  public static func chooseLinkList(_ req: VirgaBackend?, _ listId: JSONValue?) async throws -> JSONValue {
    let req = try check(req)
    return data(try await req.request("\(base)/link-list", method: "POST", body: ["listId": listId.truthy ?? .null]))
  }
}
