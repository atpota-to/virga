// Ports src/posting/composer/threadEdits.js
//
// What the composer does to a thread as a whole: splitting one over-long
// post into several, putting a numbered thread's counters right, and the
// one step back from either. Each plan is a reducer action (ComposerModel)
// and what the undo has to remember; posts are named by id throughout, so a
// plan still means the same posts after the thread has moved.
//
//   undo = { kind: 'split', text, made: [{ id, text }] }
//        | { kind: 'renumber', before: { id: text }, made: [{ id, text }] }

import Foundation
import VirgaCore

/// A plan: the reducer action and what its undo remembers.
public struct ThreadPlan: Codable, Hashable, Sendable {
  public var action: ComposerAction
  public var undo: JSONValue
}

public enum ThreadEdits {
  static func textOf(_ post: JSONValue?) -> String { post?["text"]?.stringValue ?? "" }

  static func posts(_ value: JSONValue?) -> [JSONValue] { value?.arrayValue ?? [] }

  /// The texts post `id` would split into, or nil when it wouldn't split
  /// (it fits, or the thread is full). Counters count the whole thread; in
  /// a thread already numbered the post's own counter is replaced.
  public static func splitTexts(_ posts: JSONValue?, _ id: JSONValue?, numbering: ThreadNumbering = .off) -> [String]? {
    let list = self.posts(posts)
    guard let index = list.firstIndex(where: { ComposerJS.strictEquals($0["id"], id) }) else { return nil }
    let text = textOf(list[index])
    let renumbering = numbering == .counter && ThreadSplit.threadNumbering(list.map { textOf($0) }) != ThreadNumberingState.none
    let texts = ThreadSplit.splitIntoThread(
      renumbering ? ThreadSplit.stripCounter(text) : text,
      numbering: numbering,
      maxPosts: Double(ComposerModel.maxPosts - list.count + 1),
      before: index,
      after: list.count - index - 1)
    return texts.count > 1 ? texts : nil
  }

  public static func splitTexts(_ posts: [PostDraft], _ id: String, numbering: ThreadNumbering = .off) -> [String]? {
    splitTexts(.array(posts.map(\.json)), .string(id), numbering: numbering)
  }

  /// Splitting post `id`: the action and its undo, or nil when it wouldn't
  /// split. The post keeps its id and what it holds, and takes the first
  /// text; the rest are new posts after it.
  public static func planSplit(
    _ posts: JSONValue?, _ id: JSONValue?, numbering: ThreadNumbering = .off,
    emptyPost: () -> PostDraft = ComposerModel.emptyPost
  ) -> ThreadPlan? {
    guard let texts = splitTexts(posts, id, numbering: numbering) else { return nil }
    let rest: [JSONValue] = texts.dropFirst().map { text in
      var post = emptyPost().json
      post["text"] = .string(text)
      return post
    }
    var action: [String: JSONValue] = ["type": "splitPost", "text": .string(texts[0]), "rest": .array(rest)]
    if let id { action["id"] = id }
    let original = self.posts(posts).first { ComposerJS.strictEquals($0["id"], id) }
    var first: [String: JSONValue] = ["text": .string(texts[0])]
    if let id { first["id"] = id }
    let made: [JSONValue] = [.object(first)] + rest.map { ["id": $0["id"] ?? .null, "text": $0["text"] ?? ""] }
    return ThreadPlan(
      action: ComposerAction(json: .object(action)),
      undo: ["kind": "split", "text": .string(textOf(original)), "made": .array(made)])
  }

  public static func planSplit(_ posts: [PostDraft], _ id: String, numbering: ThreadNumbering = .off) -> ThreadPlan? {
    planSplit(.array(posts.map(\.json)), .string(id), numbering: numbering)
  }

  /// Setting every post's counter to its place, or nil when nothing would
  /// change.
  public static func planRenumber(_ posts: JSONValue?) -> ThreadPlan? {
    let list = self.posts(posts)
    let next = ThreadSplit.renumberThread(list.map { textOf($0) })
    if list.enumerated().allSatisfy({ textOf($1).jsEquals(next[$0]) }) { return nil }
    var texts: [String: JSONValue] = [:]
    var before: [String: JSONValue] = [:]
    for (i, post) in list.enumerated() {
      let key = post["id"]?.jsString ?? "undefined"
      texts[key] = .string(next[i])
      before[key] = .string(textOf(post))
    }
    let made: [JSONValue] = list.enumerated().map { i, post in
      var entry: [String: JSONValue] = ["text": .string(next[i])]
      if let id = post["id"] { entry["id"] = id }
      return .object(entry)
    }
    return ThreadPlan(
      action: ComposerAction(json: ["type": "setTexts", "texts": .object(texts)]),
      undo: ["kind": "renumber", "before": .object(before), "made": .array(made)])
  }

  public static func planRenumber(_ posts: [PostDraft]) -> ThreadPlan? { planRenumber(.array(posts.map(\.json))) }

  /// Whether `undo` can still be taken back in one step: the posts it made
  /// are all there, together, in order, with the words it gave them, and
  /// (after a split) nothing has been attached to the new ones.
  public static func undoStands(_ posts: JSONValue?, _ undo: JSONValue?) -> Bool {
    let list = self.posts(posts)
    guard let made = undo?["made"]?.arrayValue, !made.isEmpty else { return false }
    if undo?["kind"] == "renumber" && list.count != made.count { return false }
    guard let at = list.firstIndex(where: { ComposerJS.strictEquals($0["id"], made[0]["id"]) }) else { return false }
    return made.enumerated().allSatisfy { i, entry in
      guard at + i < list.count else { return false }
      let post = list[at + i]
      guard ComposerJS.strictEquals(post["id"], entry["id"]),
        ComposerJS.strictEquals(.string(textOf(post)), entry["text"])
      else { return false }
      let added = undo?["kind"] == "split" && i > 0
      return !added || !(ComposerJS.length(post["images"]) > 0 || ComposerJS.truthy(post["video"]))
    }
  }

  public static func undoStands(_ posts: [PostDraft], _ undo: JSONValue?) -> Bool {
    undoStands(.array(posts.map(\.json)), undo)
  }

  /// The reducer action that takes `undo` back.
  public static func undoAction(_ undo: JSONValue?) -> ComposerAction? {
    if undo?["kind"] == "split" {
      let made = undo?["made"]?.arrayValue ?? []
      var action: [String: JSONValue] = [
        "type": "unsplitPost", "remove": .array(made.dropFirst().map { $0["id"] ?? .null }),
      ]
      if let id = made.first?["id"] { action["id"] = id }
      if let text = undo?["text"] { action["text"] = text }
      return ComposerAction(json: .object(action))
    }
    if undo?["kind"] == "renumber" {
      var action: [String: JSONValue] = ["type": "setTexts"]
      if let before = undo?["before"] { action["texts"] = before }
      return ComposerAction(json: .object(action))
    }
    return nil
  }

  /// What the composer says it just did, beside Undo. `fmt` writes the count.
  public static func undoLine(_ undo: JSONValue?, fmt: (Int) -> String = { String($0) }) -> String {
    let n = fmt(ComposerJS.length(undo?["made"]))
    return undo?["kind"] == "renumber" ? "Renumbered \(n) posts." : "Split into \(n) posts."
  }
}
