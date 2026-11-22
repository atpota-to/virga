// Ports src/posting/adviser/setup.js
//
// The adviser's setup for one account (posting settings `adviser`): its
// defaults, a normalizer every reader runs, and turning it on from the
// settings page or the posting hub, which must leave it in the same state.
// The shape is the one the server's /api/ai/analyze-post reads from.

import Foundation
import VirgaCore

/// The topic limit: `{ enabled, topic }`.
public struct AdviserTopicLimit: Codable, Hashable, Sendable {
  public var enabled: Bool
  public var topic: String
}

/// The general goals: `{ reduceNegativity, lessConfrontational, limitTopic }`.
public struct AdviserPresets: Codable, Hashable, Sendable {
  public var reduceNegativity: Bool
  public var lessConfrontational: Bool
  public var limitTopic: AdviserTopicLimit
}

/// `{ presets, customText }`.
public struct AdviserGoals: Codable, Hashable, Sendable {
  public var presets: AdviserPresets
  public var customText: String
}

/// The learned style: `{ summary, analyzedCount, updatedAt, guidance }`.
public struct AdviserStyleProfile: Codable, Hashable, Sendable {
  public var summary: String
  public var analyzedCount: Double
  public var updatedAt: String
  public var guidance: String
}

/// `{ typos, grammar, clarity, customText, styleSampleSize, styleProfile }`.
public struct AdviserWritingChecks: Codable, Hashable, Sendable {
  public var typos: Bool
  public var grammar: Bool
  public var clarity: Bool
  public var customText: String
  public var styleSampleSize: Int
  public var styleProfile: AdviserStyleProfile
}

/// The adviser setup with every field present (normalizeAdviserSettings').
public struct AdviserSettings: Codable, Hashable, Sendable {
  public var enabled: Bool
  public var checkBeforePublish: Bool
  /// 'significant' | 'always'.
  public var reviewMode: String
  /// 'all' | 'topLevel' | 'replies'.
  public var checkScope: String
  public var checkReplyContext: Bool
  public var goals: AdviserGoals
  public var writingChecks: AdviserWritingChecks

  /// The setup as the web's object.
  public var json: JSONValue { (try? JSONValue(encoding: self)) ?? [:] }
}

public enum AdviserSetup {
  public static let reviewModes = ["significant", "always"]

  /// How many recent posts a style profile may be learned from.
  public static let styleSampleSizes = [100, 250, 500]
  public static let defaultStyleSampleSize = 100

  /// The input limits the settings controls set.
  public static let adviserTextLimits: [String: Int] = [
    "topic": 200, "goalsText": 500, "writingNotes": 500, "styleSummary": 1500, "styleGuidance": 500,
  ]

  /// Off, with nothing chosen.
  public static let defaultAdviserSettings = AdviserSettings(
    enabled: false, checkBeforePublish: false, reviewMode: "significant", checkScope: "all",
    checkReplyContext: false,
    goals: AdviserGoals(
      presets: AdviserPresets(
        reduceNegativity: false, lessConfrontational: false, limitTopic: AdviserTopicLimit(enabled: false, topic: "")),
      customText: ""),
    writingChecks: AdviserWritingChecks(
      typos: false, grammar: false, clarity: false, customText: "", styleSampleSize: defaultStyleSampleSize,
      styleProfile: AdviserStyleProfile(summary: "", analyzedCount: 0, updatedAt: "", guidance: "")))

  static func bool(_ value: JSONValue?) -> Bool { value == .bool(true) }

  static func text(_ value: JSONValue?, _ max: Int) -> String {
    value?.stringValue?.jsSlice(0, max) ?? ""
  }

  static func object(_ value: JSONValue?) -> JSONValue { ComposerJS.isObject(value) ? value! : [:] }

  /// A sample size from the allowed few, else the default.
  public static func normalizeStyleSampleSize(_ value: JSONValue?) -> Int {
    let n = value.jsNumber
    return styleSampleSizes.first { Double($0) == n } ?? defaultStyleSampleSize
  }

  static func normalizeStyleProfile(_ raw: JSONValue?) -> AdviserStyleProfile {
    let src = object(raw)
    let count = src["analyzedCount"].jsNumber.rounded(.down)
    return AdviserStyleProfile(
      summary: text(src["summary"], adviserTextLimits["styleSummary"]!),
      analyzedCount: count.isFinite && count > 0 ? count : 0,
      updatedAt: src["updatedAt"]?.stringValue ?? "",
      guidance: text(src["guidance"], adviserTextLimits["styleGuidance"]!))
  }

  /// The adviser setup with every field present and of the right kind:
  /// anything missing or unreadable reads as its default. Text is clipped
  /// to the settings' input limits.
  public static func normalizeAdviserSettings(_ raw: JSONValue?) -> AdviserSettings {
    let src = object(raw)
    let goals = object(src["goals"])
    let presets = object(goals["presets"])
    let topic = object(presets["limitTopic"])
    let writing = object(src["writingChecks"])
    return AdviserSettings(
      enabled: bool(src["enabled"]),
      checkBeforePublish: bool(src["checkBeforePublish"]),
      reviewMode: ComposerJS.includes(reviewModes, src["reviewMode"]) ? src["reviewMode"]!.stringValue! : "significant",
      checkScope: AdviserAnalysis.normalizeAdviserScope(src["checkScope"]),
      checkReplyContext: bool(src["checkReplyContext"]),
      goals: AdviserGoals(
        presets: AdviserPresets(
          reduceNegativity: bool(presets["reduceNegativity"]),
          lessConfrontational: bool(presets["lessConfrontational"]),
          limitTopic: AdviserTopicLimit(
            enabled: bool(topic["enabled"]), topic: text(topic["topic"], adviserTextLimits["topic"]!))),
        customText: text(goals["customText"], adviserTextLimits["goalsText"]!)),
      writingChecks: AdviserWritingChecks(
        typos: bool(writing["typos"]),
        grammar: bool(writing["grammar"]),
        clarity: bool(writing["clarity"]),
        customText: text(writing["customText"], adviserTextLimits["writingNotes"]!),
        styleSampleSize: normalizeStyleSampleSize(writing["styleSampleSize"]),
        styleProfile: normalizeStyleProfile(writing["styleProfile"])))
  }

  public static func normalizeAdviserSettings(_ raw: AdviserSettings) -> AdviserSettings {
    normalizeAdviserSettings(raw.json)
  }

  /// `a || {}` for a member.
  static func orEmpty(_ value: JSONValue?) -> JSONValue { ComposerJS.or(value, [:]) ?? [:] }

  /// `(v || '').trim()` is empty.
  static func blank(_ value: JSONValue?) -> Bool { ComposerJS.trimmed(ComposerJS.or(value, "")).isEmpty }

  /// True when the adviser has never been configured (no checks, goals or
  /// writing checks), so seeding it won't overwrite a choice.
  public static func isPostingAdviserPristine(_ adviser: JSONValue?) -> Bool {
    let a = orEmpty(adviser)
    let goals = orEmpty(a["goals"])
    let presets = orEmpty(goals["presets"])
    let writing = orEmpty(a["writingChecks"])
    let t = ComposerJS.truthy
    return !t(a["checkBeforePublish"]) && !t(a["checkReplyContext"]) && !t(presets["reduceNegativity"])
      && !t(presets["lessConfrontational"]) && !(t(presets["limitTopic"]) && t(presets["limitTopic"]?["enabled"]))
      && blank(goals["customText"]) && !t(writing["typos"]) && !t(writing["grammar"]) && !t(writing["clarity"])
      && blank(writing["customText"]) && blank(writing["styleProfile"]?["summary"])
      && blank(writing["styleProfile"]?["guidance"])
  }

  /// The full seeded setup: every switch on; anything that needs the
  /// writer's own words stays untouched.
  static func seededPostingAdviserState(_ current: JSONValue) -> JSONValue {
    let goals = orEmpty(current["goals"])
    let presets = orEmpty(goals["presets"])
    var nextPresets = ComposerJS.spread(presets)
    nextPresets["reduceNegativity"] = true
    nextPresets["lessConfrontational"] = true
    var nextGoals = ComposerJS.spread(goals)
    nextGoals["presets"] = .object(nextPresets)
    var writing = ComposerJS.spread(orEmpty(current["writingChecks"]))
    writing["typos"] = true
    writing["grammar"] = true
    writing["clarity"] = true
    var out = ComposerJS.spread(current)
    out["enabled"] = true
    out["checkBeforePublish"] = true
    out["checkReplyContext"] = true
    out["reviewMode"] = "significant"
    out["checkScope"] = "all"
    out["goals"] = .object(nextGoals)
    out["writingChecks"] = .object(writing)
    return .object(out)
  }

  /// The next setup for a press of the on/off switch. The first time it is
  /// turned on, a setup nobody has touched gets the full recommended one;
  /// after that it just toggles.
  public static func nextPostingAdviserState(_ adviser: JSONValue?) -> JSONValue {
    let current = orEmpty(adviser)
    if ComposerJS.truthy(current["enabled"]) || !isPostingAdviserPristine(current) {
      var out = ComposerJS.spread(current)
      out["enabled"] = .bool(!ComposerJS.truthy(current["enabled"]))
      return .object(out)
    }
    return seededPostingAdviserState(current)
  }
}
