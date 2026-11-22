// Ports src/posting/composer/submit.js
//
// The parts of sending a post that aren't the network calls themselves: the
// two-stage clock on a publish, the line that says what's happening, the
// words for success and failure, which rows hold queue slots, and what to
// do with the draft or scheduled post the composer was opened from once the
// post is out (DESIGN.md §6.1a). Pure, or with every call injected.

import Foundation
import VirgaCore
import VirgaNetwork
import VirgaSession

/// How to show a publish that failed: `{ message, silent, permission, reauth }`.
public struct PublishErrorView: Codable, Hashable, Sendable {
  public var message: String
  /// A cancel the writer asked for.
  public var silent: Bool
  /// The account was signed in before Virga asked to post.
  public var permission: Bool
  /// The account must sign in again.
  public var reauth: Bool
}

/// The toast after a post goes out: `{ text, href }`.
public struct PostedToast: Codable, Hashable, Sendable {
  public var text: String
  public var href: String?

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(text, forKey: .text)
    try container.encode(href, forKey: .href)
  }
}

/// What finishSource did: `{ status: 'none' | 'done' | 'failed', warning, keepSource }`.
public struct FinishSourceResult: Codable, Hashable, Sendable {
  public var status: String
  public var warning: String
  /// The composer should hold on to the source so the writer can try again.
  public var keepSource: Bool
}

/// An error that was a cancel the writer asked for (the web's `err.canceled`).
public protocol CancelMarkedError: Error {
  var canceled: Bool { get }
}

extension VideoCancelledError: CancelMarkedError, JSErrorConvertible {
  public var jsFields: JSErrorFields { JSErrorFields(name: "AbortError", message: errorDescription ?? "") }
}

extension ComposerCancelledError: CancelMarkedError, JSErrorConvertible {
  public var jsFields: JSErrorFields { JSErrorFields(name: name, message: message) }
}

extension VideoError: JSErrorConvertible {
  public var jsFields: JSErrorFields {
    JSErrorFields(name: name, message: message, code: .string(code), status: status)
  }
}

/// Watches one publish: `onSlow` after `slowMs`, `onHard` after `hardMs`,
/// unless `stop()` comes first. The publish itself isn't aborted: a write
/// under way may still land, which is why the hard message says to check.
public final class PublishWatch: Sendable {
  /// Starts a timer: calls `fn` after `ms` unless cancelled (setTimeout).
  public typealias SetTimer = @Sendable (_ ms: Double, _ fn: @escaping @Sendable () -> Void) -> Int
  public typealias ClearTimer = @Sendable (_ id: Int) -> Void

  let done = Locked(false)
  let ids: Locked<[Int]> = Locked([])
  let clearTimer: ClearTimer

  public init(
    slowMs: Double = ComposerSubmit.slowPublishMs,
    hardMs: Double = ComposerSubmit.hardPublishMs,
    onSlow: (@Sendable () -> Void)? = nil,
    onHard: (@Sendable () -> Void)? = nil,
    setTimer: SetTimer? = nil,
    clearTimer: ClearTimer? = nil
  ) {
    let timers = setTimer.map { ($0, clearTimer ?? { _ in }) } ?? PublishWatch.taskTimers()
    self.clearTimer = timers.1
    let done = self.done
    let slow = timers.0(slowMs) {
      if !done.withLock({ $0 }) { onSlow?() }
    }
    let hard = timers.0(hardMs) {
      let fire = done.withLock { flag -> Bool in
        if flag { return false }
        flag = true
        return true
      }
      if fire { onHard?() }
    }
    ids.withLock { $0 = [slow, hard] }
  }

  /// Stops watching. True when the hard limit had already passed.
  @discardableResult
  public func stop() -> Bool {
    let late = done.withLock { flag -> Bool in
      let was = flag
      flag = true
      return was
    }
    for id in ids.withLock({ $0 }) { clearTimer(id) }
    return late
  }

  public var expired: Bool { done.withLock { $0 } }

  /// Timers on Tasks: each sleeps, then runs unless cancelled.
  static func taskTimers() -> (SetTimer, ClearTimer) {
    let tasks = Locked<[Int: Task<Void, Never>]>([:])
    let next = Locked(0)
    let set: SetTimer = { ms, fn in
      let id = next.withLock { n -> Int in
        n += 1
        return n
      }
      let task = Task {
        try? await Task.sleep(nanoseconds: UInt64(Swift.max(0, ms) * 1_000_000))
        if !Task.isCancelled { fn() }
      }
      tasks.withLock { $0[id] = task }
      return id
    }
    let clear: ClearTimer = { id in
      tasks.withLock { $0.removeValue(forKey: id) }?.cancel()
    }
    return (set, clear)
  }
}

public enum ComposerSubmit {
  public static let slowPublishMs: Double = 60_000
  public static let hardPublishMs: Double = 180_000

  public static let slowPublishNote = "Still publishing. Please don’t send it again."
  public static let hardPublishError =
    "This is taking longer than it should. Your post may still have gone out: check your profile before trying again, so it doesn’t go out twice."
  public static let scheduledCopyRemains =
    "Your post went out, but its scheduled copy is still waiting in your queue. Cancel it in Scheduled posts, or it will go out again."
  public static let draftNotDeleted = "Your post went out, but its draft couldn’t be deleted. Delete it in Drafts."

  /// Watches one publish (the web's createPublishWatch).
  public static func createPublishWatch(
    slowMs: Double = slowPublishMs, hardMs: Double = hardPublishMs, onSlow: (@Sendable () -> Void)? = nil,
    onHard: (@Sendable () -> Void)? = nil, setTimer: PublishWatch.SetTimer? = nil,
    clearTimer: PublishWatch.ClearTimer? = nil
  ) -> PublishWatch {
    PublishWatch(
      slowMs: slowMs, hardMs: hardMs, onSlow: onSlow, onHard: onHard, setTimer: setTimer, clearTimer: clearTimer)
  }

  /// The line the busy row shows for a publish progress event, or nil.
  /// `event` is `{ phase, kind?, done?, total?, step?, progress?, count? }`.
  public static func progressLine(_ event: JSONValue?, posts: Double = 1) -> String? {
    guard let event, case .object = event else { return nil }
    let phase = event["phase"]
    if phase == "uploading" && event["kind"] == "images" {
      guard let total = ComposerJS.or(event["total"], nil) else { return nil }
      let one = total == .number(1)
      let totalText = total.jsString
      return ComposerJS.greaterOrEqual(event["done"], total)
        ? "Uploaded \(one ? "the image" : "\(totalText) images")"
        : "Uploading \(one ? "the image" : "images, \(jsText(event["done"])) of \(totalText)")"
    }
    if phase == "uploading" && event["kind"] == "card" { return "Adding the link card’s image" }
    if phase == "video" {
      if event["step"] == "checking" { return "Checking the video" }
      if event["step"] == "uploading" { return "Uploading the video" }
      if event["step"] == "processing" {
        let progress = ComposerJS.or(event["progress"], .number(0)).jsNumber
        let pct = (progress * (event["progress"].jsNumber > 1 ? 1 : 100)).jsRounded
        return pct > 0 ? "Processing the video, \(JSNumber.format(pct))%" : "Processing the video"
      }
    }
    if phase == "writing" {
      let n = ComposerJS.or(event["count"], .number(posts)) ?? .number(posts)
      return n.jsNumber > 1 ? "Publishing \(n.jsString) posts to your repo" : "Publishing to your repo"
    }
    return nil
  }

  /// `${v}` for a loose value (undefined says so).
  static func jsText(_ value: JSONValue?) -> String { value?.jsString ?? "undefined" }

  /// How to show a publish that failed.
  public static func publishErrorView(_ error: (any Error)?) -> PublishErrorView {
    guard let error else { return PublishErrorView(message: "", silent: true, permission: false, reauth: false) }
    let fields = JSErrorFields(error)
    let canceled = (error as? any CancelMarkedError)?.canceled ?? false
    if fields?.codeString == "ABORTED" || fields?.name == "AbortError" || canceled {
      return PublishErrorView(message: "", silent: true, permission: false, reauth: false)
    }
    if fields?.codeString == "MISSING_SCOPE" || Scopes.isMissingScopeError(error) {
      return PublishErrorView(
        message: "Virga needs permission to post. Sign in again to grant it.", silent: false, permission: true,
        reauth: false)
    }
    if Accounts.isReauthRequiredError(error) || fields?.status == 401 {
      return PublishErrorView(
        message: "This account needs to sign in again before it can post.", silent: false, permission: false,
        reauth: true)
    }
    let text = (fields?.message ?? "").jsTrimmed()
    return PublishErrorView(
      message: text.isEmpty ? "The post didn’t go out. Try again." : text, silent: false, permission: false,
      reauth: false)
  }

  /// The account as the success line names it: "@handle", else its DID.
  public static func accountLabel(_ account: JSONValue?, _ did: String?) -> String {
    if let handle = account?["handle"], handle.isTruthy { return "@\(handle.jsString)" }
    if let name = account?["displayName"], name.isTruthy { return name.jsString }
    if let did, !did.isEmpty { return did }
    return "this account"
  }

  /// The toast after a post goes out. `root` is the thread's root `{ uri }`.
  public static func postedToast(account: JSONValue?, did: String?, root: JSONValue?) -> PostedToast {
    let uri = root?["uri"]
    let href = uri.flatMap { $0.isTruthy ? PostLink.bskyUrlFor($0.jsString, account?["handle"]?.stringValue) : nil }
    return PostedToast(text: "Posted as \(accountLabel(account, did)).", href: href)
  }

  /// "today at 9:00 AM", "tomorrow at …" or "Mon, Nov 16 at …", on the
  /// clock of `timeZone` (nil: the device's). A time without an offset is
  /// read on the device's clock, `localZone` (nil: the active zone).
  public static func whenWords(
    _ iso: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil, localZone: TimeZone? = nil
  ) -> String {
    let device = localZone ?? AppLocale.activeTimeZone()
    let zone = timeZone ?? device
    let at = TimerJS.dateMs(iso, timeZone: device)
    if !at.isFinite { return "" }
    func day(_ ms: Double) -> String {
      JSDate.fields(ms, timeZone: zone).map { "\($0.year)-\($0.month)-\($0.date)" } ?? "Invalid Date"
    }
    let time = AppLocale.toLocaleTimeString(
      at, DateFormatOptions(hour: "numeric", minute: "2-digit"), locale: locale, timeZone: zone)
    let today = day(now)
    let tomorrow = day(now + 86_400_000)
    if day(at) == today { return "today at \(time)" }
    if day(at) == tomorrow { return "tomorrow at \(time)" }
    let date = AppLocale.toLocaleDateString(
      at, DateFormatOptions(weekday: "short", month: "short", day: "numeric"), locale: locale, timeZone: zone)
    return "\(date) at \(time)"
  }

  /// "Scheduled for tomorrow at 9:00 AM as @x." and the queue's version.
  /// With a `repeat` rule it says so: "…as @x, repeating every week."
  public static func scheduledMessage(
    at: JSONValue?, queued: Bool = false, editing: Bool = false, account: JSONValue? = nil, did: String? = nil,
    now: Double, locale: String? = nil, timeZone: TimeZone? = nil, localZone: TimeZone? = nil,
    repeat rule: JSONValue? = nil
  ) -> String {
    let when = whenWords(at, now: now, locale: locale, timeZone: timeZone, localZone: localZone)
    let who = accountLabel(account, did)
    if queued { return "\(editing ? "Moved in" : "Added to") the queue, going out \(when) as \(who)." }
    return "\(editing ? "Rescheduled" : "Scheduled") for \(when) as \(who)\(Repeat.repeatClause(rule))."
  }

  /// The rows that hold queue slots for this post's slot search: every
  /// queued row (any app's), leaving out the row being edited.
  public static func queueSlotRows(_ rows: [JSONValue]?, excludeId: JSONValue? = .null) -> [JSONValue] {
    (rows ?? []).filter { r in
      ComposerJS.truthy(r) && ComposerJS.truthy(r["queued"]) && !ComposerJS.strictEquals(r["id"], excludeId)
        && ComposerJS.includes(["pending", "publishing", "failed"], r["status"])
    }
  }

  /// `err?.status` for the errors the scheduled service throws.
  public static func status(of error: any Error) -> Int? { JSErrorFields(error)?.status }

  /// After a post went out from a draft or a scheduled post: delete the
  /// draft (as its owner), or cancel the scheduled row so it doesn't go out
  /// again (one retry). Never throws.
  public static func finishSource<Agent, Requester>(
    _ source: JSONValue?,
    asDid: String,
    agentFor: (String) async throws -> Agent,
    backendFor: ((String) -> Requester?)?,
    deleteDraft: (Agent, JSONValue) async throws -> Void,
    cancelScheduled: (Requester, JSONValue) async throws -> Void,
    wait: (Double) async -> Void = { ms in try? await Task.sleep(nanoseconds: UInt64(ms * 1_000_000)) }
  ) async -> FinishSourceResult {
    guard let source, let id = source["id"], id.isTruthy else {
      return FinishSourceResult(status: "none", warning: "", keepSource: false)
    }
    if source["kind"] == "draft" {
      do {
        let owner = ComposerJS.str(source["ownerDid"])
        let agent = try await agentFor(owner.isEmpty ? asDid : owner)
        try await deleteDraft(agent, id)
        return FinishSourceResult(status: "done", warning: "", keepSource: false)
      } catch {
        return FinishSourceResult(status: "failed", warning: draftNotDeleted, keepSource: false)
      }
    }
    if source["kind"] == "scheduled" {
      let req = backendFor?(asDid)
      for attempt in 0..<2 {
        do {
          guard let req else { throw JSError(message: "No server session") }
          try await cancelScheduled(req, id)
          return FinishSourceResult(status: "done", warning: "", keepSource: false)
        } catch {
          // Already gone or going out counts: the worker won't send it twice.
          if status(of: error) == 404 { return FinishSourceResult(status: "done", warning: "", keepSource: false) }
          if attempt == 0 { await wait(1500) }
        }
      }
      return FinishSourceResult(status: "failed", warning: scheduledCopyRemains, keepSource: true)
    }
    return FinishSourceResult(status: "none", warning: "", keepSource: false)
  }
}
