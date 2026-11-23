// Ports src/posting/adviser/style.js
//
// Learning the writer's style for the adviser's proofread: their recent
// posts (replies included) are read from the public AppView and sent to the
// server, which answers with a short description of their deliberate habits
// (all-lowercase, "gonna", no full stops) so the proofread leaves them
// alone. The description is kept in the account's adviser setup
// (`writingChecks.styleProfile`) and sent with every proofread; the posts
// themselves aren't kept.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// A style reading: `{ summary, analyzedCount, updatedAt, usage? }`.
public struct StyleReading: Hashable, Sendable {
  public var summary: String
  public var analyzedCount: Double
  /// When it was read, as an ISO string.
  public var updatedAt: String
  /// The server's `usage`, when it sent a truthy one.
  public var usage: JSONValue?

  public init(summary: String, analyzedCount: Double, updatedAt: String, usage: JSONValue? = nil) {
    self.summary = summary
    self.analyzedCount = analyzedCount
    self.updatedAt = updatedAt
    self.usage = usage
  }

  public var json: JSONValue {
    var out: JSONValue = [
      "summary": .string(summary), "analyzedCount": .number(analyzedCount), "updatedAt": .string(updatedAt),
    ]
    if let usage { out["usage"] = usage }
    return out
  }
}

/// The RangeError `new Date(now).toISOString()` throws for an invalid time.
public struct InvalidTimeError: Error, LocalizedError, JSErrorConvertible, Hashable, Sendable {
  public var errorDescription: String? { "Invalid time value" }
  public var jsFields: JSErrorFields { JSErrorFields(name: "RangeError", message: "Invalid time value") }
}

public enum AdviserStyle {
  /// The server won't read a style from fewer posts than this.
  public static let minStylePosts = 5

  /// Nor from more than this.
  public static let maxStylePosts = 500

  static let pageSize = 100

  /// Pages are 100 items and reposts are dropped, so two extra pages still
  /// reach the target for someone who reposts a lot.
  static func pageBudgetFor(_ target: Int) -> Int {
    Int((Double(target) / Double(pageSize)).rounded(.up)) + 2
  }

  static func styleError(_ code: String, _ message: String, found: Int? = nil, minimum: Int? = nil, cause: (any Error)? = nil)
    -> AIServiceError
  {
    AIServiceError(message: message, status: 0, code: .string(code), found: found, minimum: minimum, cause: cause)
  }

  static func notEnoughPosts(found: Int) -> AIServiceError {
    styleError(
      "not_enough_posts", "There aren’t enough posts to learn from yet. It needs at least \(minStylePosts).",
      found: found, minimum: minStylePosts)
  }

  /// The author's own post texts from a getAuthorFeed page: reposts and
  /// other people's posts skipped, feed order (newest first), trimmed.
  /// `did` is compared as `===` compares it.
  public static func extractStyleTexts(_ feed: JSONValue?, _ did: JSONValue?) -> [String] {
    guard let feed = feed?.arrayValue else { return [] }
    return feed.compactMap { entry in
      if entry["reason"]?["$type"]?.stringValue == "app.bsky.feed.defs#reasonRepost" { return nil }
      guard ComposerJS.strictEquals(entry["post"]?["author"]?["did"], did),
        let text = entry["post"]?["record"]?["text"]?.stringValue, !text.jsTrimmed().isEmpty
      else { return nil }
      return text.jsTrimmed()
    }
  }

  public static func extractStyleTexts(_ feed: JSONValue?, _ did: String?) -> [String] {
    extractStyleTexts(feed, did.map(JSONValue.string))
  }

  /// Up to `sampleSize` of the account's recent post texts, newest first.
  /// `onPage` hears the running total after each page, and is awaited, so
  /// every count reaches it in order before the texts come back (the web
  /// calls it in the loop). Throws
  /// STYLE_FETCH_FAILED when the AppView can't be read and
  /// `not_enough_posts` (the server's own code) when there are fewer than
  /// minStylePosts, before anything is sent to the server. A cancelled task
  /// or an aborted signal goes through as it is.
  public static func fetchStylePostTexts(
    _ did: String?, sampleSize: JSONValue? = nil, onPage: (@Sendable (Int) async -> Void)? = nil,
    signal: AdviserAbortSignal? = nil, appview: String = AppConfig.appview,
    transport: any HTTPTransport = HTTP.transport
  ) async throws -> [String] {
    guard let did, !did.isEmpty else { throw styleError("NO_ACCOUNT", "Choose an account to learn from.") }
    let target = Swift.min(AdviserSetup.normalizeStyleSampleSize(sampleSize), maxStylePosts)
    var texts: [String] = []
    var cursor: JSONValue?
    do {
      var page = 0
      while page < pageBudgetFor(target) && texts.count < target {
        let params = QueryParams([
          ("actor", .string(did)), ("filter", "posts_with_replies"), ("limit", .number(Double(pageSize))),
          ("cursor", cursor),
        ])
        let body = try await signal.run {
          try await PublicAppView.publicXrpc("app.bsky.feed.getAuthorFeed", params, appview: appview, transport: transport)
        }
        texts.append(contentsOf: extractStyleTexts(body["feed"], .string(did)))
        await onPage?(Swift.min(texts.count, target))
        cursor = body["cursor"]
        if !ComposerJS.truthy(cursor) { break }
        page += 1
      }
    } catch {
      if signal.aborted || error is CancellationError || AIErrorFields(error).isAbort { throw error }
      throw styleError(
        "STYLE_FETCH_FAILED", "Couldn’t load your recent posts to learn from. Try again.", cause: error)
    }
    if texts.count < minStylePosts { throw notEnoughPosts(found: texts.count) }
    return Array(texts.prefix(target))
  }

  /// A style reading from posts already gathered, so a dialog can gather
  /// once and refine as often as the writer likes. `now` dates the reading
  /// (read once, at the start, as the web's default `new Date()`) and keeps
  /// the usage count.
  public static func synthesizeStyleFromTexts(
    _ req: (any AIRequester)?, texts: [String]?, guidance: String? = nil, previousSummary: String? = nil,
    now: @escaping @Sendable () -> Double = AIService.systemNow, signal: AdviserAbortSignal? = nil,
    store: (any KeyValueStore)?
  ) async throws -> StyleReading {
    let startedAt = now()
    guard let texts, texts.count >= minStylePosts else { throw notEnoughPosts(found: texts?.count ?? 0) }
    let limits = AdviserSetup.adviserTextLimits
    let result = try await AIService.synthesizeStyle(
      req,
      [
        "posts": .array(texts.prefix(maxStylePosts).map(JSONValue.string)),
        "guidance": .string((guidance ?? "").jsTrimmed().jsSlice(0, limits["styleGuidance"]!)),
        "previousSummary": .string((previousSummary ?? "").jsTrimmed().jsSlice(0, limits["styleSummary"]!)),
      ], signal: signal, store: store, now: now)
    if result.summary.isEmpty {
      throw styleError("EMPTY_STYLE", "No style came back from that reading. Try again.")
    }
    guard let updatedAt = JSDate.toISOString(startedAt) else { throw InvalidTimeError() }
    return StyleReading(
      summary: result.summary.jsSlice(0, limits["styleSummary"]!), analyzedCount: result.analyzedCount,
      updatedAt: updatedAt, usage: result.usage)
  }

  /// fetchStylePostTexts then synthesizeStyleFromTexts, as the posting
  /// account (`req.did`).
  public static func learnWritingStyle(
    _ req: (any AIRequester)?, sampleSize: JSONValue? = nil, onPage: (@Sendable (Int) async -> Void)? = nil,
    guidance: String? = nil, previousSummary: String? = nil,
    now: @escaping @Sendable () -> Double = AIService.systemNow, signal: AdviserAbortSignal? = nil,
    store: (any KeyValueStore)?, appview: String = AppConfig.appview, transport: any HTTPTransport = HTTP.transport
  ) async throws -> StyleReading {
    let texts = try await fetchStylePostTexts(
      req?.did, sampleSize: sampleSize, onPage: onPage, signal: signal, appview: appview, transport: transport)
    return try await synthesizeStyleFromTexts(
      req, texts: texts, guidance: guidance, previousSummary: previousSummary, now: now, signal: signal, store: store)
  }

  /// `String(v || '')`.
  static func text(_ value: JSONValue?) -> String { ComposerJS.truthy(value) ? value!.jsString : "" }

  /// The `styleProfile` to keep from a reading and the writer's note on it
  /// (kept so the next reading starts from it).
  public static func styleProfileFrom(_ result: JSONValue?, _ guidance: JSONValue? = "") -> AdviserStyleProfile {
    let limits = AdviserSetup.adviserTextLimits
    var count: Double = 0
    if case .number(let n)? = result?["analyzedCount"], n.isFinite { count = Swift.max(0, n.rounded(.down)) }
    return AdviserStyleProfile(
      summary: text(result?["summary"]).jsSlice(0, limits["styleSummary"]!),
      analyzedCount: count,
      updatedAt: result?["updatedAt"]?.stringValue ?? "",
      guidance: text(guidance).jsSlice(0, limits["styleGuidance"]!))
  }

  public static func styleProfileFrom(_ result: StyleReading, _ guidance: String = "") -> AdviserStyleProfile {
    styleProfileFrom(result.json, .string(guidance))
  }

  /// "Forget my style": the reading goes, the writer's own note stays.
  public static func forgetStyleProfile(_ profile: JSONValue?) -> AdviserStyleProfile {
    AdviserStyleProfile(
      summary: "", analyzedCount: 0, updatedAt: "",
      guidance: text(profile?["guidance"]).jsSlice(0, AdviserSetup.adviserTextLimits["styleGuidance"]!))
  }

  public static func forgetStyleProfile(_ profile: AdviserStyleProfile?) -> AdviserStyleProfile {
    forgetStyleProfile(profile.flatMap { try? JSONValue(encoding: $0) })
  }
}
