// Ports src/posting/composer/gatesModel.js
//
// The reply rules GatesEditor edits, as plain list operations. `reply` is
// ComposerState.gates.reply: null (anyone), [] (nobody) or rules, each
// `{ type, list? }`, taken as the web takes them (JSONValue).

import Foundation
import VirgaCore

/// An option of the rules editor: `{ type, label }`.
public struct ReplyRuleOption: Codable, Hashable, Sendable {
  public var type: String
  public var label: String
}

/// gatesForAccount's answer: the gates as they can go out from an account,
/// how many list rules came out, and whether that left them at the default.
public struct AccountGates: Codable, Hashable, Sendable {
  /// The gates as given, or with foreign list rules taken out (absent when
  /// none were given).
  public var gates: JSONValue?
  public var dropped: Int
  /// Only when rules were dropped: whether the gates went back to the default.
  public var reset: Bool?
}

public enum GatesModel {
  public static let ruleOptions = [
    ReplyRuleOption(type: "mention", label: "People you mention"),
    ReplyRuleOption(type: "following", label: "People you follow"),
    ReplyRuleOption(type: "follower", label: "Your followers"),
  ]

  static func sameRule(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
    guard ComposerJS.strictEquals(a?["type"], b?["type"]) else { return false }
    return a?["type"] != "list" || ComposerJS.strictEquals(a?["list"], b?["list"])
  }

  /// 'everyone', 'nobody' or 'some'.
  public static func replyMode(_ reply: JSONValue?) -> String {
    guard let rules = reply?.arrayValue else { return "everyone" }
    return rules.isEmpty ? "nobody" : "some"
  }

  public static func hasRule(_ reply: JSONValue?, _ rule: JSONValue?) -> Bool {
    reply?.arrayValue?.contains { sameRule($0, rule) } ?? false
  }

  /// `reply` with `rule` added or taken out. Never takes out the last rule
  /// (an empty list would mean nobody), and never adds past the five a
  /// threadgate holds.
  public static func toggleRule(_ reply: JSONValue?, _ rule: JSONValue) -> [JSONValue] {
    let list = reply?.arrayValue ?? []
    if hasRule(.array(list), rule) {
      return list.count > 1 ? list.filter { !sameRule($0, rule) } : list
    }
    if list.count >= Gates.maxReplyRules { return list }
    if rule["type"] == "list" {
      var added: [String: JSONValue] = ["type": "list"]
      if let uri = rule["list"] { added["list"] = uri }
      return list + [.object(added)]
    }
    var added: [String: JSONValue] = [:]
    if let type = rule["type"] { added["type"] = type }
    return list + [.object(added)]
  }

  public static func toggleRule(_ reply: [ReplyRule]?, _ rule: ReplyRule) -> [JSONValue] {
    toggleRule(reply.map { .array($0.map(\.json)) }, rule.json)
  }

  /// A hint under the rules, or ''.
  public static func rulesNote(_ reply: JSONValue?) -> String {
    guard let rules = reply?.arrayValue, !rules.isEmpty else { return "" }
    if rules.count >= Gates.maxReplyRules {
      return "That’s the most a post can have: \(Gates.maxReplyRules) groups."
    }
    if rules.count == 1 { return "Choose at least one group, or choose Nobody." }
    return ""
  }

  /// The account a list belongs to: the repo in its at:// URI.
  static func listOwner(_ uri: JSONValue?) -> String {
    guard let text = uri?.stringValue else { return "" }
    return AtUri.authority(of: text) ?? ""
  }

  /// Whether a list rule names a list `did` doesn't own.
  public static func isForeignListRule(_ rule: JSONValue?, _ did: JSONValue?) -> Bool {
    rule?["type"] == "list" && !ComposerJS.strictEquals(.string(listOwner(rule?["list"])), did)
  }

  public static func isForeignListRule(_ rule: JSONValue?, _ did: String) -> Bool {
    isForeignListRule(rule, .string(did))
  }

  /// Gates as they can go out from `did`: a threadgate may only name the
  /// writer's own lists, so list rules from another account come out. When
  /// they were all the rules there were, the gates go back to `did`'s
  /// default (custom false) rather than read as "nobody".
  public static func gatesForAccount(_ gates: JSONValue?, _ did: JSONValue?) -> AccountGates {
    guard let reply = gates?["reply"]?.arrayValue else { return AccountGates(gates: gates, dropped: 0) }
    let kept = reply.filter { !isForeignListRule($0, did) }
    let dropped = reply.count - kept.count
    if dropped == 0 { return AccountGates(gates: gates, dropped: 0) }
    var next = ComposerJS.spread(gates)
    if kept.isEmpty {
      next["custom"] = false
      next["reply"] = .null
      return AccountGates(gates: .object(next), dropped: dropped, reset: true)
    }
    next["reply"] = .array(kept)
    return AccountGates(gates: .object(next), dropped: dropped, reset: false)
  }

  public static func gatesForAccount(_ gates: JSONValue?, _ did: String) -> AccountGates {
    gatesForAccount(gates, .string(did))
  }

  /// The list rules in `reply` that none of `listUris` (the account's own
  /// lists) accounts for: another account's list, or one since deleted.
  public static func unlistedRules(_ reply: JSONValue?, _ listUris: [JSONValue] = []) -> [JSONValue] {
    guard let rules = reply?.arrayValue else { return [] }
    return rules.filter { rule in
      rule["type"] == "list" && !listUris.contains { ComposerJS.sameValueZero($0, rule["list"]) }
    }
  }

  public static func unlistedRules(_ reply: JSONValue?, _ listUris: [String]) -> [JSONValue] {
    unlistedRules(reply, listUris.map(JSONValue.string))
  }
}
