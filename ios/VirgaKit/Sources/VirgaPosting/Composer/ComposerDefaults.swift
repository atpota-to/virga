// Ports src/posting/composer/defaults.js
//
// The composer's defaults for a post that hasn't been given its own: the
// account's default timer (DESIGN.md §6.6, armed only when Virga's server
// says there's a free timer), and the words for where the reply settings
// came from and who may reply. Settings, limits and gates are taken as the
// web takes them (JSONValue).

import Foundation
import VirgaCore

/// The timer a fresh post starts with: `{ rule, note, pending }`.
public struct DefaultTimer: Codable, Hashable, Sendable {
  /// The account's default, armed only when the limits show room for it.
  public var rule: TimerRule
  /// Why a default that is on was left off, or ''.
  public var note: String
  /// The limits are still being read, so the rule is off for now.
  public var pending: Bool
}

public enum ComposerDefaults {
  public static let timerNeedsServer = "Timers need a long session through Virga’s server, so this post has none."
  public static let timerLimitsUnknown =
    "Couldn’t check whether a timer is free, so the default timer is off for this post."
  public static let noFreeTimer = "No free timer: post without it, or keep editing."

  /// The timer a fresh post starts with. `settings` is readPostingSettings'
  /// answer, `limitsStatus` 'idle' | 'loading' | 'ready' | 'error', `limits`
  /// getLimits' answer, `fit` `{ available }`.
  public static func defaultTimerFor(
    _ settings: JSONValue?, canSchedule: Bool = false, limitsStatus: String? = nil, limits: JSONValue? = nil,
    fit: JSONValue? = nil
  ) -> DefaultTimer {
    let rule = SelfDestruct.normalizeTimer(SelfDestruct.defaultRuleFromSettings(settings?["lifespan"]))
    func off(_ note: String = "", _ pending: Bool = false) -> DefaultTimer {
      var offRule = rule
      offRule.enabled = false
      return DefaultTimer(rule: offRule, note: note, pending: pending)
    }
    if !rule.enabled { return DefaultTimer(rule: rule, note: "", pending: false) }
    if !canSchedule || fit?["available"] == .bool(false) { return off(timerNeedsServer) }
    if limitsStatus == "loading" || limitsStatus == "idle" { return off("", true) }
    if limitsStatus != "ready" { return off(timerLimitsUnknown) }
    let problem = SelfDestruct.timerRoomProblem(rule, limits)
    if !problem.isEmpty { return off(problem) }
    return DefaultTimer(rule: rule, note: "", pending: false)
  }

  /// A line about where this post's reply settings came from. `info` is
  /// `{ custom, status, source, notice }`.
  public static func gatesSourceLine(_ info: JSONValue?, reply: Bool = false) -> String {
    if reply { return "A reply follows the settings of the thread it joins." }
    guard let info, info.isTruthy else { return "" }
    if ComposerJS.truthy(info["custom"]) { return "Set for this post." }
    if info["status"] == "loading" { return "Reading your reply settings…" }
    if info["source"] == "settings" { return "From your posting settings in Virga." }
    if info["source"] == "bluesky" { return "From your Bluesky settings." }
    return ComposerJS.or(info["notice"], nil).map { $0.stringValue ?? $0.jsString } ?? ""
  }

  /// The rules of `gates.reply`: nil for anyone (null or absent), else the
  /// list (a value that isn't one reads as no rules).
  static func replyRules(_ gates: JSONValue?) -> [JSONValue]? {
    guard let reply = gates?["reply"], !reply.isNull else { return nil }
    return reply.arrayValue ?? []
  }

  /// A short summary of who may reply and quote, for the composer's options row.
  public static func gatesSummary(_ gates: JSONValue?) -> String {
    var who: String
    if let reply = replyRules(gates) {
      if reply.isEmpty {
        who = "Nobody can reply"
      } else {
        let names: [String] = reply.compactMap { rule in
          switch rule["type"]?.stringValue {
          case "mention": return "people you mention"
          case "follower": return "your followers"
          case "following": return "people you follow"
          case "list": return "a list"
          default: return nil
          }
        }
        let lists = names.filter { $0 == "a list" }.count
        var plain = ComposerJS.unique(names.filter { $0 != "a list" })
        if lists > 0 { plain.append(lists == 1 ? "one list" : "\(lists) lists") }
        let joined = plain.joined(separator: ", ")
        who = "Replies: \(joined.isEmpty ? "some people" : joined)"
      }
    } else {
      who = "Anyone can reply"
    }
    return gates?["quotes"] == .bool(false) ? "\(who) · No quotes" : who
  }

  static let replyGroup: [String: String] = [
    "mention": "People you mention",
    "follower": "Your followers",
    "following": "People you follow",
    "list": "People in a list",
  ]

  /// Who may reply, in as few words as a phone's row has room for:
  /// "Anyone", "Nobody", one group by name, "Followed or mentioned", or else
  /// "Some people".
  public static func gatesShortSummary(_ gates: JSONValue?) -> String {
    var who: String
    if let reply = replyRules(gates) {
      if reply.isEmpty {
        who = "Nobody"
      } else {
        let types = ComposerJS.unique(reply.compactMap { rule in
          rule["type"]?.stringValue.flatMap { replyGroup.jsValue($0) == nil ? nil : $0 }
        })
        let lists = reply.filter { $0["type"] == "list" }.count
        if types.count == 1 && lists <= 1 {
          who = replyGroup.jsValue(types[0])!
        } else if types.count == 2 && types.jsIncludes("following") && types.jsIncludes("mention") {
          who = "Followed or mentioned"
        } else {
          who = "Some people"
        }
      }
    } else {
      who = "Anyone"
    }
    return gates?["quotes"] == .bool(false) ? "\(who) · No quotes" : who
  }
}
