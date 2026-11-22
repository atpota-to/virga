// Ports src/posting/adviser/aiService.js
//
// The AI help while posting, through Virga's server (/api/ai/*): the
// adviser's read of a draft, the style reading it proofreads against, and
// image descriptions.
//
// Each call takes the requester of the posting account (the web's
// `backendFor(asDid)`, VirgaBackend here, through AIRequester): the server
// takes the account from the token, counts the request against that
// account's monthly allowance and rate limit, and passes the text on to the
// AI gateway. Nothing is sent for an account without one. The body never
// names the account.
//
// Every function throws an AIServiceError whose message can be shown as it
// is, keeping `status`, `code` (`monthly_limit`, `rate_limited`,
// `not_enough_posts`, …), `detail` and `payload` for callers that branch.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

// MARK: - The requester

/// The posting account's requester on Virga's server, as aiService calls it:
/// `req.did` and `req.request(path, { method: 'POST', body, timeoutMs })`.
/// VirgaBackend is one (SessionModel.backendFor(did)).
public protocol AIRequester: Sendable {
  /// The account the requester acts as (`req.did`).
  var did: String? { get }
  /// POSTs `body` as JSON to `path` and answers the whole parsed body, or
  /// throws the server's refusal (BackendError: status, code, detail,
  /// payload).
  func postAI(_ path: String, body: JSONValue, timeoutMs: Double) async throws -> JSONValue
}

extension VirgaBackend: AIRequester {
  public func postAI(_ path: String, body: JSONValue, timeoutMs: Double) async throws -> JSONValue {
    try await request(path, method: "POST", body: body, timeoutMs: timeoutMs)
  }
}

// MARK: - Errors

/// An AI request that failed: `Object.assign(new Error(message), { status,
/// code, detail, payload, cause })`, and the abort error (`name:
/// 'AbortError'`, `canceled: true`). The style reading's own errors carry
/// `found` and `minimum` too.
public struct AIServiceError: Error, LocalizedError, JSErrorConvertible, Sendable, CustomStringConvertible {
  public var name: String
  public var message: String
  /// nil only on the abort error, which sets none.
  public var status: Int?
  public var code: JSONValue?
  public var detail: String?
  public var payload: JSONValue?
  public var canceled: Bool
  public var found: Int?
  public var minimum: Int?
  public var cause: (any Error)?

  public init(
    name: String = "Error", message: String, status: Int? = 0, code: JSONValue? = nil, detail: String? = nil,
    payload: JSONValue? = nil, canceled: Bool = false, found: Int? = nil, minimum: Int? = nil, cause: (any Error)? = nil
  ) {
    self.name = name
    self.message = message
    self.status = status
    self.code = code
    self.detail = detail
    self.payload = payload
    self.canceled = canceled
    self.found = found
    self.minimum = minimum
    self.cause = cause
  }

  /// `err.code` when it is a string.
  public var codeString: String? { code?.stringValue }

  public var errorDescription: String? { message }
  public var description: String { "\(name)(\(code?.jsString ?? "null")): \(message)" }

  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message, code: code, status: status) }

  /// The error as a fixture records it.
  public var json: JSONValue {
    var out: JSONValue = [
      "name": .string(name), "message": .string(message),
      "status": status.map { .number(Double($0)) } ?? .null, "code": code ?? .null,
      "detail": detail.map(JSONValue.string) ?? .null, "payload": payload ?? .null,
    ]
    if canceled { out["canceled"] = true }
    if let found { out["found"] = .number(Double(found)) }
    if let minimum { out["minimum"] = .number(Double(minimum)) }
    return out
  }
}

/// The fields aiService (and the adviser around it) reads off any error:
/// `err.name`, `err.message`, `err.status`, `err.code`, `err.detail`,
/// `err.payload`, `err.canceled`.
public struct AIErrorFields: Sendable, Hashable {
  public var name: String
  public var message: String
  public var status: Int?
  public var code: JSONValue?
  public var detail: String?
  public var payload: JSONValue?
  public var canceled: Bool

  public init(_ error: any Error) {
    switch error {
    case let ai as AIServiceError:
      self.init(
        name: ai.name, message: ai.message, status: ai.status, code: ai.code, detail: ai.detail, payload: ai.payload,
        canceled: ai.canceled)
    case let backend as BackendError:
      self.init(
        name: backend.name, message: backend.message, status: backend.status, code: backend.code,
        detail: backend.detail, payload: backend.payload, canceled: false)
    default:
      let fields = JSErrorFields(error) ?? JSErrorFields()
      self.init(
        name: fields.name, message: fields.message, status: fields.status, code: fields.code, detail: nil,
        payload: nil, canceled: false)
    }
  }

  public init(
    name: String = "Error", message: String = "", status: Int? = nil, code: JSONValue? = nil, detail: String? = nil,
    payload: JSONValue? = nil, canceled: Bool = false
  ) {
    self.name = name
    self.message = message
    self.status = status
    self.code = code
    self.detail = detail
    self.payload = payload
    self.canceled = canceled
  }

  /// `err.code` when it is a string.
  public var codeString: String? { code?.stringValue }

  /// The fields as the web's error object (what aiErrorMessage reads).
  public var json: JSONValue {
    var out: JSONValue = ["name": .string(name), "message": .string(message)]
    if let status { out["status"] = .number(Double(status)) }
    if let code { out["code"] = code }
    if let detail { out["detail"] = .string(detail) }
    if let payload { out["payload"] = payload }
    if canceled { out["canceled"] = true }
    return out
  }

  /// `err?.name === 'AbortError' || err?.canceled === true`.
  public var isAbort: Bool { name == "AbortError" || canceled }
}

// MARK: - The service

/// generateAltText's `onUsage`: `{ used, limit }`.
public struct AIUsageCount: Codable, Hashable, Sendable {
  public var used: Double
  public var limit: Double
}

/// synthesizeStyle's answer: `{ summary, analyzedCount, usage? }`.
public struct StyleSynthesis: Hashable, Sendable {
  public var summary: String
  public var analyzedCount: Double
  /// The server's `usage`, when it sent a truthy one.
  public var usage: JSONValue?

  public var json: JSONValue {
    var out: JSONValue = ["summary": .string(summary), "analyzedCount": .number(analyzedCount)]
    if let usage { out["usage"] = usage }
    return out
  }
}

public enum AIService {
  /// The server's gateway gives up at 25 s; this leaves room for the trip there.
  public static let aiRequestTimeoutMs: Double = 30_000

  /// Image types the server's describer takes.
  public static let altTextMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]

  /// The most base64 one description request carries (Vercel refuses a body
  /// over 4.5 MB before the server sees it).
  public static let maxAltTextBase64 = 4_000_000

  /// The clock the usage counts are kept by, when a caller gives none.
  public static let systemNow: @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }

  static func aiError(_ message: String, code: String) -> AIServiceError {
    AIServiceError(message: message, status: 0, code: .string(code))
  }

  static func abortError() -> AIServiceError {
    AIServiceError(name: "AbortError", message: "Cancelled.", status: nil, canceled: true)
  }

  /// What to tell the writer about a failed AI request, from the error's
  /// fields as the web reads them (`{ code, status, detail, message }`). Nil
  /// where the web answers undefined (NEEDS_BACKEND without a message); a
  /// message that isn't a string is written as String(value).
  public static func aiErrorMessage(_ err: JSONValue?) -> String? {
    let code = err?["code"].truthy
    let detail = err?["detail"]?.stringValue ?? ""
    let status = err?["status"]
    func isCode(_ name: String) -> Bool { code?.stringValue?.jsEquals(name) == true }
    func isStatus(_ n: Double) -> Bool { status == .number(n) }
    func text(_ value: JSONValue?) -> String? { value.map { $0.stringValue ?? $0.jsString } }
    if isCode("NEEDS_BACKEND") { return text(err?["message"]) }
    if isCode("monthly_limit") {
      return "This month’s free uses of this are used up. They start again on the first of the month."
    }
    if isCode("not_enough_posts") { return "There aren’t enough posts to learn from yet. It needs at least 5." }
    if isCode("rate_limited") { return "That’s the limit on AI requests for now. Try again later." }
    if isCode("TIMEOUT") { return "That took too long. Try again." }
    if isCode("NETWORK_ERROR") { return "Couldn’t reach Virga’s server. Check the connection and try again." }
    if isCode("VIRGA_CLIENT_UNAVAILABLE") || isStatus(503) { return "AI help isn’t available right now." }
    if isStatus(401) { return "This account needs to sign in again to use AI help." }
    if isStatus(429) { return "The AI service is busy. Try again in a moment." }
    if isStatus(413) { return "That’s too large to send for AI help." }
    if !detail.isEmpty { return detail }
    if let status, status.isTruthy { return "The AI request didn’t work (\(status.jsString)). Try again." }
    return text(err?["message"].truthy) ?? "The AI request didn’t work. Try again."
  }

  /// aiErrorMessage for a thrown error.
  public static func aiErrorMessage(_ error: any Error) -> String {
    aiErrorMessage(AIErrorFields(error).json) ?? ""
  }

  /// POST `body` to `path` as the requester's account. A signal already
  /// aborted sends nothing: a read the composer has moved past must not send
  /// the draft. Once sent, the request runs to its end (the server counts it
  /// whatever happens here), and the caller drops an answer it no longer
  /// wants.
  static func postAi(
    _ req: (any AIRequester)?, _ path: String, _ body: JSONValue, signal: AdviserAbortSignal?,
    feature: AdviserUsageFeature?, store: (any KeyValueStore)?, now: @Sendable () -> Double
  ) async throws -> JSONValue {
    guard let req else {
      throw aiError("AI help needs this account signed in through Virga’s server.", code: "NEEDS_BACKEND")
    }
    if signal.aborted { throw abortError() }
    let data: JSONValue
    do {
      data = try await req.postAI(path, body: body, timeoutMs: aiRequestTimeoutMs)
    } catch {
      if error is CancellationError { throw error }
      let fields = AIErrorFields(error)
      if fields.isAbort { throw error }
      if fields.codeString == "monthly_limit", let feature, let did = req.did, !did.isEmpty {
        AdviserUsageStore.markAdviserLimitReached(
          did, fields.payload?["limit"], feature: feature, now: now(), store: store)
      }
      throw AIServiceError(
        message: aiErrorMessage(fields.json) ?? "", status: fields.status ?? 0, code: fields.code.nonNull,
        detail: fields.detail, payload: fields.payload.nonNull, cause: error)
    }
    if let feature, let did = req.did, !did.isEmpty {
      // No `usage` on a 2xx means the server didn't count it: the allowance
      // is unlimited now, so a used-up count kept from before must not stand.
      if AdviserUsageStore.recordAdviserUsage(did, data["usage"], feature: feature, now: now(), store: store) == nil {
        AdviserUsageStore.clearAdviserUsage(did, feature: feature, store: store)
      }
    }
    return data
  }

  /// `typeof value === 'string' && value.trim() ? value : undefined`.
  static func optionalText(_ value: JSONValue?) -> String? {
    guard let text = value?.stringValue, !text.jsTrimmed().isEmpty else { return nil }
    return text
  }

  /// The adviser's read of a draft. `payload` is `{ text, goals?, scenario?,
  /// context?, writingChecks? }` (context.js analyzePayload); the answer is
  /// the server's `{ sentiment, checks, suggestion, overallStatus, writing?,
  /// usage? }` as it sent it.
  public static func analyzePost(
    _ req: (any AIRequester)?, _ payload: JSONValue?, signal: AdviserAbortSignal? = nil,
    store: (any KeyValueStore)?, now: @escaping @Sendable () -> Double = AIService.systemNow
  ) async throws -> JSONValue {
    let text = payload?["text"]?.stringValue ?? ""
    if text.jsTrimmed().isEmpty { throw aiError("Write something first.", code: "EMPTY") }
    var body: JSONValue = ["text": .string(text)]
    for key in ["goals", "scenario", "context", "writingChecks"] {
      if let value = payload?[key], value.isTruthy { body[key] = value }
    }
    return try await postAi(
      req, "/api/ai/analyze-post", body, signal: signal, feature: .adviser, store: store, now: now)
  }

  /// A reading of the writer's style from their own posts (newest first),
  /// for the proofread to respect. `payload` is `{ posts, guidance?,
  /// previousSummary? }`.
  public static func synthesizeStyle(
    _ req: (any AIRequester)?, _ payload: JSONValue?, signal: AdviserAbortSignal? = nil,
    store: (any KeyValueStore)?, now: @escaping @Sendable () -> Double = AIService.systemNow
  ) async throws -> StyleSynthesis {
    var body: JSONValue = ["posts": .array(payload?["posts"]?.arrayValue ?? [])]
    if let guidance = optionalText(payload?["guidance"]) { body["guidance"] = .string(guidance.jsTrimmed()) }
    if let previous = optionalText(payload?["previousSummary"]) {
      body["previousSummary"] = .string(previous.jsTrimmed())
    }
    let data = try await postAi(
      req, "/api/ai/synthesize-style", body, signal: signal, feature: .style, store: store, now: now)
    var analyzedCount: Double = 0
    if case .number(let n)? = data["analyzedCount"], n.isFinite { analyzedCount = n }
    return StyleSynthesis(
      summary: data["summary"]?.stringValue?.jsTrimmed() ?? "", analyzedCount: analyzedCount,
      usage: data["usage"].truthy)
  }

  /// A description of an image. `payload` is `{ imageBase64 (no data:
  /// prefix), mimeType, context?, followUp?, previousAltText?, presets?,
  /// kind? }`; with `followUp` and `previousAltText` it revises the last
  /// one. `onUsage` hears the month's count when the server sends one, and
  /// is awaited, so it has heard before the description comes back (as the
  /// web calls it). Answers the description, trimmed.
  public static func generateAltText(
    _ req: (any AIRequester)?, _ payload: JSONValue?, onUsage: (@Sendable (AIUsageCount) async -> Void)? = nil,
    signal: AdviserAbortSignal? = nil, store: (any KeyValueStore)?,
    now: @escaping @Sendable () -> Double = AIService.systemNow
  ) async throws -> String {
    guard let imageBase64 = payload?["imageBase64"]?.stringValue, !imageBase64.isEmpty else {
      throw aiError("There’s no image to describe.", code: "NO_IMAGE")
    }
    guard let mimeType = payload?["mimeType"]?.stringValue, altTextMimeTypes.jsIncludes(mimeType) else {
      throw aiError(
        "This kind of image can’t be described. Try a JPEG, PNG, WebP or GIF.", code: "UNSUPPORTED_IMAGE")
    }
    if imageBase64.utf16.count > maxAltTextBase64 {
      throw aiError("That image is too large to describe.", code: "IMAGE_TOO_LARGE")
    }
    var body: JSONValue = ["imageBase64": .string(imageBase64), "mimeType": .string(mimeType)]
    for key in ["context", "followUp", "previousAltText"] {
      if let text = optionalText(payload?[key]) { body[key] = .string(text) }
    }
    if let presets = payload?["presets"]?.arrayValue, !presets.isEmpty { body["presets"] = .array(presets) }
    if let kind = payload?["kind"], kind.isTruthy { body["kind"] = kind }
    let data = try await postAi(
      req, "/api/ai/alt-text", body, signal: signal, feature: .altText, store: store, now: now)
    if let onUsage, case .number(let used)? = data["usage"]?["used"], used.isFinite,
      case .number(let limit)? = data["usage"]?["limit"], limit.isFinite
    {
      await onUsage(AIUsageCount(used: used, limit: limit))
    }
    return data["altText"]?.stringValue?.jsTrimmed() ?? ""
  }

  /// generateAltText for a file: the composer's prepared image, so what is
  /// described is what will be posted. `read` gives the file's bytes (the
  /// web's `blob.arrayBuffer()`); `payload` is generateAltText's, less the
  /// image, which comes from the file (its type, else image/jpeg).
  public static func generateAltTextForFile(
    _ req: (any AIRequester)?, _ file: ComposerFile?, read: @Sendable (ComposerFile) async throws -> Data,
    payload: JSONValue? = nil, onUsage: (@Sendable (AIUsageCount) async -> Void)? = nil,
    signal: AdviserAbortSignal? = nil, store: (any KeyValueStore)?,
    now: @escaping @Sendable () -> Double = AIService.systemNow
  ) async throws -> String {
    guard let file else { throw aiError("There’s no image to describe.", code: "NO_IMAGE") }
    let imageBase64 = blobToBase64(try await read(file))
    var full = payload?.objectValue ?? [:]
    full["imageBase64"] = .string(imageBase64)
    full["mimeType"] = .string(file.type.isEmpty ? "image/jpeg" : file.type)
    return try await generateAltText(
      req, .object(full), onUsage: onUsage, signal: signal, store: store, now: now)
  }
}

/// A blob's bytes as base64, without a `data:` prefix: scheduleSerialize.js's
/// blobToBase64 (btoa over the bytes as a binary string), kept here until
/// the scheduling port lands. The merge switches this to that port's.
fileprivate func blobToBase64(_ bytes: Data) -> String {
  bytes.base64EncodedString()
}
