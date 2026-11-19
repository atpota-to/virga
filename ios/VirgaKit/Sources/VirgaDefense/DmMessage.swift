// Ports src/defense/dmMessage.js
//
// A DM to the moderator, read the same way on both sides: the worker on the
// droplet, which reads the moderator's DMs, and Vercel, which reads each one
// back with its own key before acting on it (docs/DEFENSE-THREATS.md, rule
// 16). A message and a conversation are chat.bsky views, read as loosely as
// the web reads them, so they come in as JSON.

import Foundation
import VirgaCore

public enum DmMessage {
  static let direct = "chat.bsky.convo.defs#directConvo"

  /// The record a message shares (a post, or anything else), as an at:// URI, or nil.
  public static func sharedUri(_ message: JSONValue?) -> String? {
    let record = message?["embed"]?["record"]
    let first = record?["uri"]
    let uri = (first == nil || first == .null) ? record?["record"]?["uri"] : first
    guard let text = uri?.stringValue, text.jsStartsWith("at://") else { return nil }
    return text
  }

  /// Whether a conversation is one to one, by its kind or, failing that, its members.
  public static func isDirect(_ convo: JSONValue?) -> Bool {
    if let kind = convo?["kind"]?["$type"], kind.isTruthy {
      return kind.stringValue?.jsEquals(direct) ?? false
    }
    return convo?["members"]?.arrayValue?.count == 2
  }

  /// What a model is given of the owner's message: what they typed, plus
  /// the record they shared, the full links and the mentioned DIDs. Those
  /// lines are built by code from the owner's own message. Throws where
  /// `Command.facetLinks` does: a message whose facets can't be iterated.
  public static func composeMessage(_ message: JSONValue?) throws(NotIterableError) -> String {
    let typed = message?["text"]
    let text = typed.map { $0.isTruthy ? $0.jsString : "" } ?? ""
    var extra: [String] = []
    if let shared = sharedUri(message) { extra.append("The post the owner shared: \(shared)") }
    let links = try Command.facetLinks(message).filter { !text.jsIncludes($0) }
    if !links.isEmpty { extra.append("Full links in that message: \(links.joined(separator: " "))") }
    let mentions = try Command.facetMentions(message)
    if !mentions.isEmpty { extra.append("Accounts mentioned: \(mentions.joined(separator: " "))") }
    return extra.isEmpty ? text : "\(text)\n\n[\(extra.joined(separator: ". "))]"
  }

  public enum Answer: String, Codable, Hashable, Sendable {
    case yes, no
  }

  static let yesWords = [
    "yes", "y", "yep", "yeah", "yup", "ok", "okay", "sure", "do it", "go ahead", "go on", "please do", "confirm",
  ]
  static let noWords = ["no", "n", "nope", "dont", "don't", "do not", "cancel", "stop", "nevermind", "never mind"]

  /// The emoji, alone or with one skin tone (U+1F3FB to U+1F3FF).
  static func isEmoji(_ text: String, _ base: Unicode.Scalar) -> Bool {
    let scalars = Array(text.unicodeScalars)
    guard scalars.first == base else { return false }
    return scalars.count == 1 || (scalars.count == 2 && (0x1F3FB...0x1F3FF).contains(scalars[1].value))
  }

  /// A yes, a no, or neither (nil), to a question the moderator asked.
  public static func answerTo(_ text: String?) -> Answer? {
    let t = (text ?? "").jsTrimmed().jsLowercased()
      .droppingTrailing { $0 == "." || $0 == "!" || JSWhitespace.contains($0) }
    if yesWords.jsContains(t) || isEmoji(t, "\u{1F44D}") { return .yes }
    if noWords.jsContains(t) || isEmoji(t, "\u{1F44E}") { return .no }
    return nil
  }
}
