// Ports src/posting/adviser/sheetView.js
//
// The adviser sheet's words and buttons, decided from the read the
// controller hands it (AdviserGateController's `sheet`, as its JSON). Pure.

import Foundation
import VirgaCore
import VirgaNetwork

/// The sheet's footer: `{ closeOnly, publish: { label } | null, draft, primary }`.
public struct AdviserSheetActions: Codable, Hashable, Sendable {
  public struct Publish: Codable, Hashable, Sendable {
    public var label: String
  }

  public var closeOnly: Bool
  public var publish: Publish?
  public var draft: Bool
  /// 'edit' | 'publish'.
  public var primary: String

  public var json: JSONValue {
    [
      "closeOnly": .bool(closeOnly), "publish": publish.map { ["label": .string($0.label)] } ?? .null,
      "draft": .bool(draft), "primary": .string(primary),
    ]
  }
}

public enum AdviserSheetView {
  public static let verdictCopy = [
    "ok": "No issues with your goals",
    "caution": "Worth a second look",
    "conflict": "Goes against a goal you set",
  ]

  /// What a flagged goal's row says after its name.
  public static let statusWords = ["conflict": "goes against it", "caution": "worth a look"]

  public static let writingTypeLabels = ["typo": "Typo", "grammar": "Grammar", "clarity": "Clarity"]

  /// The sheet's title.
  public static func sheetTitle(_ read: JSONValue?) -> String {
    read?["mode"]?.stringValue == "gate" ? "Before this goes out" : "Post adviser"
  }

  /// Whether the read found anything: a goal flagged, or a writing issue
  /// left (`taken` holds the keys of fixes already taken).
  public static func readFoundSomething(_ model: AdviserSheetModel?, _ taken: [String] = []) -> Bool {
    readFoundSomething(model) { taken.jsIncludes($0) }
  }

  static func readFoundSomething(_ model: AdviserSheetModel?, taken: (String) -> Bool) -> Bool {
    guard let model else { return false }
    if model.verdict == "conflict" || model.verdict == "caution" { return true }
    if model.writingNoteCount > 0 { return true }
    return model.fixes.contains { !taken($0.key) }
  }

  /// `(read.taken || []).includes(key)`: a list's members by `===`, a
  /// string's text by substring, as `includes` reads either.
  static func takenIncludes(_ read: JSONValue?) -> (String) -> Bool {
    switch read?["taken"].truthy {
    case .array(let items)?: return { key in items.contains { $0.stringValue?.jsEquals(key) == true } }
    case .string(let text)?: return { key in text.jsIndexOf(key) != -1 }
    default: return { _ in false }
    }
  }

  /// The sheet's footer. Keep editing is always there; Save as draft and
  /// Publish when the sheet offers them. The primary button leans to Keep
  /// editing when the post goes against a goal, else to publishing. A sheet
  /// with nothing read has a single Close.
  public static func sheetActions(_ read: JSONValue?, canPublish: Bool = true, canSaveDraft: Bool = true)
    -> AdviserSheetActions
  {
    let status = read?["status"]?.stringValue
    if status != "ready" && status != "error" {
      return AdviserSheetActions(closeOnly: true, publish: nil, draft: false, primary: "edit")
    }
    let verdict = status == "ready" ? AdviserSheet.adviserVerdict(read?["result"]) : nil
    let model =
      status == "ready" ? AdviserSheet.adviserSheetModel(read?["result"], read?["posts"].truthy ?? []) : nil
    let found = status == "error" || readFoundSomething(model, taken: takenIncludes(read))
    return AdviserSheetActions(
      closeOnly: false,
      publish: canPublish ? AdviserSheetActions.Publish(label: found ? "Publish anyway" : "Publish") : nil,
      draft: canSaveDraft,
      primary: verdict == "conflict" || !canPublish ? "edit" : "publish")
  }

  /// The line saying what the post was read alongside, or a hint to turn
  /// reading the room on for a reply or a quote. '' when neither applies.
  public static func sheetContextLine(_ read: JSONValue?) -> String {
    guard let read, read.isTruthy, read["status"]?.stringValue == "ready" else { return "" }
    let kind = read["contextKind"]
    let thread = read["context"]?["thread"].truthy ?? []
    let length = lengthOf(thread)
    if kind?.isTruthy == true, let length, length.isTruthy {
      let kind = kind?.stringValue
      let one = length == .number(1)
      let count = length.jsString
      if kind == "quote" { return "Read with the post you’re quoting." }
      if kind == "selfReply" {
        return one ? "Read with your post above it." : "Read with the \(count) posts of yours above it."
      }
      return one
        ? "Read with the post you’re replying to."
        : "Read with the conversation: \(count) posts, up to the one you’re replying to."
    }
    let scenario = read["scenario"]?.stringValue
    if !(read["readTheRoom"]?.isTruthy ?? false) && (scenario == "reply" || scenario == "quote") {
      return
        "Replies and quotes can be read with the posts they answer. Turn on “Read replies with their conversation” in Settings › Posting."
    }
    return ""
  }

  /// `value.length` as JavaScript reads it: an array's count, a string's
  /// code units, an object's own `length` member (nil when it has none, or
  /// for any other value).
  static func lengthOf(_ value: JSONValue?) -> JSONValue? {
    switch value {
    case .array(let items)?: return .number(Double(items.count))
    case .string(let text)?: return .number(Double(text.utf16.count))
    case .object(let members)?: return members.jsValue("length")
    default: return nil
    }
  }

  /// "1/3" before each post of a thread; '' for a single post.
  public static func postIndexLabel(_ index: Double, _ total: Double) -> String {
    total > 1 ? "\(JSNumber.format(index + 1))/\(JSNumber.format(total))" : ""
  }

  public static func postIndexLabel(_ index: Int, _ total: Int) -> String {
    postIndexLabel(Double(index), Double(total))
  }

  /// The tally's button: "Fix it", or "Fix all 3".
  public static func fixAllLabel(_ remaining: Double) -> String {
    remaining == 1 ? "Fix it" : "Fix all \(JSNumber.format(remaining))"
  }

  public static func fixAllLabel(_ remaining: Int) -> String { fixAllLabel(Double(remaining)) }
}
