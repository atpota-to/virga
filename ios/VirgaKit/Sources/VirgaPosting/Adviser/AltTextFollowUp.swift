// Ports src/posting/adviser/altTextFollowUp.js
//
// Quick notes for revising a generated alt-text description, and the
// optional "what kind of image is it?" choice made before the first one
// (the alt-text dialog).
//
// A quick note travels two ways. Its sentence goes into the follow-up note,
// so the request is in words; its id goes alongside, so the server can drop
// the rule the sentence would otherwise argue with. The ids must match
// ALT_TEXT_PRESETS and ALT_TEXT_KINDS in server/ai/altTextPrompt.js.

import Foundation
import VirgaCore

/// A quick note: `{ id, label, hint?, sentence }`.
public struct AltTextQuickNote: Codable, Hashable, Sendable {
  public var id: String
  public var label: String
  public var hint: String?
  public var sentence: String
}

/// An image kind: `{ id, label, short, hint? }` (`short` is the phone's
/// one-row picker; `label` has room on a wider screen).
public struct AltTextImageKind: Codable, Hashable, Sendable {
  public var id: String
  public var label: String
  public var short: String
  public var hint: String?
}

/// One of rankQuickNotes' answers: `{ id, score }`.
public struct RankedQuickNote: Codable, Hashable, Sendable {
  public var id: String
  public var score: Double
}

public enum AltTextFollowUp {
  /// In the order they wrap on a phone: the long one first, so three rows
  /// hold all five and "It's a…".
  public static let altTextQuickNotes: [AltTextQuickNote] = [
    AltTextQuickNote(
      id: "describe", label: "Describe, don't transcribe", hint: "screenshots",
      sentence: "Describe what is shown and what is happening instead of transcribing the text."),
    AltTextQuickNote(id: "shorter", label: "Shorter", sentence: "Make it shorter."),
    AltTextQuickNote(
      id: "transcribe", label: "Transcribe the text", hint: "posters, notes",
      sentence: "Transcribe the text word for word."),
    AltTextQuickNote(id: "detail", label: "More detail", sentence: "Add more detail about what is visible."),
    AltTextQuickNote(id: "plain", label: "Plainer words", sentence: "Use plain, everyday words."),
  ]

  /// Pairs that can't both be asked for. Choosing one lets go of the other.
  static let opposites = ["describe": "transcribe", "transcribe": "describe", "shorter": "detail", "detail": "shorter"]

  /// The "It's a…" chip starts a correction in the author's own words.
  public static let itsA = "It's a "

  /// The server caps the whole note at 500 characters; the author's own
  /// words get 300.
  public static let altTextNoteMax = 300
  public static let altTextFollowUpMax = 500

  public static let altTextImageKinds: [AltTextImageKind] = [
    AltTextImageKind(id: "photo", label: "Photo", short: "Photo"),
    AltTextImageKind(
      id: "interface", label: "App or website", short: "App or site",
      hint: "Apps and websites are described, not read out word for word."),
    AltTextImageKind(
      id: "chart", label: "Chart or graph", short: "Chart", hint: "Charts are read for their trend and key values."),
    AltTextImageKind(id: "text", label: "Mostly text", short: "Text", hint: "The text is transcribed word for word."),
  ]

  static let noteIds = altTextQuickNotes.map(\.id)

  /// The selection after tapping `id`: on if it was off (letting go of its
  /// opposite), else off.
  public static func toggleQuickNote(_ selected: [String], _ id: String) -> [String] {
    guard noteIds.jsIncludes(id) else { return selected }
    if selected.jsIncludes(id) { return selected.filter { !$0.jsEquals(id) } }
    let opposite = opposites.jsValue(id)
    return noteIds.filter { n in n == id || (selected.jsIncludes(n) && n != opposite) }
  }

  /// Known quick-note ids, in list order.
  public static func quickNoteIds(_ selected: [String]) -> [String] {
    noteIds.filter { selected.jsIncludes($0) }
  }

  /// The follow-up note sent to the server: each chosen quick note's
  /// sentence, in list order, then the author's own words. Empty when
  /// there's nothing to send.
  public static func composeFollowUp(_ selected: [String], _ note: String?) -> String {
    let sentences = altTextQuickNotes.filter { selected.jsIncludes($0.id) }.map(\.sentence)
    let own = (note ?? "").jsTrimmed().jsSlice(0, altTextNoteMax)
    return (sentences + [own]).filter { !$0.isEmpty }.joined(separator: " ").jsSlice(0, altTextFollowUpMax)
  }

  /// Whether anything is waiting to be sent: a quick note or some words.
  public static func hasFollowUpDraft(_ selected: [String], _ note: String?) -> Bool {
    !selected.isEmpty || !(note ?? "").jsTrimmed().isEmpty
  }

  /// The note after tapping "It's a…": started, or added to what's there.
  public static func appendItsA(_ note: String?) -> String {
    let current = note ?? ""
    if current.jsTrimmed().isEmpty { return itsA }
    return "\(current.jsTrimmingEnd()) \(itsA)".jsSlice(0, altTextNoteMax)
  }

  /// For the "Revising: …" line: the chosen quick notes in lower case, and
  /// the note.
  public static func describeRequest(_ selected: [String], _ note: String?) -> String {
    let parts = altTextQuickNotes.filter { selected.jsIncludes($0.id) }.map { $0.label.jsLowercased() }
    let hasOwn = !(note ?? "").jsTrimmed().isEmpty
    if parts.isEmpty { return hasOwn ? "your note" : "" }
    return hasOwn ? "\(parts.joined(separator: ", ")), plus your note" : parts.joined(separator: ", ")
  }

  /// A known image kind, else nil.
  public static func normalizeImageKind(_ kind: JSONValue?) -> String? {
    guard let text = kind?.stringValue, altTextImageKinds.contains(where: { $0.id.jsEquals(text) }) else { return nil }
    return text
  }

  public static func normalizeImageKind(_ kind: String?) -> String? {
    normalizeImageKind(kind.map(JSONValue.string))
  }

  /// `/(?<=[.!?])\s+|\n+/`, for splitting a description into fragments.
  static let fragmentBreak = JSRegex("(?<=[.!?])[\(JSRegex.space)]+|\\n+")
  /// `/\s+/`.
  static let spaces = JSRegex("[\(JSRegex.space)]+")
  /// `/\w:\s/g`.
  static let labelPair = JSRegex("[A-Za-z0-9_]:[\(JSRegex.space)]")

  /// `text.split(regex)` for a regex that never matches empty: the pieces
  /// between its matches.
  static func split(_ text: String, _ regex: JSRegex) -> [String] {
    let units = Array(text.utf16)
    var pieces: [String] = []
    var from = 0
    for match in regex.matches(in: text) {
      pieces.append(String(jsUnits: units[from..<match.range.lowerBound]))
      from = match.range.upperBound
    }
    pieces.append(String(jsUnits: units[from...]))
    return pieces
  }

  /// Whether a description reads as a transcript of the image's text rather
  /// than a description of it: mostly short fragments ("Settings. Account.
  /// Display name: Sam.") or a run of "label: value" pairs. A heuristic, so
  /// it only ever decides which quick notes are offered, never what's sent.
  public static func looksTranscribed(_ text: String?) -> Bool {
    let source = text ?? ""
    let fragments = split(source, fragmentBreak).map { $0.jsTrimmed() }.filter { !$0.isEmpty }
    if fragments.count < 4 { return false }
    let short = fragments.filter { split($0, spaces).count <= 4 }.count
    let pairs = labelPair.matches(in: source).count
    return Double(short) / Double(fragments.count) >= 0.5 || pairs >= 3
  }

  /// The quick notes worth offering for a description, most useful first,
  /// with those that make no sense for it left out. Context is the
  /// description as it was generated, the kind of image the author chose,
  /// and the quick notes the last revision used. A score of 1 or more is
  /// worth a place on the card, the rest only in the sheet.
  public static func rankQuickNotes(text: String? = "", kind: String? = nil, lastAsked: [String] = [])
    -> [RankedQuickNote]
  {
    let length = Double((text ?? "").jsTrimmed().utf16.count)
    let transcript =
      lastAsked.jsIncludes("transcribe")
      || (!lastAsked.jsIncludes("describe") && (kind == "text" || looksTranscribed(text)))
    let transcribe: Double? =
      transcript || kind == "photo" || kind == "chart"
      ? nil : kind == "text" ? 2 : kind == "interface" ? 1.1 : 0.5
    let scores: [String: Double?] = [
      "describe": transcript ? 3 : nil,
      "transcribe": transcribe,
      "shorter": length < 100 ? nil : length > 350 ? 2.5 : length > 160 ? 1.5 : 0.5,
      "detail": length > 700 ? nil : length < 140 ? 2.5 : length < 400 ? 1.2 : 0.4,
      "plain": 1,
    ]
    let ranked: [(id: String, score: Double, index: Int)] = altTextQuickNotes.enumerated().compactMap { index, note in
      guard let score = scores[note.id] ?? nil else { return nil }
      return (note.id, score, index)
    }
    return ranked.sorted { a, b in a.score != b.score ? a.score > b.score : a.index < b.index }
      .map { RankedQuickNote(id: $0.id, score: $0.score) }
  }

  /// How many quick notes the card shows under the description.
  public static let cardQuickNotesCount = 3

  /// The few quick notes for the card: the best of the ranking, if they're
  /// good enough.
  public static func cardQuickNotes(_ ranked: [RankedQuickNote]) -> [String] {
    Array(ranked.filter { $0.score >= 1 }.prefix(cardQuickNotesCount).map(\.id))
  }
}
