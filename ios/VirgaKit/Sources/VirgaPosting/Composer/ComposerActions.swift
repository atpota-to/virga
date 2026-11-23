// Ports src/posting/composer/actions.js
//
// The composer's split button: which action the primary half runs, and for
// each of post now, schedule, add to queue and save draft whether it can
// run and, when it can't, the sentence that says why. Pure: the composer
// passes what it knows about the post and the account.

import Foundation
import VirgaCore
import VirgaSession

/// Facts about the post the actions depend on.
public struct PostFacts: Codable, Hashable, Sendable {
  public var hasContent: Bool
  public var overLimit: Bool
  public var overDraftLimit: Bool
  public var hasVideo: Bool
  public var videoPending: Bool
  public var reply: Bool
  public var thread: Bool
  public var editingScheduled: Bool
}

/// Whether an action can run: `{ disabled, reason }` (reason null when it can).
public struct ComposerActionState: Codable, Hashable, Sendable {
  public var disabled: Bool
  public var reason: String?

  /// Public, so the composer's SwiftUI (another module) can make one.
  public init(disabled: Bool, reason: String? = nil) {
    self.disabled = disabled
    self.reason = reason
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(disabled, forKey: .disabled)
    try container.encode(reason, forKey: .reason)
  }
}

/// The four actions, keyed as the web keys them (post, schedule, queue, draft).
public struct ComposerActionStates: Codable, Hashable, Sendable {
  public var post: ComposerActionState
  public var schedule: ComposerActionState
  public var queue: ComposerActionState
  public var draft: ComposerActionState

  public subscript(action: String) -> ComposerActionState {
    switch action {
    case PublishActions.schedule: return schedule
    case PublishActions.queue: return queue
    case PublishActions.draft: return draft
    default: return post
    }
  }
}

/// composerActions' answer: `{ primary, draftFallback, actions, facts }`.
public struct ComposerActionSet: Codable, Hashable, Sendable {
  public var primary: String
  public var draftFallback: Bool
  public var actions: ComposerActionStates
  public var facts: PostFacts
}

/// What the account can do: `{ canPost, canSchedule }`.
public struct ComposerCaps: Codable, Hashable, Sendable {
  /// nil reads as true (`caps.canPost !== false`).
  public var canPost: Bool?
  public var canSchedule: Bool

  public init(canPost: Bool? = nil, canSchedule: Bool = false) {
    self.canPost = canPost
    self.canSchedule = canSchedule
  }
}

public enum ComposerActions {
  /// Bluesky's drafts keep up to 1000 graphemes a post, so a post over the
  /// posting limit can still be saved.
  public static let draftMaxGraphemes = 1000

  public static let overLimitHint =
    "A post is over 300 characters. Shorten it, split it into a thread, or save it as a draft."
  public static let emptyHint = "Write something first."
  public static let videoPendingHint = "Wait for the video to finish uploading."
  public static let mediaMissingHint = "Add the missing images again before this goes out."
  public static let signedOutHint = "This account is signed out. Sign back in to post as it."

  /// Facts about the post the actions depend on.
  public static func postFacts(_ state: JSONValue?) -> PostFacts {
    let posts = ComposerJS.list(ComposerJS.or(state?["posts"], nil))
    let lengths = posts.map { InlineLinks.countComposerGraphemes(ComposerJS.trimmed(ComposerJS.or($0["text"], ""))) }
    return PostFacts(
      hasContent: !ComposerModel.isEmptyComposer(state),
      overLimit: lengths.contains { $0 > ComposerModel.maxPostGraphemes },
      overDraftLimit: lengths.contains { $0 > draftMaxGraphemes },
      hasVideo: posts.contains { ComposerJS.truthy($0["video"]) },
      videoPending: posts.contains { post in
        ComposerJS.truthy(post["video"]) && ComposerJS.includes(["uploading", "processing"], post["video"]?["status"])
      },
      reply: ComposerJS.truthy(state?["reply"]),
      thread: posts.count > 1,
      editingScheduled: state?["source"]?["kind"] == "scheduled")
  }

  public static func postFacts(_ state: ComposerState) -> PostFacts { postFacts(state.json) }

  /// Which action the primary half runs, and whether each can run.
  /// `defaultAction` is the account's posting setting, `queue` its weekly
  /// schedule; `postNow` is "Post now instead"; `authMode` the build's
  /// sign-in ('browser' | 'backend').
  public static func composerActions(
    _ state: JSONValue?,
    defaultAction: JSONValue? = nil,
    queue: JSONValue? = nil,
    caps: ComposerCaps = ComposerCaps(),
    signedOut: Bool = false,
    missingMedia: Bool = false,
    postNow: Bool = false,
    authMode: JSONValue? = "backend"
  ) -> ComposerActionSet {
    let f = postFacts(state)
    let canPost = caps.canPost != false
    let common: String? = !f.hasContent ? emptyHint : signedOut ? signedOutHint : nil

    let post =
      common ?? (!canPost ? AccountCopy.postingRegrantMessage : nil) ?? (f.overLimit ? overLimitHint : nil)
      ?? (missingMedia ? mediaMissingHint : nil) ?? (f.videoPending ? videoPendingHint : nil)

    let scheduleBlock = PublishActions.scheduleBlockReason(
      canSchedule: caps.canSchedule, video: f.hasVideo, authMode: authMode ?? "backend")
    // A reply can be scheduled for a set time, but not queued.
    let queueBlock = PublishActions.queueBlockReason(reply: f.reply)
    let queueEmpty = PostingQueue.isScheduleEmpty(queue)
    func scheduling(_ action: String) -> String? {
      PublishActions.publishActionBlockReason(
        .string(action), queueEmpty: queueEmpty, scheduleBlock: scheduleBlock, queueBlock: queueBlock)
        ?? common ?? (f.overLimit ? overLimitHint : nil) ?? (missingMedia ? mediaMissingHint : nil)
    }

    let draft =
      common
      ?? (f.overDraftLimit ? "A post is over \(draftMaxGraphemes) characters, too long even for a draft." : nil)

    func entry(_ reason: String?) -> ComposerActionState {
      ComposerActionState(disabled: !(reason ?? "").isEmpty, reason: reason)
    }
    let actions = ComposerActionStates(
      post: entry(post), schedule: entry(scheduling(PublishActions.schedule)),
      queue: entry(scheduling(PublishActions.queue)), draft: entry(draft))

    var primary: String
    var draftFallback = false
    let mode = state?["schedule"]?["mode"]
    if mode == "queue" {
      primary = PublishActions.queue
    } else if mode == "at" {
      primary = PublishActions.schedule
    } else if postNow {
      primary = PublishActions.post
    } else {
      primary = PublishActions.resolvePrimaryPublishAction(
        preferred: defaultAction,
        // A reply is usually meant for now: the account's habit of
        // scheduling or queueing doesn't apply to it unless Schedule is
        // picked for it.
        canSchedule: (scheduleBlock ?? "").isEmpty && !f.reply,
        canSaveDraft: true)
    }
    if f.overLimit && f.hasContent && !f.overDraftLimit && primary != PublishActions.draft && !f.editingScheduled {
      primary = PublishActions.draft
      draftFallback = true
    }
    return ComposerActionSet(primary: primary, draftFallback: draftFallback, actions: actions, facts: f)
  }

  public static func composerActions(
    _ state: ComposerState, defaultAction: String? = nil, queue: JSONValue? = nil, caps: ComposerCaps = ComposerCaps(),
    signedOut: Bool = false, missingMedia: Bool = false, postNow: Bool = false, authMode: String = "backend"
  ) -> ComposerActionSet {
    composerActions(
      state.json, defaultAction: defaultAction.map(JSONValue.string), queue: queue, caps: caps, signedOut: signedOut,
      missingMedia: missingMedia, postNow: postNow, authMode: .string(authMode))
  }

  /// The words on the button for an action.
  public static func actionLabel(_ action: String?, _ state: JSONValue?, short: Bool = false) -> String {
    let f = postFacts(state)
    let mode = state?["schedule"]?["mode"]
    switch action {
    case PublishActions.schedule:
      return f.editingScheduled && mode == "at" ? "Save changes" : short ? "Schedule" : "Schedule…"
    case PublishActions.queue:
      return f.editingScheduled && mode == "queue" ? "Save changes" : "Add to queue"
    case PublishActions.draft:
      return state?["source"]?["kind"] == "draft" ? "Save draft" : "Save as draft"
    default:
      if f.reply { return "Reply" }
      return f.thread ? "Post \(ComposerJS.length(state?["posts"])) posts" : "Post"
    }
  }

  public static func actionLabel(_ action: String?, _ state: ComposerState, short: Bool = false) -> String {
    actionLabel(action, state.json, short: short)
  }
}
