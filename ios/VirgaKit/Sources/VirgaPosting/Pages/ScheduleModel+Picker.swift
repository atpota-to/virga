// Ports src/posting/pages/scheduleModel.js
//
// The time picker's quick picks and its refusals, and posting a scheduled
// row now (postScheduledNow), whose I/O arrives as closures
// (PostScheduledNowDeps; `live(...)` wires the app's services).

import Foundation
import VirgaCore

/// A quick pick of the time picker: `{ key, label, at }` (epoch ms).
public struct QuickPick: Hashable, Sendable {
  public var key: String
  public var label: String
  public var at: Double

  public var json: JSONValue { ["key": .string(key), "label": .string(label), "at": ScheduleJS.isoJSON(at)] }
}

/// A refusal of postScheduledNow: BAD_ROW, PARTIALLY_PUBLISHED,
/// ALREADY_DUE or IMAGE_MISSING.
public struct ScheduleModelError: Error, LocalizedError, ScheduleErrorObject, Hashable, Sendable {
  public var code: String
  public var message: String

  public init(_ code: String, _ message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
  public var errorObject: JSONValue { ["name": "Error", "message": .string(message), "code": .string(code)] }
}

/// What postScheduledNow works with (the web's `deps`). `Target` is what
/// `targetFor` gives and `publish` takes (the write account).
public struct PostScheduledNowDeps<Target: Sendable>: Sendable {
  public var requester: (any ScheduleRequester)?
  /// getScheduledMedia(requester, id).
  public var getScheduledMedia: @Sendable ((any ScheduleRequester)?, JSONValue) async throws -> JSONValue
  /// reconstructFromScheduled(row, media, asDid) as composer state.
  public var reconstructFromScheduled: @Sendable (JSONValue, JSONValue, String) async throws -> JSONValue
  public var targetFor: @Sendable (String) async throws -> Target
  /// publish(state, target, resolveMention): the publish result (`{ posts, root, written }`).
  public var publish: @Sendable (JSONValue, Target, ResolveMention?) async throws -> JSONValue
  public var resolveMention: ResolveMention?
  public var cancelScheduled: @Sendable ((any ScheduleRequester)?, JSONValue) async throws -> Void
  /// Skips a repeating post's waiting occurrence; nil where the page has none.
  public var skipScheduled: (@Sendable ((any ScheduleRequester)?, JSONValue) async throws -> Void)?
  /// emitPostsChanged(did, added).
  public var emitPostsChanged: @Sendable (String, [JSONValue]) throws -> Void
  /// armAfterPublish(result, state)'s answer; nil where timers can't be set.
  public var armTimer: (@Sendable (JSONValue, JSONValue) async throws -> ArmOutcome?)?

  public init(
    requester: (any ScheduleRequester)?,
    getScheduledMedia: @escaping @Sendable ((any ScheduleRequester)?, JSONValue) async throws -> JSONValue,
    reconstructFromScheduled: @escaping @Sendable (JSONValue, JSONValue, String) async throws -> JSONValue,
    targetFor: @escaping @Sendable (String) async throws -> Target,
    publish: @escaping @Sendable (JSONValue, Target, ResolveMention?) async throws -> JSONValue,
    resolveMention: ResolveMention? = nil,
    cancelScheduled: @escaping @Sendable ((any ScheduleRequester)?, JSONValue) async throws -> Void,
    skipScheduled: (@Sendable ((any ScheduleRequester)?, JSONValue) async throws -> Void)? = nil,
    emitPostsChanged: @escaping @Sendable (String, [JSONValue]) throws -> Void,
    armTimer: (@Sendable (JSONValue, JSONValue) async throws -> ArmOutcome?)? = nil
  ) {
    self.requester = requester
    self.getScheduledMedia = getScheduledMedia
    self.reconstructFromScheduled = reconstructFromScheduled
    self.targetFor = targetFor
    self.publish = publish
    self.resolveMention = resolveMention
    self.cancelScheduled = cancelScheduled
    self.skipScheduled = skipScheduled
    self.emitPostsChanged = emitPostsChanged
    self.armTimer = armTimer
  }
}

extension PostScheduledNowDeps where Target == PublishTarget? {
  /// The app's services: Virga's server for the row and its media, the
  /// composer's files for the images, publish for the post, the events bus
  /// for the archive, and the timer service for the timer.
  public static func live(
    requester: (any ScheduleRequester)?, timers: (any TimerRequester)?, files: any ComposerFiles,
    media: PublishMedia, targetFor: @escaping @Sendable (String) async throws -> PublishTarget?,
    resolveMention: ResolveMention? = nil, now: @escaping @Sendable () -> Double,
    makePreviewUrl: (@Sendable (JSONValue) throws -> String?)? = nil, target: PostingEventBus? = .shared,
    timeZone: TimeZone? = nil
  ) -> PostScheduledNowDeps<PublishTarget?> {
    PostScheduledNowDeps<PublishTarget?>(
      requester: requester,
      getScheduledMedia: { req, id in try await ScheduleService.getScheduledMedia(req, id) },
      reconstructFromScheduled: { row, rowMedia, did in
        try await ScheduleSerialize.reconstructFromScheduled(
          row, rowMedia, asDid: did, files: files, makePreviewUrl: makePreviewUrl, timeZone: timeZone
        ).json
      },
      targetFor: targetFor,
      publish: { state, target, resolve in
        let result = try await Publish.publish(
          state, target, media: media, resolveMention: resolve, now: now, timeZone: timeZone)
        return (try? JSONValue(encoding: result)) ?? .null
      },
      resolveMention: resolveMention,
      cancelScheduled: { req, id in _ = try await ScheduleService.cancelScheduled(req, id, target: target) },
      skipScheduled: { req, id in _ = try await ScheduleService.skipScheduled(req, id, target: target, timeZone: timeZone) },
      emitPostsChanged: { did, added in try PostingEvents.emitPostsChanged(did, added: added, target: target) },
      armTimer: { result, state in
        guard let timers else { return nil }
        let at = now()
        return await TimerService.armAfterPublish(
          timers, result, state["lifespan"] ?? .null,
          snippet: TimerService.timerSnippet(state["posts"]?[0]?["text"]).map(JSONValue.string) ?? .null,
          postedAt: JSDate.toISOString(at),
          fit: SelfDestruct.composerTimerFit(reply: ComposerJS.truthy(state["reply"])), now: at, timeZone: timeZone)
      })
  }
}

/// postScheduledNow's answer.
public struct PostScheduledNowResult: Sendable {
  public var result: JSONValue
  /// Whether the scheduled copy was taken off.
  public var cancelled: Bool
  public var timer: ArmOutcome?
  public var notes: [String]
}

extension ScheduleModel {
  // MARK: The time picker

  /// Quick picks for a time, in `tz` (nil or '': this device's zone), each
  /// inside [min, max] (default: a minute from now to 90 days out). Fixed
  /// times of day (this evening, tomorrow morning) are read on the queue's
  /// clock.
  public static func quickPicks(
    now: Double, _ tz: String? = nil, min: Double? = nil, max: Double? = nil, localZone: TimeZone? = nil
  ) -> [QuickPick] {
    let low = min ?? now + PostingQueue.minLeadMs
    let high = max ?? now + Double(PostingQueue.queueHorizonDays) * 86_400_000
    let zone = tz.flatMap { $0.isEmpty ? nil : $0 } ?? PostingQueue.resolveTimezone(nil, localZone: localZone)
    guard let today = PostingQueue.zonedWallTime(.number(now), .string(zone), timeZone: localZone) else { return [] }
    let utc = TimeZone(identifier: "UTC")!
    func dayAfter(_ n: Double) -> String? {
      let ms = JSDate.parse("\(today.date)T12:00:00Z", timeZone: utc) + n * 86_400_000
      return JSDate.toISOString(ms).map { $0.jsSlice(0, 10) }
    }
    func at(_ n: Double, _ time: String) -> Double? {
      guard let day = dayAfter(n) else { return nil }
      return PostingQueue.zonedWallTimeToUtc(day, time, zone)
    }
    let order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    let dow = order.firstIndex(of: today.weekday) ?? -1
    let untilSat = Double((6 - dow + 7) % 7 == 0 ? 7 : (6 - dow + 7) % 7)
    let untilMon = Double((1 - dow + 7) % 7 == 0 ? 7 : (1 - dow + 7) % 7)
    let roundUp = { (ms: Double, step: Double) in (ms / step).rounded(.up) * step }
    let picks: [(String, String, Double?)] = [
      ("hour", "In an hour", JSDate.timeClip(roundUp(now + 60 * 60_000, 5 * 60_000))),
      ("evening", "This evening", at(0, "18:00")),
      ("morning", "Tomorrow morning", at(1, "09:00")),
      ("tomorrow-evening", "Tomorrow evening", at(1, "18:00")),
      ("weekend", "This weekend", at(untilSat, "10:00")),
      ("next-week", "Next week", at(untilMon, "09:00")),
    ]
    return picks.compactMap { key, label, at in
      guard let at, at >= low, at <= high else { return nil }
      return QuickPick(key: key, label: label, at: at)
    }
  }

  /// Why a picked time can't be used, or ''. `min`/`max` default to the
  /// server's bounds: a minute from now, 90 days out.
  public static func whenProblem(
    _ value: JSONValue?, now: Double, min: Double? = nil, max: Double? = nil, timeZone: TimeZone? = nil
  ) -> String {
    let low = min ?? now + PostingQueue.minLeadMs
    let high = max ?? now + Double(PostingQueue.queueHorizonDays) * 86_400_000
    let ms = instant(value, timeZone)
    if !ms.isFinite { return "Choose a date and a time." }
    if ms < low {
      return ms <= now ? "That time has passed. Choose a later one." : "Choose a time at least a minute from now."
    }
    if ms > high { return "That’s further ahead than a post can wait: choose an earlier time." }
    return ""
  }

  // MARK: Posting a scheduled row now

  /// `Object.keys(value || {}).length > 0`.
  static func hasKeys(_ value: JSONValue?) -> Bool {
    switch value {
    case .object(let members)?: return !members.isEmpty
    case .array(let items)?: return !items.isEmpty
    case .string(let text)?: return !text.isEmpty
    default: return false
    }
  }

  /// Post a scheduled row now, as the account it was scheduled as, then
  /// take the scheduled copy off (one retry), then set its timer if it had
  /// one. The post goes out first: a failed cancel leaves a copy waiting
  /// (said in `notes`), but a failed post never loses the row.
  ///
  /// The waiting occurrence of a repeating post is skipped rather than
  /// cancelled (`deps.skipScheduled`), so the one posted now stands in for
  /// it and the next still goes out at its time. Throws ScheduleModelError
  /// (BAD_ROW, PARTIALLY_PUBLISHED, ALREADY_DUE, IMAGE_MISSING) before
  /// anything goes out, and whatever publish throws.
  public static func postScheduledNow<Target: Sendable>(
    _ row: JSONValue?, did: String, deps: PostScheduledNowDeps<Target>, now: Double, timeZone: TimeZone? = nil
  ) async throws -> PostScheduledNowResult {
    guard let row, let id = row["id"], id.isTruthy else {
      throw ScheduleModelError("BAD_ROW", "That post couldn’t be read. Reload the page and try again.")
    }
    if ComposerJS.truthy(row["partial"]) {
      throw ScheduleModelError("PARTIALLY_PUBLISHED", "Part of this thread is already out. Retry it to post the rest.")
    }
    // Checked again here because the confirm dialog can stay open past the
    // row's time; see postNowCutoffMs.
    if rowIsDueSoon(row, now: now, timeZone: timeZone) {
      throw ScheduleModelError(
        "ALREADY_DUE", "It’s about to go out at its scheduled time, so it can’t also be posted now.")
    }
    let media = hasKeys(ComposerJS.or(row["payload"]?["media"], nil))
      ? try await deps.getScheduledMedia(deps.requester, id) : [:]
    let state = try await deps.reconstructFromScheduled(row, media, did)
    let missing = (state["posts"]?.arrayValue ?? []).contains { post in
      (post["images"]?.arrayValue ?? []).contains { !ComposerJS.truthy($0["file"]) && !ComposerJS.truthy($0["blob"]) }
    }
    if missing {
      throw ScheduleModelError(
        "IMAGE_MISSING",
        "Some of this post’s images are no longer on Virga’s server. Edit it to add them again, then post it.")
    }
    let target = try await deps.targetFor(did)
    var outgoing = state
    outgoing["schedule"] = .null
    let result = try await deps.publish(outgoing, target, deps.resolveMention)
    // The archive catching up is a nicety; the post is out.
    try? deps.emitPostsChanged(did, ComposerJS.or(result["written"], [])?.arrayValue ?? [])
    var notes: [String] = []
    var cancelled = false
    let skips = ScheduleService.isRepeatingRow(row) && row["status"] == "pending" && deps.skipScheduled != nil
    var attempt = 0
    while attempt < 2 && !cancelled {
      attempt += 1
      do {
        if skips, let skip = deps.skipScheduled {
          try await skip(deps.requester, id)
        } else {
          try await deps.cancelScheduled(deps.requester, id)
        }
        cancelled = true
      } catch {
        let object = ScheduledPostError.errorObject(error)
        // By code unit: JSONValue's `==` is Swift's, where a Kelvin sign is a K.
        if ComposerJS.strictEquals(object["code"], "NOT_CANCELLABLE")
          || ComposerJS.strictEquals(object["code"], "NOT_SKIPPABLE")
          || ComposerJS.strictEquals(object["status"], .number(409))
        {
          break
        }
      }
    }
    if !cancelled {
      notes.append(
        "The scheduled copy couldn’t be taken off, so it may go out again at its time. Cancel it on this page.")
    }
    var timer: ArmOutcome?
    if ComposerJS.truthy(state["lifespan"]?["enabled"]), let armTimer = deps.armTimer {
      timer = try await armTimer(result, state)
      if timer?.status == "failed" {
        let message = timer?.error?.message ?? ""
        notes.append("It went out without its timer\(message.isEmpty ? "." : ": \(message)")")
      } else if timer?.status == "unconfirmed" {
        notes.append("Its timer may not have been set. Posting › Timers shows whether it was.")
      }
    }
    return PostScheduledNowResult(result: result, cancelled: cancelled, timer: timer, notes: notes)
  }
}
