// Ports src/posting/schedule/scheduledPostError.js
//
// Sentences for what went wrong with a scheduled post, in Virga's words.
// The server's own messages are short notes rather than Virga's sentences,
// so the UI branches on codes and uses the server's prose only as a last
// resort.
//
// Two readers: friendlyScheduleError for what the publish worker stored on
// a failed row (`lastError`, `lastErrorCode`), and scheduleErrorMessage for
// an error a schedule or timer call threw.
//
// The web reads an error's members (`code`, `status`, `detail`, `payload`,
// `message`); the port reads them off the error as a JSON object (the web's
// `{ status, code, detail, payload }`), and the `any Error` overloads first
// make a thrown Swift error that object (errorObject).
//
// Not reproduced (corrupt input only): a `code` naming a member every
// object inherits ('constructor', 'toString') finds that member in the web's
// BY_THROWN_CODE and returns it in place of a sentence.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

public enum ScheduledPostError {
  // Each sentence is reached two ways: the worker's stored code, or a prose
  // match for rows without one.
  static let lostMedia = "The images for this post are missing. Edit it and add them again."
  static let expiredSession =
    "Virga’s server couldn’t act as this account: its session had ended. Sign in again, then retry."
  static let ranOutOfTime = "Virga’s server ran out of time before it could post this."
  static let rateLimited = "Bluesky was rate limiting this account."
  static let refused = "Bluesky refused the post."
  static let replyTargetGone = "The post this replies to is gone, so the reply wasn’t posted."
  static let replyTargetUnchecked =
    "Virga’s server couldn’t check that the post this replies to is still there, so it held the reply back. Retry sends it if the post is still up."
  static let timerNotSet = "This posted, but its timer couldn’t be set. It stays up unless you delete it."
  static let noIdea = "This one didn’t go out."

  // The publish worker's verdict, stored in `lastErrorCode`. 'UNKNOWN' is
  // left out on purpose: an unclassified row may still have useful prose. A
  // TIMER_NOT_ARMED note rides on a published row (only its timer failed),
  // so its sentence must not read as a failed post.
  static let byCode: [String: String] = [
    "MEDIA_MISSING": lostMedia,
    "SESSION_UNAVAILABLE": expiredSession,
    "TIMED_OUT": ranOutOfTime,
    "RATE_LIMITED": rateLimited,
    "REFUSED": refused,
    "REPLY_TARGET_GONE": replyTargetGone,
    "REPLY_TARGET_UNCHECKED": replyTargetUnchecked,
    "TIMER_NOT_ARMED": timerNotSet,
  ]

  /// `String(v || '')`.
  static func text(_ value: JSONValue?) -> String {
    guard let value, value.isTruthy else { return "" }
    return value.jsString
  }

  /// A failed scheduled post as a sentence. `raw` is what the worker stored
  /// in `lastError`, `code` its own verdict, `lastErrorCode`. The code wins:
  /// prose matching breaks quietly when the server rewords a message. Rows
  /// from an older worker have no code and fall back to the prose.
  public static func friendlyScheduleError(_ raw: JSONValue?, _ code: JSONValue? = nil) -> String {
    if let known = byCode.jsValue(text(code).jsTrimmed().jsUppercased()) { return known }

    // Some stored messages are the server's own sentences (its media guard
    // and the time-out retirement); match those first on fragments no PDS
    // or Postgres error could collide with. Not bare 'image':
    // 'InvalidRequest: image file size too large' is a refusal.
    let s = text(raw).jsLowercased()
    func has(_ fragment: String) -> Bool { s.jsIndexOf(fragment) >= 0 }
    if has("images for this scheduled post") || has("re-attach") || has("media") || has("missing bytes")
      || has("object not found")
    {
      return lostMedia
    }
    if has("ran out of time") { return ranOutOfTime }
    if has("session") { return expiredSession }
    // 'RateLimitExceeded' (one word) or prose ("rate limit").
    if has("rate limit") || has("ratelimit") { return rateLimited }
    if has("invalidrequest") || has("upstream") { return refused }
    return noIdea
  }

  public static func friendlyScheduleError(_ raw: String?, _ code: String? = nil) -> String {
    friendlyScheduleError(raw.map(JSONValue.string), code.map(JSONValue.string))
  }

  /// `.`, `!` and `?`, which end a sentence a capital follows.
  static let sentenceStops: Set<UInt16> = [0x2E, 0x21, 0x3F]
  /// `/[.!?…]$/`.
  static let sentenceEnds: Set<UInt16> = [0x2E, 0x21, 0x3F, 0x2026]

  /// The server's own sentence, made to read as one of Virga's: a capital
  /// and a stop. Every sentence starts upper case, not just the first
  /// (`/(^|[.!?]\s+)([a-z])/g`).
  static func asSentence(_ value: JSONValue?) -> String {
    let t = text(value).jsTrimmed()
    if t.isEmpty { return "" }
    var units = Array(t.utf16)
    func lower(_ i: Int) -> Bool { i < units.count && units[i] >= 0x61 && units[i] <= 0x7A }
    let leads = lower(0)
    if leads { units[0] -= 0x20 }
    // After a capital the scan resumes past it, as a global regex does.
    var i = leads ? 1 : 0
    while i < units.count {
      let unit = units[i]
      if sentenceStops.contains(unit) {
        var j = i + 1
        while j < units.count, PostingJS.isSpace(units[j]) { j += 1 }
        if j > i + 1, lower(j) {
          units[j] -= 0x20
          i = j + 1
          continue
        }
      }
      i += 1
    }
    let capped = String(decoding: units, as: UTF16.self)
    let last = units.last ?? 0
    return sentenceEnds.contains(last) ? capped : "\(capped)."
  }

  /// What to say about a QUOTA_EXCEEDED refusal (whatever its status).
  public static func quotaMessage(_ payload: JSONValue?) -> String {
    let timer = SelfDestruct.timerSlotRefusal(payload)
    if !timer.isEmpty { return timer }
    let limit = payload?["limit"].jsNumber
    if payload?["feature"] == "scheduledPosts" {
      if let limit, limit.isFinite, limit > 0 {
        let n = JSNumber.format(limit)
        let one = limit == 1
        return
          "This account can keep \(n) scheduled \(one ? "post" : "posts") at a time, and \(one ? "it’s" : "they’re all") in use."
      }
      return "This account’s scheduled posts are all in use."
    }
    // No feature: the flat cap everyone has.
    return
      "This account has as many posts scheduled and on timers as Virga’s server holds. Let some go out, or cancel a few."
  }

  static let byThrownCode: [String: String] = [
    "NEEDS_BACKEND":
      "Scheduling needs this account signed in through Virga’s server. Reconnect it for a longer session.",
    "QUEUE_REPLY": "A reply can’t wait in the queue. Schedule it for a set time instead.",
    "REPLY_UNRESOLVED": "The post you’re replying to couldn’t be read. Try again, or take the reply off.",
    "REPEAT_REPLY": "A reply can’t repeat: it would answer the same post again each time.",
    "QUEUE_REPEAT": "A post in the queue can’t repeat. Schedule it for a set time instead.",
    "NOT_SKIPPABLE": "There’s nothing to skip: this post isn’t repeating, or is already on its way out.",
    "NOT_REPEATING": "This post isn’t repeating, or is already on its way out, so there’s nothing to stop.",
    "SCHEDULE_VIDEO": "Posts with video can’t be scheduled. Post it now instead.",
    "MEDIA_TOO_LARGE":
      "That’s more image than can be sent ahead. Use fewer or smaller images, or post it now.",
    "IMAGE_TOO_LARGE": "One of the images is over Bluesky’s size limit. Add it again so it can be shrunk.",
    "IMAGE_MISSING": "An image needs to be added again before this can be scheduled.",
    "TOO_MANY_IMAGES": "A post can have up to 4 images.",
    "RECORD_UNRESOLVED": "The attached post or feed couldn’t be found. Remove it or try again.",
    "SCHEDULE_INVALID": "Choose a time to post it.",
    "SCHEDULE_PAST": "Choose a time at least a minute from now.",
    "SCHEDULE_TOO_FAR": "Posts can be scheduled up to 90 days ahead.",
    "EMPTY": "Write something first.",
    "RATE_LIMITED": "That’s a lot of posts at once. Wait a moment and try again.",
    "NOT_RESCHEDULABLE": "This post is already on its way out, or has gone, so it can’t be changed.",
    "PARTIALLY_PUBLISHED":
      "Part of this thread is already out, so it can’t be changed. Retry it to post the rest, or cancel it.",
    "NOT_CANCELLABLE": "This post is already on its way out, so it can no longer be cancelled.",
    "NOT_RETRIABLE": "Only a post that didn’t go out can be retried.",
    "NOT_ACKNOWLEDGEABLE": "That note was already cleared.",
    "NOT_REORDERABLE": "One of these posts is already on its way out, so the new order wasn’t saved.",
    "DELETE_TIME_TOO_EARLY":
      "This post’s delete time would come before it goes out, or within five minutes of it. Pick an earlier slot, or change its lifespan first.",
    "NOT_REARMABLE": "This post’s timer is being checked right now, so it wasn’t changed. Try again in a minute.",
    "NOT_YOUR_CLIENT": "This post was scheduled in another app. Open it there to change it.",
    "UNAVAILABLE": "Scheduling isn’t available on Virga’s server right now.",
    "VIRGA_CLIENT_UNAVAILABLE": "Virga’s server isn’t taking sign-ins right now. Try again later.",
    "TIMEOUT": "Virga’s server didn’t answer in time. Try again.",
    "NETWORK_ERROR": "Couldn’t reach Virga’s server. Check the connection and try again.",
    "INTERNAL": "Virga’s server couldn’t do that just now. Try again.",
  ]

  /// What to tell the writer about an error a schedule or timer call threw
  /// (`{ status, code, detail, payload }`, as the Requester and serializer
  /// throw them). Never a raw "server answered 502" line.
  public static func scheduleErrorMessage(_ err: JSONValue?) -> String {
    guard let err, err.isTruthy else { return "" }
    let code = err["code"]
    if code == "QUOTA_EXCEEDED" { return quotaMessage(ComposerJS.or(err["payload"], err)) }
    if code == "TIMER_PROBLEM" || code == "LIFESPAN" || code == "REPEAT_INVALID" {
      return text(err["message"])
    }
    // A retry refused because the images were cleared: the server's note
    // says whether part of the thread is already out, which decides what to
    // do next.
    if code == "MEDIA_MISSING" {
      return ComposerJS.truthy(err["detail"])
        ? asSentence(err["detail"])
        : "The images for this post were cleared after 30 days. Edit it and add them again."
    }
    if let known = byThrownCode.jsValue(code.map(\.jsString) ?? "undefined") { return known }
    let status = err["status"]
    if ComposerJS.strictEquals(status, .number(401)) {
      return "This account needs to sign in again before it can do that."
    }
    if ComposerJS.strictEquals(status, .number(413)) {
      return "That was too large to send. Use fewer or smaller images."
    }
    if ComposerJS.greaterOrEqual(status, .number(500)) {
      return "Virga’s server couldn’t do that just now. Try again."
    }
    // A 400 from the server carries a sentence and no code: the one place
    // its prose is the most precise thing there is to say.
    if let detail = err["detail"]?.stringValue, !detail.isEmpty { return asSentence(err["detail"]) }
    if let message = err["message"]?.stringValue, !message.isEmpty, !ComposerJS.truthy(status) {
      return asSentence(err["message"])
    }
    return "That didn’t work. Try again."
  }

  /// scheduleErrorMessage for a thrown error, read as the web's object
  /// (errorObject).
  public static func scheduleErrorMessage(_ error: (any Error)?) -> String {
    guard let error else { return "" }
    return scheduleErrorMessage(errorObject(error))
  }

  /// What to tell the writer when the server refuses a reorder (it wrote
  /// nothing), or nil when the failure isn't a refusal: a missing endpoint,
  /// which falls back to row-by-row writes.
  public static func reorderRefusal(_ err: JSONValue?) -> String? {
    guard let err, err.isTruthy else { return nil }
    let status = err["status"]
    if err["reorderUnsupported"] == .bool(true) || ComposerJS.strictEquals(status, .number(404))
      || ComposerJS.strictEquals(status, .number(405))
    {
      return nil
    }
    if err["code"] == "DELETE_TIME_TOO_EARLY" {
      return
        "One of these posts would go out after its delete time in this order, or within five minutes of it. Move it earlier, or change its lifespan first. Your queue is unchanged."
    }
    if err["code"] == "NOT_REORDERABLE" || ComposerJS.strictEquals(status, .number(409)) {
      return byThrownCode["NOT_REORDERABLE"]
    }
    let message = scheduleErrorMessage(err)
    return message.isEmpty ? nil : message
  }

  public static func reorderRefusal(_ error: (any Error)?) -> String? {
    guard let error else { return nil }
    return reorderRefusal(errorObject(error))
  }

  // MARK: Errors as the web's objects

  /// A thrown error as the web's Error object, with the members the
  /// scheduling code reads: `name`, `message`, and where the error has them
  /// `code`, `status`, `detail`, `payload` (Virga's server's refusals, also
  /// as the timer service hands them back in a TimerServiceError),
  /// `problems` (a publish's), the serializer's extras (`postIndex`,
  /// `imageId`, `size`, `limit`) and `reorderUnsupported`.
  public static func errorObject(_ error: any Error) -> JSONValue {
    switch error {
    case let known as any ScheduleErrorObject:
      return known.errorObject
    case let backend as BackendError:
      var out: JSONValue = ["name": .string(backend.name), "message": .string(backend.message)]
      if let status = backend.status { out["status"] = .number(Double(status)) }
      if let code = backend.code { out["code"] = code }
      if let detail = backend.detail { out["detail"] = .string(detail) }
      if let payload = backend.payload { out["payload"] = payload }
      return out
    case let publish as PublishError:
      var out = publish.jsFields.json
      if let problems = publish.problems { out["problems"] = json(problems) }
      return out
    case let timer as TimerServiceError:
      // The timer service's errors (an ArmOutcome's, a timer call's) are
      // the requester's on the web, or its own coded ones. Its `detail` is
      // requestError's: the body's `error` when that is a string.
      var out: JSONValue = ["name": .string(timer.name ?? "Error"), "message": .string(timer.message)]
      if let code = timer.code { out["code"] = .string(code) }
      if let status = timer.status { out["status"] = .number(Double(status)) }
      if let payload = timer.payload {
        out["payload"] = payload
        out["detail"] = payload["error"]?.stringValue.map(JSONValue.string) ?? .null
      }
      return out
    default:
      return PublishRecord.errorObject(error)
    }
  }

  static func json<T: Encodable>(_ value: T) -> JSONValue {
    (try? JSONValue(encoding: value)) ?? .null
  }
}

/// An error that knows the web's Error object it stands for (the members
/// the scheduling code reads off it).
public protocol ScheduleErrorObject: Error {
  var errorObject: JSONValue { get }
}
