// Ports src/posting/events.js
//
// The events the posting section speaks in. A service emits one after a
// write has succeeded; pages and the composer only listen. Every event's
// detail names the account it is about (`detail.did`), because more than one
// account can be signed in and a page must ignore the others.
//
//   virga:posting-settings   { did, settings }
//   virga:templates-changed  { did, templates }
//   virga:drafts-changed     { did, id, action }   action: created | updated | deleted
//   virga:scheduled-changed  { did, ... }
//   virga:timers-changed     { did, ... }
//   virga:posts-changed      { did, added, removed }  after a publish or a delete
//
// `added` is [{ uri, cid, record }] and `removed` is [uri]; the archive
// applies both for its own account.
//
// The web dispatches on `window`; here the window is `PostingEventBus.shared`
// (or any bus passed as `target`), with the same synchronous, in-order
// delivery an EventTarget gives.

import Foundation
import VirgaCore

/// `TypeError` with the web's message.
public struct PostingEventError: Error, LocalizedError, Hashable, Sendable {
  public let message: String
  public var errorDescription: String? { message }
}

/// Stops a listener: what `onPostingEvent` returns.
public typealias PostingEventUnsubscribe = @Sendable () -> Void

/// An EventTarget for posting events: listeners are called synchronously,
/// in the order they were added, on the emitting thread.
public final class PostingEventBus: Sendable {
  /// The app's bus (the web's `window`).
  public static let shared = PostingEventBus()

  public typealias Listener = @Sendable (_ detail: JSONValue) -> Void

  private struct Entry {
    var id: Int
    var name: String
    var listener: Listener
  }

  private struct State {
    var nextId = 0
    var entries: [Entry] = []
  }

  private let state = Locked(State())

  public init() {}

  /// `target.addEventListener(name, listener)`; returns an id for removal.
  @discardableResult
  public func addListener(_ name: String, _ listener: @escaping Listener) -> Int {
    state.withLock { state in
      state.nextId += 1
      state.entries.append(Entry(id: state.nextId, name: name, listener: listener))
      return state.nextId
    }
  }

  /// `target.removeEventListener(…)`.
  public func removeListener(_ id: Int) {
    state.withLock { $0.entries.removeAll { $0.id == id } }
  }

  /// `target.dispatchEvent(new CustomEvent(name, { detail }))`. A listener
  /// removed during the dispatch isn't called; one added isn't either.
  public func dispatch(_ name: String, _ detail: JSONValue) {
    let listeners = state.withLock { $0.entries.filter { $0.name.jsEquals(name) } }
    for entry in listeners {
      let stillThere = state.withLock { state in state.entries.contains { $0.id == entry.id } }
      if stillThere { entry.listener(detail) }
    }
  }

  /// How many listeners are registered for `name` (for tests).
  public func listenerCount(_ name: String) -> Int {
    state.withLock { $0.entries.filter { $0.name.jsEquals(name) }.count }
  }
}

public enum PostingEvents {
  public static let settings = "virga:posting-settings"
  public static let templates = "virga:templates-changed"
  public static let drafts = "virga:drafts-changed"
  public static let scheduled = "virga:scheduled-changed"
  public static let timers = "virga:timers-changed"
  public static let posts = "virga:posts-changed"

  /// POSTING_EVENTS.
  public static let postingEvents: [String: String] = [
    "settings": settings, "templates": templates, "drafts": drafts,
    "scheduled": scheduled, "timers": timers, "posts": posts,
  ]

  public static let postingSettingsEvent = settings
  public static let templatesChangedEvent = templates
  public static let draftsChangedEvent = drafts
  public static let scheduledChangedEvent = scheduled
  public static let timersChangedEvent = timers
  public static let postsChangedEvent = posts

  static let names = Set(postingEvents.values)

  static func checkName(_ name: String) throws {
    if !names.jsIncludes(name) { throw PostingEventError(message: "Not a posting event: \(name)") }
  }

  /// Emit `name` with `detail` on the shared bus (or `target`). Throws on an
  /// unknown name or a detail without a DID: both are mistakes in the
  /// caller. Returns false when there is nowhere to dispatch (`target` nil).
  @discardableResult
  public static func emitPostingEvent(
    _ name: String, _ detail: JSONValue?, target: PostingEventBus? = .shared
  ) throws -> Bool {
    try checkName(name)
    guard let detail, detail.isTruthy, let did = detail["did"]?.stringValue, !did.isEmpty else {
      throw PostingEventError(message: "\(name) needs detail.did")
    }
    guard let target else { return false }
    target.dispatch(name, detail)
    return true
  }

  /// Listen for `name`. `fn` gets the detail. With `did`, only that
  /// account's events reach it. Returns the function that stops listening.
  @discardableResult
  public static func onPostingEvent(
    _ name: String,
    did: String? = nil,
    target: PostingEventBus? = .shared,
    _ fn: @escaping @Sendable (JSONValue) -> Void
  ) throws -> PostingEventUnsubscribe {
    try checkName(name)
    guard let target else { return {} }
    let id = target.addListener(name) { detail in
      guard detail.isTruthy else { return }
      // `detail.did !== did`, by code unit.
      if let did, !did.isEmpty, !(detail["did"]?.stringValue).jsEquals(did) { return }
      fn(detail)
    }
    return { target.removeListener(id) }
  }

  /// The events for `name` as an async sequence, ending when the stream's
  /// consumer goes away.
  public static func postingEvents(
    _ name: String, did: String? = nil, target: PostingEventBus = .shared
  ) throws -> AsyncStream<JSONValue> {
    try checkName(name)
    let (stream, continuation) = AsyncStream<JSONValue>.makeStream()
    let stop = try onPostingEvent(name, did: did, target: target) { continuation.yield($0) }
    continuation.onTermination = { _ in stop() }
    return stream
  }

  /// `virga:posts-changed` for `did`, with `added` and `removed` always
  /// arrays so a listener never has to guard them. Rows without a URI are
  /// dropped.
  @discardableResult
  public static func emitPostsChanged(
    _ did: String?,
    added: [JSONValue]? = [],
    removed: [JSONValue]? = [],
    target: PostingEventBus? = .shared
  ) throws -> Bool {
    let addedRows: [JSONValue] = (added ?? []).compactMap { p in
      guard p.isTruthy, let uri = p["uri"]?.stringValue, !uri.isEmpty else { return nil }
      let cid = p["cid"].flatMap { $0.isTruthy ? $0 : nil } ?? .null
      let record = p["record"].flatMap { $0.isTruthy ? $0 : nil } ?? .null
      return ["uri": .string(uri), "cid": cid, "record": record]
    }
    let removedRows = (removed ?? []).filter { $0.stringValue.map { !$0.isEmpty } ?? false }
    var detail: [String: JSONValue] = ["added": .array(addedRows), "removed": .array(removedRows)]
    detail["did"] = did.map(JSONValue.string)
    return try emitPostingEvent(posts, .object(detail), target: target)
  }
}
