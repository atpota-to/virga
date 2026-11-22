// Ports src/posting/pages/scheduleModel.js
//
// What the Scheduled, Weekly schedule and Timers pages (and the time
// picker) show, worked out from the server's rows and the account's weekly
// schedule. Pure: every clock is passed in, and nothing here reads storage
// or the network (postScheduledNow takes its I/O as closures).
//
// Rows are the server's JSON. `timeZone` is this device's zone (nil: the
// active one): a time without an offset is read in it, and a time said "in
// the queue's zone" falls back to it when that zone can't be read. `locale`
// nil is the active one. Split across ScheduleModel.swift (the list, its
// rows, times in a zone, reordering, limits), ScheduleModel+Timers.swift
// (timer rows and the weekly schedule) and ScheduleModel+Picker.swift (the
// time picker and posting a row now).

import Foundation
import VirgaCore

/// scheduledSections' answer, each soonest first.
public struct ScheduledSections: Hashable, Sendable {
  /// Didn't go out (failed), whatever its kind.
  public var attention: [JSONValue]
  /// Waiting in the weekly queue, or going out from it now.
  public var queue: [JSONValue]
  /// Waiting for a time of its own, or going out now.
  public var timed: [JSONValue]

  public var json: JSONValue { ["attention": .array(attention), "queue": .array(queue), "timed": .array(timed)] }
}

/// What a scheduled reply answers: '@handle', a name, or 'a post'; and the
/// start of what was said, or ''.
public struct RowReply: Codable, Hashable, Sendable {
  public var who: String
  public var text: String
}

/// What a scheduled row holds, for its line of facts.
public struct RowFacts: Codable, Hashable, Sendable {
  public var text: String
  public var posts: Int
  public var images: Int
  public var quote: Bool
  public var link: Bool
  public var limited: Bool
  public var reply: RowReply?
  /// The timer as a sentence, or ''.
  public var timer: String

  enum CodingKeys: String, CodingKey { case text, posts, images, quote, link, limited, reply, timer }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(text, forKey: .text)
    try c.encode(posts, forKey: .posts)
    try c.encode(images, forKey: .images)
    try c.encode(quote, forKey: .quote)
    try c.encode(link, forKey: .link)
    try c.encode(limited, forKey: .limited)
    try c.encode(reply, forKey: .reply)
    try c.encode(timer, forKey: .timer)
  }
}

/// A row's state: `tone` 'wait' | 'busy' | 'danger' | 'warn'.
public struct RowStatus: Codable, Hashable, Sendable {
  public var tone: String
  public var label: String
  public var detail: String
}

/// What can be done to a row from the Scheduled page.
public struct RowActions: Codable, Hashable, Sendable {
  public var edit: Bool
  public var postNow: Bool
  public var retry: Bool
  public var cancel: Bool
  public var skip: Bool
  public var stopRepeat: Bool
}

/// The post a timer note's "Set a timer" hands TimerDialog.
public struct TimerNoteArm: Hashable, Sendable {
  public var uri: String
  public var text: String
  /// `row.scheduledFor` as the row holds it (nil: absent).
  public var postedAt: JSONValue?
  public var extraUris: [String]
  public var row: JSONValue

  public var json: JSONValue {
    var out: JSONValue = [
      "uri": .string(uri), "text": .string(text), "extraUris": .array(extraUris.map(JSONValue.string)), "row": row,
    ]
    if let postedAt { out["postedAt"] = postedAt }
    return out
  }
}

/// What the "A timer couldn't be set" list offers for one note row.
public struct TimerNoteActions: Hashable, Sendable {
  public var arm: TimerNoteArm?
  public var dismiss: Bool
  public var note: String

  public var json: JSONValue { ["arm": arm?.json ?? .null, "dismiss": .bool(dismiss), "note": .string(note)] }
}

/// A run of rows going out on one day in the queue's zone.
public struct ZonedDayGroup: Hashable, Sendable {
  public var key: String
  public var label: String
  public var rows: [JSONValue]

  public var json: JSONValue { ["key": .string(key), "label": .string(label), "rows": .array(rows)] }
}

public enum ScheduleModel {
  static func instant(_ value: JSONValue?, _ zone: TimeZone?) -> Double { ScheduleJS.instant(value, zone) }

  static func byTime(_ rows: [JSONValue], _ zone: TimeZone?) -> [JSONValue] {
    TimerJS.v8Sorted(rows) { instant($0["scheduledFor"], zone) - instant($1["scheduledFor"], zone) }
  }

  // MARK: The scheduled list

  /// listScheduled's `rows` in the page's three sections, each soonest
  /// first: attention (failed), queue (waiting in the weekly queue, or
  /// going out from it now), timed (waiting for a time of its own, or going
  /// out now).
  public static func scheduledSections(_ rows: [JSONValue]? = [], timeZone: TimeZone? = nil) -> ScheduledSections {
    var attention: [JSONValue] = []
    var queue: [JSONValue] = []
    var timed: [JSONValue] = []
    for row in rows ?? [] where row.isTruthy {
      if row["status"] == "failed" {
        attention.append(row)
      } else if row["status"] == "pending" || row["status"] == "publishing" {
        if ComposerJS.truthy(row["queued"]) { queue.append(row) } else { timed.append(row) }
      }
    }
    return ScheduledSections(
      attention: byTime(attention, timeZone), queue: byTime(queue, timeZone), timed: byTime(timed, timeZone))
  }

  static func embedKind(_ embed: JSONValue?) -> JSONValue? {
    TimerJS.isObject(embed) ? embed?["type"] : nil
  }

  /// What a scheduled reply answers, as far as the row remembers, or nil
  /// for a row that isn't a reply.
  public static func rowReply(_ row: JSONValue?) -> RowReply? {
    guard ComposerJS.truthy(row?["payload"]?["reply"]?["parent"]?["uri"]) else { return nil }
    let hint = ComposerJS.or(row?["payload"]?["replyTo"], [:]) ?? [:]
    let handle = hint["handle"]?.stringValue?.jsTrimmed() ?? ""
    let name = hint["displayName"]?.stringValue?.jsTrimmed() ?? ""
    return RowReply(
      who: !handle.isEmpty ? "@\(handle)" : (!name.isEmpty ? name : "a post"),
      text: hint["text"]?.stringValue.map { ScheduleJS.collapseSpace($0).jsTrimmed() } ?? "")
  }

  /// What a scheduled row holds, for its line of facts: its words, how many
  /// posts, pictures, a quote or link, whether replies or quotes are
  /// limited, what it replies to, and its timer as a sentence (said at
  /// `now`, the web's Date.now()).
  public static func rowFacts(_ row: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil)
    -> RowFacts
  {
    let posts = row?["payload"]?["posts"]?.arrayValue ?? []
    let text = ScheduledPostError.text(posts.first?["record"]?["text"]).jsTrimmed()
    var images = 0
    var quote = false
    var link = false
    for post in posts {
      let embed = post["embed"]
      let kind = embedKind(embed)
      if kind == "images" { images += Int(ScheduleJS.count(embed?["images"])) }
      if kind == "external" { link = true }
      if kind == "record" { quote = true }
      if kind == "recordWithMedia" {
        quote = true
        if embedKind(embed?["media"]) == "images" { images += Int(ScheduleJS.count(embed?["media"]?["images"])) }
        if embedKind(embed?["media"]) == "external" { link = true }
      }
    }
    let gates = ComposerJS.or(row?["payload"]?["gates"], [:]) ?? [:]
    let limited = gates["threadgate"]?.arrayValue != nil || !(gates["postgate"]?.arrayValue?.isEmpty ?? true)
    var timer = ""
    if let spec = row?["payload"]?["selfDestruct"], spec.isTruthy {
      TimerJS.inZone(timeZone) {
        var fields = ComposerJS.spread(spec)
        fields["enabled"] = true
        let rule = SelfDestruct.readStoredTimer(.object(fields)).timer
        if rule.enabled { timer = SelfDestruct.describeTimer(rule, now: now, locale: locale, timeZone: timeZone) }
      }
    }
    return RowFacts(
      text: text, posts: posts.count, images: images, quote: quote, link: link, limited: limited,
      reply: rowReply(row), timer: timer)
  }

  /// A row's facts as short tags, in the order the row shows them.
  public static func rowTags(_ facts: RowFacts) -> [String] {
    var tags: [String] = []
    if facts.posts > 1 { tags.append("Thread of \(facts.posts)") }
    if facts.images != 0 { tags.append(facts.images == 1 ? "1 image" : "\(facts.images) images") }
    if facts.quote { tags.append("Quote") }
    if facts.link { tags.append("Link card") }
    if facts.limited { tags.append("Replies or quotes limited") }
    return tags
  }

  /// A scheduled row's state: 'wait' (pending), 'busy' (going out),
  /// 'danger' (failed, with the reason in Virga's words), and 'warn' for a
  /// thread part of which is already out.
  public static func rowStatus(_ row: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> RowStatus {
    if row?["status"] == "publishing" { return RowStatus(tone: "busy", label: "Going out now", detail: "") }
    let partial = ComposerJS.truthy(row?["partial"])
    if row?["status"] == "failed" {
      let reason = ScheduledPostError.friendlyScheduleError(row?["lastError"], row?["lastErrorCode"])
      return RowStatus(
        tone: "danger", label: partial ? "Stopped part way" : "Didn’t go out",
        detail: partial ? "\(reason) Part of the thread is already out; retrying posts the rest." : reason)
    }
    if partial {
      return RowStatus(
        tone: "warn", label: "Part of it is out", detail: "Part of this thread is already out. The rest follows.")
    }
    let ms = instant(row?["scheduledFor"], timeZone)
    if ms.isFinite && ms <= now { return RowStatus(tone: "busy", label: "Due now", detail: "") }
    return RowStatus(tone: "wait", label: "Waiting", detail: "")
  }

  /// How close to its time a waiting row stops offering "Post now". Posting
  /// now publishes first and takes the scheduled copy off after, so a row
  /// the per-minute worker can pick up while that publish runs would go out
  /// twice. Two minutes covers a worker tick and a slow publish.
  public static let postNowCutoffMs: Double = 2 * 60 * 1000

  /// Whether a waiting row is due, or close enough to its time that the
  /// worker may take it before "Post now" could take it off: its time (or
  /// its next retry, when the row carries one) is within postNowCutoffMs. A
  /// row whose time has passed with no retry time known counts as due.
  public static func rowIsDueSoon(_ row: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> Bool {
    guard row?["status"] == "pending" else { return false }
    let at = instant(row?["scheduledFor"], timeZone)
    let retry = instant(row?["nextAttemptAt"], timeZone)
    let dueAt = retry.isFinite && retry > at ? retry : at
    return dueAt.isFinite && dueAt <= now + postNowCutoffMs
  }

  /// What can be done to a row from this page.
  public static func rowActions(_ row: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> RowActions {
    let waitingOrFailed = row?["status"] == "pending" || row?["status"] == "failed"
    let repeating = ScheduleService.isRepeatingRow(row)
    let partial = ComposerJS.truthy(row?["partial"])
    return RowActions(
      edit: ScheduleService.canEditScheduledRow(row),
      postNow: waitingOrFailed && !partial && !rowIsDueSoon(row, now: now, timeZone: timeZone),
      retry: row?["status"] == "failed",
      cancel: ScheduleService.canCancelScheduledRow(row),
      skip: repeating && row?["status"] == "pending" && !partial,
      stopRepeat: repeating && waitingOrFailed)
  }

  /// The collection a timer can go on (the server refuses any other).
  static let bskyPost = "app.bsky.feed.post"

  /// What the "A timer couldn't be set" list offers for one note row: the
  /// post to hand TimerDialog (nil when there's no Bluesky post to put a
  /// timer on), Dismiss (always: the note is the account's), and a note in
  /// place of the button ('').
  public static func timerNoteActions(_ row: JSONValue?, now: Double = 0) -> TimerNoteActions {
    let uri = row?["resultUri"]?.stringValue ?? ""
    let parts = PostingQueue.split(uri, 0x2F)
    let repo = parts.count > 2 ? parts[2] : ""
    let collection = parts.count > 3 ? parts[3] : ""
    guard !uri.isEmpty, collection.jsEquals(bskyPost) else {
      return TimerNoteActions(arm: nil, dismiss: true, note: "")
    }
    let rkeys = row?["payload"]?["rkeys"]?.arrayValue ?? []
    let extra = ComposerJS.slice(rkeys, 1).compactMap { key -> String? in
      guard let k = key.stringValue, !k.isEmpty else { return nil }
      return "at://\(repo)/\(collection)/\(k)"
    }
    return TimerNoteActions(
      arm: TimerNoteArm(
        uri: uri, text: rowFacts(row, now: now).text, postedAt: row?["scheduledFor"], extraUris: extra,
        row: row ?? .null),
      dismiss: true, note: "")
  }

  // MARK: Times in the queue's zone

  /// A zone as people write it: 'America/New_York' → 'America/New York'.
  public static func zoneLabel(_ tz: JSONValue?) -> String {
    String(decoding: ScheduledPostError.text(tz).utf16.map { $0 == 0x5F ? 0x20 : $0 }, as: UTF16.self)
  }

  public static func zoneLabel(_ tz: String?) -> String { zoneLabel(tz.map(JSONValue.string)) }

  /// `new Intl.DateTimeFormat(locale, { ...options, timeZone: tz })`, or
  /// this device's zone when `tz` is empty or Intl can't read it.
  static func safeFormat(
    _ ms: Double, _ tz: String?, _ options: DateFormatOptions, locale: String?, timeZone: TimeZone?
  ) -> String {
    let zone = tz.flatMap { $0.isEmpty ? nil : PostingQueue.timeZone(named: $0) } ?? timeZone
    return AppLocale.formatDateTime(ms, options, locale: locale, timeZone: zone)
  }

  /// 'Fri, Nov 14, 9:00 AM' (with the year when it isn't this one, by UTC
  /// year), in `tz`; without the weekday given `weekday: false`.
  public static func formatInZone(
    _ value: JSONValue?, _ tz: String?, now: Double, weekday: Bool = true, locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    let ms = instant(value, timeZone)
    guard ms.isFinite else { return "" }
    let sameYear = JSDate.utcFields(ms)?.year == JSDate.utcFields(now)?.year && JSDate.utcFields(now) != nil
    return safeFormat(
      ms, tz,
      DateFormatOptions(
        weekday: weekday ? "short" : nil, year: sameYear ? nil : "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit"),
      locale: locale, timeZone: timeZone)
  }

  /// '9:00 AM' in `tz`.
  public static func timeInZone(_ value: JSONValue?, _ tz: String?, locale: String? = nil, timeZone: TimeZone? = nil)
    -> String
  {
    let ms = instant(value, timeZone)
    guard ms.isFinite else { return "" }
    return safeFormat(ms, tz, DateFormatOptions(hour: "numeric", minute: "2-digit"), locale: locale, timeZone: timeZone)
  }

  /// An 'HH:MM' slot as this browser writes a time of day: '17:30' →
  /// '5:30 PM'. Anything else as it is. The web formats in the browser's
  /// own locale (`toLocaleTimeString(undefined, …)`), the port in `locale`
  /// (nil: the active one).
  public static func slotLabel(_ hhmm: JSONValue?, locale: String? = nil) -> String {
    let text = ScheduledPostError.text(hhmm)
    guard let parts = PostingQueue.fields(text, [2, 2], ":") else { return text }
    return AppLocale.toLocaleTimeString(
      JSDate.utc(2000, 0, 3, parts[0], parts[1]), DateFormatOptions(hour: "numeric", minute: "2-digit"),
      locale: locale, timeZone: TimeZone(identifier: "UTC")!)
  }

  public static func slotLabel(_ hhmm: String?, locale: String? = nil) -> String {
    slotLabel(hhmm.map(JSONValue.string), locale: locale)
  }

  /// Rows grouped by the day they go out, in the queue's zone (`tz`; nil is
  /// this device's, as Intl reads an undefined zone), in the rows' order.
  /// Labels say Today, Tomorrow, a weekday this week, else the date; a time
  /// already past is Overdue.
  public static func groupByZonedDay(
    _ rows: [JSONValue]? = [], _ tz: String?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> [ZonedDayGroup] {
    let zoneName: JSONValue = .string(tz ?? PostingQueue.intlName(timeZone ?? AppLocale.activeTimeZone()))
    let today = PostingQueue.zonedWallTime(.number(now), zoneName, timeZone: timeZone)
    func dayIndex(_ date: String) -> Double {
      (JSDate.parse("\(date)T00:00:00Z", timeZone: TimeZone(identifier: "UTC")!) / 86_400_000).jsRounded
    }
    var groups: [ZonedDayGroup] = []
    for row in rows ?? [] {
      let ms = instant(row["scheduledFor"], timeZone)
      let wall = ms.isFinite ? PostingQueue.zonedWallTime(ms: ms, zoneName) : nil
      let key: String
      let label: String
      if let wall, let today {
        if ms <= now {
          key = "overdue"
          label = "Overdue"
        } else {
          key = wall.date
          let diff = dayIndex(wall.date) - dayIndex(today.date)
          if diff == 0 {
            label = "Today"
          } else if diff == 1 {
            label = "Tomorrow"
          } else if diff < 7 {
            label = safeFormat(ms, tz, DateFormatOptions(weekday: "long"), locale: locale, timeZone: timeZone)
          } else {
            label = safeFormat(
              ms, tz, DateFormatOptions(weekday: "long", month: "long", day: "numeric"), locale: locale,
              timeZone: timeZone)
          }
        }
      } else {
        key = "unknown"
        label = "No time"
      }
      if let last = groups.last, last.key.jsEquals(key) {
        groups[groups.count - 1].rows.append(row)
      } else {
        groups.append(ZonedDayGroup(key: key, label: label, rows: [row]))
      }
    }
    return groups
  }

  // MARK: Reordering

  /// The queue as drawn while its order changes: every row stays where it
  /// is, except that the places this app's movable rows hold are filled, in
  /// turn, by `movableIds` (the new order). Other apps' rows and rows part
  /// way out keep their places. Ids match as a Set and a Map match keys.
  public static func previewOrder(_ queueRows: [JSONValue]? = [], _ movableIds: [JSONValue] = []) -> [JSONValue] {
    let rows = queueRows ?? []
    func byId(_ id: JSONValue) -> JSONValue? {
      rows.last { ComposerJS.sameValueZero($0["id"], id) }
    }
    let next = movableIds.compactMap(byId)
    var i = 0
    return rows.map { row in
      if movableIds.contains(where: { ComposerJS.sameValueZero($0, row["id"]) }), i < next.count {
        defer { i += 1 }
        return next[i]
      }
      return row
    }
  }

  /// `ids` with `id` moved `delta` places (clamped), or the same list when
  /// it can't move.
  public static func moveId(_ ids: [JSONValue] = [], _ id: JSONValue?, _ delta: Double) -> [JSONValue] {
    guard let from = ids.firstIndex(where: { ComposerJS.strictEquals($0, id) }), delta != 0, !delta.isNaN else {
      return ids
    }
    let to = Swift.max(0, Swift.min(Double(ids.count - 1), Double(from) + delta))
    if to == Double(from) { return ids }
    var out = ids
    out.remove(at: from)
    // splice reads its index as an integer.
    let at = Swift.min(out.count, Swift.max(0, Int(to.rounded(.towardZero))))
    out.insert(id ?? .null, at: at)
    return out
  }

  /// `ids` with `id` put at `index`.
  public static func moveIdTo(_ ids: [JSONValue] = [], _ id: JSONValue?, _ index: Double) -> [JSONValue] {
    guard let from = ids.firstIndex(where: { ComposerJS.strictEquals($0, id) }) else { return ids }
    return moveId(ids, id, index - Double(from))
  }

  /// The ids of the rows that may move in the queue, soonest first (absent
  /// ids as null).
  public static func movableIds(_ rows: [JSONValue]? = [], now: Double, timeZone: TimeZone? = nil) -> [JSONValue] {
    QueueReorder.splitQueueRows(rows, now: now, timeZone: timeZone).movable.map { $0["id"] ?? .null }
  }

  /// Rows with the times an assignment gives them (an optimistic redraw).
  public static func applyAssignment(_ rows: [JSONValue]? = [], _ assignment: JSONValue? = []) -> [JSONValue] {
    var next: [(id: JSONValue?, at: JSONValue)] = []
    for a in assignment?.arrayValue ?? [] {
      guard let at = a["newScheduledFor"], at.isTruthy else { continue }
      if let i = next.firstIndex(where: { ComposerJS.sameValueZero($0.id, a["id"]) }) {
        next[i].at = at
      } else {
        next.append((a["id"], at))
      }
    }
    return (rows ?? []).map { row in
      guard let found = next.first(where: { ComposerJS.sameValueZero($0.id, row["id"]) }) else { return row }
      var out = row
      out["scheduledFor"] = found.at
      return out
    }
  }

  public static func applyAssignment(_ rows: [JSONValue]?, _ assignment: [QueueAssignment]) -> [JSONValue] {
    applyAssignment(rows, (try? JSONValue(encoding: assignment)) ?? [])
  }

  // MARK: Limits

  static func finite(_ value: JSONValue?) -> Double? {
    if case .number(let n)? = value, n.isFinite { return n }
    return nil
  }

  /// The scheduled-posts line under the list: '2 of 3 scheduled posts in
  /// use.' for a limited account, the server's ceiling for one without a
  /// limit ('Up to 50 can wait at a time.'), '' when nothing is known.
  public static func scheduledLimitsLine(_ limits: JSONValue?) -> String {
    guard let limits, limits.isTruthy else { return "" }
    if let limit = finite(limits["features"]?["scheduledPosts"]?["limit"]) {
      let posts = limit == 1 ? "post" : "posts"
      guard let used = finite(limits["usage"]?["scheduledPosts"]) else {
        return "This account can keep \(JSNumber.format(limit)) scheduled \(posts) at a time."
      }
      return "\(JSNumber.format(Swift.min(used, limit))) of \(JSNumber.format(limit)) scheduled \(posts) in use."
    }
    if let cap = finite(limits["caps"]?["scheduledPosts"]) { return "Up to \(JSNumber.format(cap)) can wait at a time." }
    if ComposerJS.truthy(limits["policy"]) { return "No limit on scheduled posts." }
    return ""
  }

  /// The timers line: what's in use in each limited bucket, counting
  /// scheduled posts that carry a timer. '' when neither bucket is limited,
  /// or nothing is known. `fallbackUsage` (timerUsage's) fills in a count
  /// the server didn't send.
  public static func timerLimitsLine(_ limits: JSONValue?, _ fallbackUsage: JSONValue? = nil) -> String {
    guard let limits, limits.isTruthy else { return "" }
    var parts: [String] = []
    for (bucket, noun) in [("plain", "plain timer"), ("conditional", "conditional timer")] {
      let feature = SelfDestruct.timerBucketFeature[bucket]!
      guard let limit = finite(limits["features"]?[feature]?["limit"]) else { continue }
      var used = finite(limits["usage"]?[feature])
      if used == nil, let fallbackUsage, fallbackUsage.isTruthy { used = finite(fallbackUsage[bucket]) }
      let nouns = limit == 1 ? noun : "\(noun)s"
      if let used {
        parts.append("\(JSNumber.format(Swift.min(used, limit))) of \(JSNumber.format(limit)) \(nouns)")
      } else {
        parts.append("\(JSNumber.format(limit)) \(nouns)")
      }
    }
    if parts.isEmpty {
      if let cap = finite(limits["caps"]?["timers"]) { return "Up to \(JSNumber.format(cap)) can count down at a time." }
      return ComposerJS.truthy(limits["policy"]) ? "No limit on timers." : ""
    }
    return "In use: \(parts.joined(separator: " and ")), counting scheduled posts with a timer."
  }

  /// timerLimitsLine with timerUsage's counts.
  public static func timerLimitsLine(_ limits: JSONValue?, _ fallbackUsage: TimerUsage) -> String {
    timerLimitsLine(
      limits,
      ["plain": .number(Double(fallbackUsage.plain)), "conditional": .number(Double(fallbackUsage.conditional))])
  }

  /// The slot sentence for each limited bucket that's full, for a callout.
  public static func fullTimerBuckets(_ limits: JSONValue?) -> [String] {
    var out: [String] = []
    for bucket in ["plain", "conditional"] {
      let feature = SelfDestruct.timerBucketFeature[bucket]!
      if let limit = finite(limits?["features"]?[feature]?["limit"]), let used = finite(limits?["usage"]?[feature]),
        used >= limit
      {
        out.append(SelfDestruct.timerSlotSentence(bucket, limit))
      }
    }
    return out
  }
}
