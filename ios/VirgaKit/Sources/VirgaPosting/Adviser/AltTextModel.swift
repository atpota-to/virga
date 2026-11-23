// Ports src/posting/adviser/altTextModel.js
//
// The alt-text dialog's decisions, kept pure: the length limit, what a
// description or a revision asks the server for, what the dialog holds after
// an answer, and the allowance line.

import Foundation
import VirgaCore

/// The count under the field: `{ count, over, label }` ("120 of 2,000").
public struct AltTextCount: Codable, Hashable, Sendable {
  public var count: Int
  public var over: Bool
  public var label: String
}

/// What generateAltTextForFile is asked for (its payload, less the image):
/// `{ kind?, context?, followUp?, previousAltText?, presets? }`.
public struct AltGenerationRequest: Codable, Hashable, Sendable {
  public var kind: String?
  public var context: String?
  public var followUp: String?
  public var previousAltText: String?
  public var presets: [String]?

  /// The request as the payload AIService.generateAltTextForFile takes.
  public var json: JSONValue { (try? JSONValue(encoding: self)) ?? [:] }
}

/// What the dialog holds once a description comes back.
public struct AltGenerationResult: Codable, Hashable, Sendable {
  /// The new text.
  public var alt: String
  /// The text it replaced, for Undo; nil when that was empty.
  public var undo: String?
  /// The description the quick notes are ranked against.
  public var rankedAgainst: String
  /// What the last revision asked for.
  public var lastAsked: [String]
  public var revised: Bool

  public var json: JSONValue {
    [
      "alt": .string(alt), "undo": undo.map(JSONValue.string) ?? .null, "rankedAgainst": .string(rankedAgainst),
      "lastAsked": .array(lastAsked.map(JSONValue.string)), "revised": .bool(revised),
    ]
  }
}

public enum AltTextModel {
  /// Bluesky's limit on an image's description.
  public static let altTextMaxGraphemes = 2000

  /// The server clips a description to this, so a longer one never comes back.
  public static let generatedAltMax = 1000

  /// The post's text sent along as context, at most.
  public static let altContextMax = 500

  /// The count under the field, in `locale` (by default the active one).
  public static func altTextCount(_ text: JSONValue?, locale: String? = nil) -> AltTextCount {
    let count = Graphemes.countGraphemes(ComposerJS.truthy(text) ? text!.jsString : "")
    let locale = locale ?? AppLocale.activeLocale()
    return AltTextCount(
      count: count, over: count > altTextMaxGraphemes,
      label: "\(AppLocale.formatNumber(count, locale: locale)) of \(AppLocale.formatNumber(altTextMaxGraphemes, locale: locale))")
  }

  public static func altTextCount(_ text: String?, locale: String? = nil) -> AltTextCount {
    altTextCount(text.map(JSONValue.string), locale: locale)
  }

  /// `String(v || '')`.
  static func text(_ value: JSONValue?) -> String {
    ComposerJS.truthy(value) ? value!.jsString : ""
  }

  /// What generateAltTextForFile is asked for. 'describe' writes a first
  /// description; 'revise' sends the writer's notes against the text in the
  /// field (`alt`). Nil when a revision has nothing to say.
  public static func altGenerationRequest(
    mode: String?, alt: JSONValue? = "", selected: [String] = [], note: String? = "", kind: JSONValue? = nil,
    context: JSONValue? = ""
  ) -> AltGenerationRequest? {
    var opts = AltGenerationRequest()
    if let k = AltTextFollowUp.normalizeImageKind(kind) { opts.kind = k }
    let ctx = text(context).jsTrimmed()
    if !ctx.isEmpty { opts.context = ctx.jsSlice(0, altContextMax) }
    if mode != "revise" { return opts }
    let followUp = AltTextFollowUp.composeFollowUp(selected, note)
    if followUp.isEmpty { return nil }
    let previous = text(alt).jsTrimmed()
    opts.followUp = followUp
    if !previous.isEmpty { opts.previousAltText = previous }
    opts.presets = AltTextFollowUp.quickNoteIds(selected)
    return opts
  }

  /// What the dialog holds once a description comes back: nil for an empty
  /// answer, which leaves everything as it was.
  public static func afterGeneration(
    before: String? = "", generated: JSONValue? = "", mode: String?, selected: [String] = []
  ) -> AltGenerationResult? {
    let alt = text(generated).jsTrimmed().jsSlice(0, generatedAltMax)
    if alt.isEmpty { return nil }
    let undo = (before ?? "").jsTrimmed().isEmpty ? nil : before
    return AltGenerationResult(
      alt: alt, undo: undo, rankedAgainst: alt,
      lastAsked: mode == "revise" ? AltTextFollowUp.quickNoteIds(selected) : [], revised: mode == "revise")
  }

  /// "Revising: shorter, plus your note", for the busy line.
  public static func revisingLine(_ selected: [String], _ note: String?) -> String {
    let what = AltTextFollowUp.describeRequest(selected, note)
    return what.isEmpty ? "Revising" : "Revising: \(what)"
  }

  /// The month's descriptions in a sentence, or ''.
  public static func altTextUsageLine(_ usage: JSONValue?, now: Double, locale: String? = nil) -> String {
    let line = AdviserUsageStore.adviserUsageLine(usage, feature: .altText, now: now, locale: locale)
    if line.isEmpty { return "" }
    let limit = usage?["limit"].truthy?.jsNumber ?? 0
    let used = usage?["used"].truthy?.jsNumber ?? 0
    return Swift.max(0, limit - used) > 0 ? "\(line) Each revision uses one." : line
  }

  public static func altTextUsageLine(_ usage: AdviserUsage?, now: Double, locale: String? = nil) -> String {
    altTextUsageLine(usage?.json, now: now, locale: locale)
  }
}
