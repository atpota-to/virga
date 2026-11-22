// Ports src/posting/pages/scheduleModel.js
//
// The Timers page's rows and sections, and the Weekly schedule page's week:
// its summary, its edits and the open times it offers. A day's slots that
// aren't a list read as none, where the web throws spreading or sorting
// one (corrupt input only).

import Foundation
import VirgaCore

/// A step a settled timer took, as its row says it.
public struct TimerActed: Codable, Hashable, Sendable {
  public var ok: Bool
  public var text: String
}

/// Everything a timer row shows.
public struct TimerRowModel: Hashable, Sendable {
  public var id: JSONValue?
  public var text: String
  public var live: Bool
  /// 'Acts in 3 hr', 'Checking now', or the settled state's word.
  public var when: String
  public var rule: String
  public var bucket: String
  public var extensions: String
  public var resolution: String
  public var acted: [TimerActed]
  public var failure: String
  public var canCancel: Bool
  public var cancelLabel: String

  public var json: JSONValue {
    var out: JSONValue = [
      "text": .string(text), "live": .bool(live), "when": .string(when), "rule": .string(rule),
      "bucket": .string(bucket), "extensions": .string(extensions), "resolution": .string(resolution),
      "acted": .array(acted.map { ["ok": .bool($0.ok), "text": .string($0.text)] }),
      "failure": .string(failure), "canCancel": .bool(canCancel), "cancelLabel": .string(cancelLabel),
    ]
    if let id { out["id"] = id }
    return out
  }
}

/// A "copy to" choice: the days it names.
public struct CopyTarget: Codable, Hashable, Sendable {
  public var key: String
  public var label: String
  public var days: [String]
}

/// What the web throws reading a value as a string.
public struct ScheduleModelTypeError: Error, LocalizedError, Hashable, Sendable {
  public var message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

extension ScheduleModel {
  // MARK: Timers

  /// What a settled timer's state reads as.
  public static let settledLabel: [String: String] = [
    "deleted": "Deleted",
    "acted": "Changed",
    "spared": "Kept",
    "cancelled": "Called off",
    "failed": "Still up",
  ]

  static let timerFailures: [String: String] = [
    "SESSION_UNAVAILABLE":
      "Virga’s server couldn’t act as this account: its session had ended. The post is still up.",
    "ENGAGEMENT_UNAVAILABLE": "Bluesky didn’t answer when the post’s counts were checked. The post is still up.",
    "TIMED_OUT": "Virga’s server ran out of time. The post is still up.",
    "RATE_LIMITED": "Bluesky was rate limiting this account. The post is still up.",
    "REFUSED": "Bluesky refused the change. The post is still up.",
  ]

  /// Why a timer gave up, in Virga's words.
  public static func friendlyTimerError(_ code: JSONValue?, _ raw: JSONValue?) -> String {
    if let known = timerFailures.jsValue(ScheduledPostError.text(code).jsUppercased()) { return known }
    let s = ScheduledPostError.text(raw).jsLowercased()
    if s.jsIndexOf("session") >= 0 { return timerFailures["SESSION_UNAVAILABLE"]! }
    if s.jsIndexOf("rate") >= 0 { return timerFailures["RATE_LIMITED"]! }
    return "The timer gave up. The post is still up."
  }

  /// A timer row's rule as the timer model holds it (the server's row has
  /// no `enabled`).
  public static func ruleOfTimerRow(_ row: JSONValue?, timeZone: TimeZone? = nil) -> TimerRule {
    var fields: [String: JSONValue] = ["enabled": true]
    fields["lifespanSeconds"] = row?["lifespanSeconds"]
    fields["conditions"] = row?["conditions"]
    fields["effects"] = row?["effects"]
    return SelfDestruct.normalizeTimer(JSONValue.object(fields), timeZone: timeZone)
  }

  /// Everything a timer row shows: its words, when it acts, the rule, what
  /// happened, and what can be done. `now` drives the countdown. Throws the
  /// web's TypeError for a step whose action isn't a string but whose
  /// detail says something.
  public static func timerRowModel(_ row: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil)
    throws -> TimerRowModel
  {
    let status = row?["status"]
    let live = status == "armed" || status == "checking"
    let rule = ruleOfTimerRow(row, timeZone: timeZone)
    let extensions = (row?["extensions"]).jsNumber
    let count = extensions.isNaN ? 0 : extensions
    var acted = (row?["acted"]?.arrayValue ?? []).filter { TimerJS.isObject($0) }
    // A plain delete that went to plan says no more than its state does.
    if status == "deleted" && acted.allSatisfy({ $0["action"] == "delete" && $0["ok"] != .bool(false) }) {
      acted = []
    }
    let when: String
    if live {
      when =
        status == "checking"
        ? "Checking now" : "Acts \(SelfDestruct.timeUntil(row?["checkAt"], now: now, timeZone: timeZone))"
    } else {
      when = settledLabel.jsValue(status.map(\.jsString) ?? "undefined") ?? ""
    }
    return TimerRowModel(
      id: row?["id"],
      text: ScheduledPostError.text(row?["snippet"]).jsTrimmed(),
      live: live,
      when: when,
      rule: SelfDestruct.describeTimer(rule, now: now, locale: locale, timeZone: timeZone),
      bucket: SelfDestruct.timerBucket(rule),
      extensions: count > 0 ? (count == 1 ? "Kept once so far" : "Kept \(JSNumber.format(count)) times so far") : "",
      resolution: !live && ComposerJS.truthy(row?["resolution"]) ? sentence(row?["resolution"]) : "",
      acted: try acted.map { TimerActed(ok: $0["ok"] != .bool(false), text: try actedText($0)) },
      failure: status == "failed" ? friendlyTimerError(row?["lastErrorCode"], row?["lastError"]) : "",
      canCancel: status == "armed" || status == "failed",
      cancelLabel: status == "failed" ? "Dismiss" : "Call off")
  }

  /// A server note as a sentence: its first code unit upper-cased, and a stop.
  static func sentence(_ value: JSONValue?) -> String {
    let t = ScheduledPostError.text(value).jsTrimmed()
    guard let first = t.utf16.first else { return "" }
    var capped = t
    if !UTF16.isLeadSurrogate(first) && !UTF16.isTrailSurrogate(first) {
      let head = String(decoding: [first], as: UTF16.self).jsUppercased()
      capped = head + String(decoding: t.utf16.dropFirst(), as: UTF16.self)
    }
    let last = capped.utf16.last ?? 0
    return last == 0x2E || last == 0x21 || last == 0x3F ? capped : "\(capped)."
  }

  static let actedVerb: [String: (String, String)] = [
    "limitReplies": ("Limited replies", "Left the reply settings alone"),
    "disableQuotes": ("Turned off quotes", "Left quotes on"),
    "delete": ("Deleted the post", "Didn’t delete the post"),
  ]

  static func actedText(_ entry: JSONValue) throws -> String {
    let action = entry["action"]
    let (done, skipped) = actedVerb.jsValue(action.map(\.jsString) ?? "undefined") ?? ("Acted", "Skipped a step")
    let detail = ScheduledPostError.text(entry["detail"]).jsTrimmed()
    let verb = entry["ok"] == .bool(false) ? skipped : done
    // The server's detail repeats the verb for a plain success ("deleted").
    let plain = detail.jsLowercased()
    if plain.isEmpty { return "\(verb)." }
    guard let name = action?.stringValue else {
      switch action {
      case nil: throw ScheduleModelTypeError("Cannot read properties of undefined (reading 'toLowerCase')")
      case .null?: throw ScheduleModelTypeError("Cannot read properties of null (reading 'toLowerCase')")
      default: throw ScheduleModelTypeError("entry.action.toLowerCase is not a function")
      }
    }
    if plain.jsEquals(name.jsLowercased()) || PostingJS.hasPrefix(verb.jsLowercased(), plain) { return "\(verb)." }
    let trimmed = detail.utf16.last == 0x2E ? String(decoding: detail.utf16.dropLast(), as: UTF16.self) : detail
    return "\(verb): \(trimmed)."
  }

  /// The timers page's sections, in order: counting down, waiting to go
  /// out (scheduled posts with a timer), gave up, and settled.
  public static func timerSections(_ groups: [TimerGroup] = [], _ waiting: [JSONValue] = []) -> [TimerGroup] {
    var out: [TimerGroup] = []
    if let live = groups.first(where: { $0.key == "live" }) { out.append(live) }
    if !waiting.isEmpty { out.append(TimerGroup(key: "waiting", title: "Waiting to go out", rows: waiting)) }
    return out + groups.filter { $0.key != "live" }
  }

  /// The URIs a set of settled timers deleted, for the archive.
  public static func deletedPostUris(_ rows: [JSONValue]? = []) -> [String] {
    (rows ?? []).compactMap { row in row["status"] == "deleted" ? row["postUri"]?.stringValue : nil }
  }

  // MARK: The weekly schedule

  static func dayList(_ value: JSONValue?) -> [JSONValue] {
    switch value {
    case .array(let items)?: return items
    case .string(let text)? where !text.isEmpty: return text.unicodeScalars.map { .string(String($0)) }
    default: return []
    }
  }

  /// How many posting times a week holds.
  public static func weeklyCount(_ schedule: JSONValue?) -> Int {
    PostingQueue.weekdays.reduce(0) { n, d in n + Int(ScheduleJS.count(schedule?["slots"]?[d.key])) }
  }

  static let shortDay: [String: String] = [
    "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu", "fri": "Fri", "sat": "Sat", "sun": "Sun",
  ]

  /// The week in a line: 'Weekdays at 9:00 AM and 5:00 PM', 'Mon, Wed at
  /// 9:00 AM; Sat at 10:00 AM', or 'No posting times yet.' Times are said
  /// in `locale` (slotLabel).
  public static func weekSummary(_ schedule: JSONValue?, locale: String? = nil) -> String {
    if PostingQueue.isScheduleEmpty(schedule) { return "No posting times yet." }
    var groups: [(sig: String, days: [String], times: [JSONValue])] = []
    for day in PostingQueue.weekdays {
      let times = PostingQueue.defaultSorted(schedule?["slots"]?[day.key]?.arrayValue ?? [])
      if times.isEmpty { continue }
      let sig = times.map { $0.isNull ? "" : $0.jsString }.joined(separator: ",")
      if let last = groups.last, last.sig.jsEquals(sig) {
        groups[groups.count - 1].days.append(day.key)
      } else {
        groups.append((sig, [day.key], times))
      }
    }
    let order = PostingQueue.weekdays.map(\.key)
    func daysPhrase(_ days: [String]) -> String {
      let s = days.joined(separator: ",")
      if s == "mon,tue,wed,thu,fri" { return "Weekdays" }
      if s == "sat,sun" { return "Weekends" }
      if days.count == 7 { return "Every day" }
      let runs = days.indices.allSatisfy { i in
        i == 0 || order.firstIndex(of: days[i]) == order.firstIndex(of: days[i - 1]).map { $0 + 1 }
      }
      if days.count >= 3 && runs { return "\(shortDay[days[0]]!) to \(shortDay[days[days.count - 1]]!)" }
      return days.map { shortDay[$0]! }.joined(separator: ", ")
    }
    func timesPhrase(_ times: [JSONValue]) -> String {
      let labels = times.map { slotLabel($0, locale: locale) }
      if labels.count == 1 { return labels[0] }
      return "\(labels.dropLast().joined(separator: ", ")) and \(labels[labels.count - 1])"
    }
    func lead(_ phrase: String, _ i: Int) -> String {
      i > 0 && ["Weekdays", "Weekends", "Every day"].contains(phrase) ? phrase.lowercased() : phrase
    }
    let parts = groups.enumerated().map { i, g in "\(lead(daysPhrase(g.days), i)) at \(timesPhrase(g.times))" }
    return "\(parts.joined(separator: "; "))."
  }

  static func withSlots(_ schedule: JSONValue?, _ slots: [String: JSONValue]) -> JSONValue {
    ["timezone": .string(schedule?["timezone"]?.stringValue ?? ""), "slots": .object(slots)]
  }

  static func copySlots(_ schedule: JSONValue?) -> [String: JSONValue] {
    var slots: [String: JSONValue] = [:]
    for day in PostingQueue.weekdays {
      slots[day.key] = .array(dayList(ComposerJS.or(schedule?["slots"]?[day.key], nil)))
    }
    return slots
  }

  /// `/^([01]\d|2[0-3]):[0-5]\d$/`.
  static func isSlotTime(_ text: String) -> Bool {
    let u = Array(text.utf16)
    guard u.count == 5, u[2] == 0x3A else { return false }
    func digit(_ c: UInt16) -> Bool { c >= 0x30 && c <= 0x39 }
    let hourOK = (u[0] == 0x30 || u[0] == 0x31) && digit(u[1]) || u[0] == 0x32 && u[1] >= 0x30 && u[1] <= 0x33
    return hourOK && u[3] >= 0x30 && u[3] <= 0x35 && digit(u[4])
  }

  /// The week with `time` ('HH:MM') added to `day`. A week with no zone yet
  /// takes `deviceZone` (nil: this device's), so the times stay where they
  /// were set. The week as it was when there is nothing to add.
  public static func addSlot(
    _ schedule: JSONValue?, _ day: String, _ time: JSONValue?, deviceZone: String? = nil, localZone: TimeZone? = nil
  ) -> JSONValue? {
    guard isSlotTime(ScheduledPostError.text(time)), let time else { return schedule }
    var slots = copySlots(schedule)
    guard let existing = slots[day]?.arrayValue,
      !existing.contains(where: { ComposerJS.sameValueZero($0, time) })
    else { return schedule }
    slots[day] = .array(PostingQueue.defaultSorted(existing + [time]))
    var next = withSlots(schedule, slots)
    if next["timezone"] == "" {
      next["timezone"] = .string(deviceZone ?? PostingQueue.resolveTimezone(nil, localZone: localZone))
    }
    return next
  }

  public static func removeSlot(_ schedule: JSONValue?, _ day: String, _ time: JSONValue?) -> JSONValue? {
    var slots = copySlots(schedule)
    guard let existing = slots[day]?.arrayValue else { return schedule }
    slots[day] = .array(existing.filter { !ComposerJS.strictEquals($0, time) })
    return withSlots(schedule, slots)
  }

  public static func clearDay(_ schedule: JSONValue?, _ day: String) -> JSONValue? {
    var slots = copySlots(schedule)
    guard slots[day] != nil else { return schedule }
    slots[day] = []
    return withSlots(schedule, slots)
  }

  /// The week with `from`'s times put on each of `to` (replacing theirs).
  public static func copyDay(_ schedule: JSONValue?, _ from: String, _ to: [String] = [], localZone: TimeZone? = nil)
    -> JSONValue
  {
    var slots = copySlots(schedule)
    let times = slots[from]?.arrayValue ?? []
    for day in to where day != from && slots[day] != nil { slots[day] = .array(times) }
    var next = withSlots(schedule, slots)
    if next["timezone"] == "" && !times.isEmpty {
      next["timezone"] = .string(PostingQueue.resolveTimezone(nil, localZone: localZone))
    }
    return next
  }

  /// The days a "copy to" choice names.
  public static let copyTargets: [CopyTarget] = [
    CopyTarget(key: "weekdays", label: "Every weekday", days: ["mon", "tue", "wed", "thu", "fri"]),
    CopyTarget(key: "weekend", label: "The weekend", days: ["sat", "sun"]),
    CopyTarget(key: "all", label: "Every day", days: PostingQueue.weekdays.map(\.key)),
  ]

  /// The week with its wall times kept and its zone changed.
  public static func moveToZone(_ schedule: JSONValue?, _ timezone: JSONValue?) -> JSONValue {
    var next = withSlots(schedule, copySlots(schedule))
    next["timezone"] = timezone
    return next
  }

  /// The next `count` open times (epoch ms): slots of the week not held by
  /// a queued row (any app's), soonest first. A zone the slot walk can't
  /// read throws its error.
  public static func nextOpenSlots(
    _ schedule: JSONValue?, _ queuedRows: [JSONValue]? = [], now: Double, count: Double = 5, timeZone: TimeZone? = nil
  ) throws -> [Double] {
    if PostingQueue.isScheduleEmpty(schedule) { return [] }
    let taken = Set(
      (queuedRows ?? []).map { (instant($0["scheduledFor"], timeZone) / 60_000).rounded(.down) }.filter(\.isFinite))
    var out: [Double] = []
    var walk = PostingQueue.slotWalk(
      schedule, now, PostingQueue.resolveTimezone(schedule, localZone: timeZone), localZone: timeZone)
    while let ms = try walk.next() {
      if ms <= now + PostingQueue.minLeadMs { continue }
      if taken.contains((ms / 60_000).rounded(.down)) { continue }
      out.append(ms)
      if Double(out.count) >= count { break }
    }
    return out
  }

  /// This app's queued rows whose time isn't one of the week's slots any
  /// more (the week changed under them). They keep their time until the
  /// queue is re-packed.
  public static func offScheduleRows(_ schedule: JSONValue?, _ rows: [JSONValue]? = [], now: Double, timeZone: TimeZone? = nil)
    throws -> [JSONValue]
  {
    let movable = QueueReorder.splitQueueRows(rows, now: now, timeZone: timeZone).movable
    if movable.isEmpty { return [] }
    if PostingQueue.isScheduleEmpty(schedule) { return movable }
    let times = movable.map { instant($0["scheduledFor"], timeZone) }.filter(\.isFinite)
    // Math.max(...times, now): NaN when `now` is.
    let last = now.isNaN ? Double.nan : (times + [now]).max()!
    var minutes = Set<Double>()
    var walk = PostingQueue.slotWalk(
      schedule, now, PostingQueue.resolveTimezone(schedule, localZone: timeZone), localZone: timeZone)
    while let slot = try walk.next() {
      if slot > last { break }
      minutes.insert((slot / 60_000).rounded(.down))
    }
    return movable.filter { !minutes.contains((instant($0["scheduledFor"], timeZone) / 60_000).rounded(.down)) }
  }

  /// Whether the week is the one Virga ships with (for the reset button
  /// and suggestions).
  public static func isDefaultWeek(_ schedule: JSONValue?) -> Bool {
    PostingQueue.isShippedDefaultSchedule(schedule?["slots"])
  }
}
