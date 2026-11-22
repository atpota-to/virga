// Ports src/posting/schedule/publishActions.js
//
// The composer's split button: post now, schedule, add to the weekly queue,
// or save a draft. The account's `defaultAction` (posting settings) picks
// the primary half; the others sit under the caret. Shared by the composer
// and Settings › Posting.

import Foundation
import VirgaCore

/// An entry of the caret menu and the settings control: `{ value, label }`.
public struct PublishActionOption: Codable, Hashable, Sendable {
  public var value: String
  public var label: String
}

public enum PublishActions {
  /// PUBLISH_ACTIONS.
  public static let post = "post"
  public static let schedule = "schedule"
  public static let queue = "queue"
  public static let draft = "draft"

  public static let defaultPublishAction = post

  /// Order and words for both the caret menu and the settings control.
  public static let publishActionOptions = [
    PublishActionOption(value: post, label: "Post now"),
    PublishActionOption(value: schedule, label: "Schedule"),
    PublishActionOption(value: queue, label: "Add to queue"),
    PublishActionOption(value: draft, label: "Save draft"),
  ]

  /// Why "Add to queue" is off when the weekly schedule has no times.
  public static let emptyQueueHint =
    "Add some times to your weekly schedule first, in Posting › Weekly schedule."

  /// Why Schedule and Add to queue are off on an account without a long session.
  public static let needsBackendHintText =
    "Scheduling needs a long session. Reconnect this account through Virga’s server."

  /// The same, in a build that only signs in through the browser.
  public static let noBackendHint = "Scheduling needs a long session, which this copy of Virga doesn’t offer."

  /// Why "Add to queue" is off for a reply: it can still be scheduled for a time.
  public static let queueReplyHint = "A reply can’t wait in the queue. Schedule it for a set time instead."
  public static let videoHint = "Posts with video can’t be scheduled. Post it now instead."

  /// Why scheduling is off for an account without a long session, for the
  /// build's sign-in (`authMode`, the session's): only a build that offers
  /// Virga's server ('backend') can be told to reconnect through it.
  public static func needsBackendHint(_ authMode: JSONValue? = nil) -> String {
    let mode = authMode ?? "backend"
    return mode == .string("backend") ? needsBackendHintText : noBackendHint
  }

  public static func needsBackendHint(_ authMode: String) -> String { needsBackendHint(.string(authMode)) }

  /// A stored or unknown value as a real action ('post' for anything else).
  public static func normalizePublishAction(_ value: JSONValue?) -> String {
    // Anisota's settings call posting now 'publish'.
    guard let text = value?.stringValue else { return defaultPublishAction }
    if text.jsEquals("publish") { return post }
    return publishActionOptions.contains { $0.value.jsEquals(text) } ? text : defaultPublishAction
  }

  public static func normalizePublishAction(_ value: String?) -> String {
    normalizePublishAction(value.map(JSONValue.string))
  }

  public static func getPublishActionLabel(_ action: JSONValue?) -> String {
    let normalized = normalizePublishAction(action)
    return publishActionOptions.first { $0.value.jsEquals(normalized) }!.label
  }

  public static func getPublishActionLabel(_ action: String?) -> String {
    getPublishActionLabel(action.map(JSONValue.string))
  }

  /// Why this post can't be scheduled or queued at all, or nil when it can:
  /// the account has no long session, or the post carries a video. A reply
  /// can be scheduled for a set time; only the queue refuses it.
  public static func scheduleBlockReason(canSchedule: Bool = true, video: Bool = false, authMode: JSONValue? = nil)
    -> String?
  {
    if !canSchedule { return needsBackendHint(authMode) }
    if video { return videoHint }
    return nil
  }

  /// Why this post can't go in the weekly queue though it could be
  /// scheduled, or nil.
  public static func queueBlockReason(reply: Bool = false) -> String? {
    reply ? queueReplyHint : nil
  }

  /// Which action the primary half performs for this post. When the
  /// preferred one can't happen here, it falls back to posting now. An
  /// empty weekly schedule deliberately doesn't fall back (Add to queue
  /// stays primary, disabled with emptyQueueHint).
  public static func resolvePrimaryPublishAction(
    preferred: JSONValue?, canSchedule: Bool = false, canSaveDraft: Bool = false
  ) -> String {
    let wanted = normalizePublishAction(preferred)
    if (wanted == schedule || wanted == queue) && !canSchedule { return defaultPublishAction }
    if wanted == draft && !canSaveDraft { return defaultPublishAction }
    return wanted
  }

  /// Why an action can't run right now, or nil when it can.
  /// `scheduleBlock` is scheduleBlockReason's answer, `queueBlock`
  /// queueBlockReason's.
  public static func publishActionBlockReason(
    _ action: JSONValue?, queueEmpty: Bool = false, scheduleBlock: String? = nil, queueBlock: String? = nil
  ) -> String? {
    let normalized = normalizePublishAction(action)
    if normalized == schedule || normalized == queue {
      if let scheduleBlock, !scheduleBlock.isEmpty { return scheduleBlock }
      if normalized == queue, let queueBlock, !queueBlock.isEmpty { return queueBlock }
      if normalized == queue && queueEmpty { return emptyQueueHint }
    }
    return nil
  }
}
