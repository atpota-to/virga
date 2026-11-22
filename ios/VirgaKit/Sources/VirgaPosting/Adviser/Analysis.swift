// Ports src/posting/adviser/analysis.js
//
// Pure decisions around one adviser read: which drafts the pre-publish
// check covers, the draft scenario, which writing checks are on, and
// applying suggested fixes. Shapes mirror the account's adviser setup
// (Setup.swift) and the server's /api/ai/analyze-post payload.

import Foundation
import VirgaCore

/// applyWritingFixes' answer: `{ text, applied }`.
public struct AppliedFixes: Codable, Hashable, Sendable {
  public var text: String
  public var applied: Int
}

/// applyWritingFixesToThread's answer: `{ posts, applied }` (the posts as
/// given when nothing applied; nil when none were given, as the web's
/// `{ posts: undefined }`).
public struct AppliedThreadFixes: Codable, Hashable, Sendable {
  public var posts: JSONValue?
  public var applied: Int
}

public enum AdviserAnalysis {
  public static let adviserCheckScopes = ["all", "topLevel", "replies"]

  /// Unknown or legacy values become 'all'.
  public static func normalizeAdviserScope(_ scope: JSONValue?) -> String {
    ComposerJS.includes(adviserCheckScopes, scope) ? scope!.stringValue! : "all"
  }

  public static func normalizeAdviserScope(_ scope: String?) -> String {
    normalizeAdviserScope(scope.map(JSONValue.string))
  }

  /// Whether the automatic pre-publish check covers this draft. 'replies'
  /// means replies to someone else; a reply to your own post counts as
  /// 'topLevel' (as do fresh posts and quotes).
  public static func adviserScopeAllowsDraft(_ scope: JSONValue?, repliesToOther: Bool) -> Bool {
    let normalized = normalizeAdviserScope(scope)
    if normalized == "all" { return true }
    return normalized == "replies" ? repliesToOther : !repliesToOther
  }

  /// The draft scenario for the server's tailored prompt, in priority
  /// order: 'reply' | 'quote' | 'thread' | 'selfReply' | 'post'.
  public static func adviserScenarioFor(
    repliesToOther: Bool = false, quotesOther: Bool = false, repliesToSelf: Bool = false, isThread: Bool = false
  ) -> String {
    if repliesToOther { return "reply" }
    if quotesOther { return "quote" }
    if isThread { return "thread" }
    if repliesToSelf { return "selfReply" }
    return "post"
  }

  /// The enabled writing checks in the analyze-post shape, or nil when none
  /// are on. While any is on, `customText` and `style` ride along.
  public static func enabledWritingChecks(_ writingChecks: JSONValue?) -> JSONValue? {
    guard let writingChecks, TimerJS.isObject(writingChecks) else { return nil }
    var out: [String: JSONValue] = [:]
    for key in ["typos", "grammar", "clarity"] where writingChecks[key] == .bool(true) { out[key] = true }
    if out.isEmpty { return nil }
    let customText = writingChecks["customText"]?.stringValue?.jsTrimmed() ?? ""
    if !customText.isEmpty { out["customText"] = .string(customText) }
    let style = writingChecks["styleProfile"]?["summary"]?.stringValue?.jsTrimmed() ?? ""
    if !style.isEmpty { out["style"] = .string(style) }
    return .object(out)
  }

  /// Issues the one-tap fix can act on: a real excerpt and a correction for it.
  public static func fixableWritingIssues(_ issues: JSONValue?) -> [JSONValue] {
    guard let list = issues?.arrayValue else { return [] }
    return list.filter { issue in
      guard issue.isTruthy, let found = issue["found"]?.stringValue, !found.jsTrimmed().isEmpty,
        let replacement = issue["replacement"]?.stringValue, !replacement.jsTrimmed().isEmpty
      else { return false }
      return !replacement.jsEquals(found)
    }
  }

  /// Apply suggested fixes to one draft's text. Each replaces the first
  /// occurrence of its `found` excerpt; an excerpt no longer present is
  /// skipped.
  public static func applyWritingFixes(_ text: JSONValue?, _ issues: JSONValue?) -> AppliedFixes {
    var next = text?.stringValue ?? ""
    var applied = 0
    for issue in fixableWritingIssues(issues) {
      let found = issue["found"]!.stringValue!
      let replacement = issue["replacement"]!.stringValue!
      let at = next.jsIndexOf(found)
      if at == -1 { continue }
      next = next.jsSlice(0, at) + replacement + next.jsSlice(at + found.jsLength)
      applied += 1
    }
    return AppliedFixes(text: next, applied: applied)
  }

  public static func applyWritingFixes(_ text: String, _ issues: [JSONValue]) -> AppliedFixes {
    applyWritingFixes(.string(text), .array(issues))
  }

  /// Apply fixes across a thread's posts. Each fix lands in the first post
  /// containing its excerpt; one spanning two posts is skipped. The posts
  /// come back as given when nothing applied.
  public static func applyWritingFixesToThread(_ posts: JSONValue?, _ issues: JSONValue?) -> AppliedThreadFixes {
    guard let list = posts?.arrayValue else { return AppliedThreadFixes(posts: posts, applied: 0) }
    var texts = list.map { $0["text"]?.stringValue ?? "" }
    var applied = 0
    for issue in fixableWritingIssues(issues) {
      let found = issue["found"]!.stringValue!
      guard let index = texts.firstIndex(where: { $0.jsIndexOf(found) != -1 }) else { continue }
      let result = applyWritingFixes(.string(texts[index]), .array([issue]))
      texts[index] = result.text
      applied += result.applied
    }
    if applied == 0 { return AppliedThreadFixes(posts: .array(list), applied: 0) }
    let next: [JSONValue] = list.enumerated().map { i, post in
      if ComposerJS.strictEquals(.string(texts[i]), post["text"]) { return post }
      var copy = ComposerJS.spread(post)
      copy["text"] = .string(texts[i])
      return .object(copy)
    }
    return AppliedThreadFixes(posts: .array(next), applied: applied)
  }
}
