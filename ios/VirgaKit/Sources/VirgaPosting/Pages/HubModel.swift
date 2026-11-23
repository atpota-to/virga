// Ports src/posting/pages/hubModel.js
//
// What the posting overview shows, worked out from what its reads return:
// the posts going out next, the latest drafts, the latest posts and the
// timers still counting down. Pure, so the page only fetches and draws.
//
// Rows are JSON. Times are read as the web's `Date.parse(iso || '')` reads
// them (a date-time without an offset in `timeZone`, the device's; nil: the
// active one); `locale` nil is the active one.

import Foundation
import VirgaArchive
import VirgaCore

/// scheduledOverview's answer.
public struct ScheduledOverview: Hashable, Sendable {
  /// What goes out next, soonest first.
  public var next: [JSONValue]
  /// Still to go out (pending or going out now).
  public var waiting: Int
  public var queued: Int
  public var atTime: Int
  public var failed: Int

  public var json: JSONValue {
    [
      "next": .array(next), "waiting": .number(Double(waiting)), "queued": .number(Double(queued)),
      "atTime": .number(Double(atTime)), "failed": .number(Double(failed)),
    ]
  }
}

/// timersOverview's answer.
public struct TimersOverview: Hashable, Sendable {
  public var live: Int
  /// The soonest `checkAt` among them, as the row has it.
  public var nextCheck: JSONValue?

  public var json: JSONValue { ["live": .number(Double(live)), "nextCheck": nextCheck ?? .null] }
}

public enum HubModel {
  /// `Date.parse(iso || '')`, or nil where it is NaN.
  static func time(_ iso: JSONValue?, _ zone: TimeZone?) -> Double? {
    let text = ScheduledPostError.text(iso)
    let ms = JSDate.parse(text, timeZone: zone ?? AppLocale.activeTimeZone())
    return ms.isNaN ? nil : ms
  }

  /// "1 draft", "3 drafts", with the number in the locale's form.
  public static func countPhrase(_ n: Double?, _ one: String, _ many: String? = nil, locale: String? = nil) -> String {
    let value = n.flatMap { $0.isFinite ? $0 : nil } ?? 0
    return "\(AppLocale.formatNumber(value, locale: locale)) \(value == 1 ? one : (many ?? "\(one)s"))"
  }

  /// countPhrase for a loose count: anything but a finite number is 0.
  @_disfavoredOverload
  public static func countPhrase(_ n: JSONValue?, _ one: String, _ many: String? = nil, locale: String? = nil) -> String {
    if case .number(let value)? = n { return countPhrase(value as Double?, one, many, locale: locale) }
    return countPhrase(0 as Double?, one, many, locale: locale)
  }

  /// `array.slice(0, Math.max(0, limit))` for a loose limit.
  static func head(_ items: [JSONValue], _ limit: Double) -> [JSONValue] {
    let n = Swift.max(0, limit)
    guard n.isFinite else { return n.isNaN ? [] : items }
    return Array(items.prefix(Int(n.rounded(.towardZero))))
  }

  /// The scheduled rows that are still to go out, soonest first, at most
  /// `limit` of them, plus the counts the overview's figures need. A failed
  /// row is counted on its own, because it needs the writer's attention
  /// rather than patience.
  public static func scheduledOverview(_ rows: JSONValue?, limit: Double = 4, timeZone: TimeZone? = nil)
    -> ScheduledOverview
  {
    let list = (rows?.arrayValue ?? []).filter(\.isTruthy)
    let waitingRows = TimerJS.v8Sorted(list.filter { $0["status"] == "pending" || $0["status"] == "publishing" }) {
      (time($0["scheduledFor"], timeZone) ?? .infinity) - (time($1["scheduledFor"], timeZone) ?? .infinity)
    }
    return ScheduledOverview(
      next: head(waitingRows, limit),
      waiting: waitingRows.count,
      queued: waitingRows.filter { ComposerJS.truthy($0["queued"]) }.count,
      atTime: waitingRows.filter { !ComposerJS.truthy($0["queued"]) }.count,
      failed: list.filter { $0["status"] == "failed" }.count)
  }

  /// The first line of a scheduled row's first post, or what it carries;
  /// cut to `max` code points.
  public static func scheduledSnippet(_ row: JSONValue?, max: Int = 120) -> String {
    let post = ComposerJS.or(ScheduleJS.first(row?["payload"]?["posts"]), nil)
    let text = ScheduleJS.collapseSpace(ScheduledPostError.text(post?["record"]?["text"])).jsTrimmed()
    let more = ScheduleJS.count(row?["payload"]?["posts"]) > 1
    if text.isEmpty {
      let type = post?["embed"]?["type"]
      let base: String
      switch type?.stringValue {
      case "images"?: base = "A post with images"
      case "external"?: base = "A link"
      case "record"?, "recordWithMedia"?: base = "A quote"
      default: base = "A post with no text"
      }
      return more ? "\(base) (thread)" : base
    }
    let chars = Array(text.unicodeScalars)
    guard chars.count > max else { return text }
    var kept = String.UnicodeScalarView()
    kept.append(contentsOf: ComposerJS.slice(chars, 0, max - 1))
    return String(kept) + "…"
  }

  /// Draft summaries for a list, the most recently changed first:
  /// summarizeDraft's rows. `limit` nil keeps them all.
  public static func draftRows(_ drafts: JSONValue?, deviceId: String? = nil, limit: Double? = nil, timeZone: TimeZone? = nil)
    -> [JSONValue]
  {
    let rows = (drafts?.arrayValue ?? []).filter { ComposerJS.truthy($0["id"]) }.map {
      Drafts.summarizeDraft($0, deviceId: deviceId)
    }
    let sorted = TimerJS.v8Sorted(rows) {
      (time($1["updatedAt"], timeZone) ?? -.infinity) - (time($0["updatedAt"], timeZone) ?? -.infinity)
    }
    guard let limit else { return sorted }
    return head(sorted, limit)
  }

  /// A post view from the author feed as an archive row (the archive's
  /// compact shape), counts included, so the overview and the Posted page
  /// can list what the archive hasn't synced yet beside what it has. Nil
  /// for anything that isn't the account's own post.
  public static func rowFromPostView(_ view: JSONValue?, _ did: String, timeZone: TimeZone? = nil) -> JSONValue? {
    guard let uri = view?["uri"]?.stringValue, PostingJS.hasPrefix(uri, "at://\(did)/app.bsky.feed.post/") else {
      return nil
    }
    let record = ComposerJS.or(view?["record"], [:])
    guard
      let row = Analytics.compactPostFromRecord(uri, record, timeZone: timeZone ?? AppLocale.activeTimeZone())
    else { return nil }
    var out = row.json
    out["likes"] = ComposerJS.or(view?["likeCount"], 0)
    out["reposts"] = ComposerJS.or(view?["repostCount"], 0)
    out["replies"] = ComposerJS.or(view?["replyCount"], 0)
    out["quotes"] = ComposerJS.or(view?["quoteCount"], 0)
    return out
  }

  /// The archive's rows with the author feed's newer ones laid over them,
  /// newest first. A post the feed has and the archive doesn't is marked
  /// `fresh` (not synced yet); one both have keeps the archive's row but
  /// takes the feed's counts, which are newer. `removed` URIs (deleted here
  /// since) are left out.
  public static func mergePostRows(
    _ archiveRows: [JSONValue]?, _ feedRows: [JSONValue]?, removed: [JSONValue] = [], timeZone: TimeZone? = nil
  ) -> [JSONValue] {
    func gone(_ uri: JSONValue?) -> Bool { removed.contains { ComposerJS.sameValueZero($0, uri) } }
    // A Map by URI: insertion order, a later set replaces in place.
    var order: [JSONValue] = []
    var byUri: [JSONValue] = []
    func index(_ uri: JSONValue?) -> Int? { order.firstIndex { ComposerJS.sameValueZero($0, uri) } }
    func set(_ uri: JSONValue, _ row: JSONValue) {
      if let i = index(uri) { byUri[i] = row } else {
        order.append(uri)
        byUri.append(row)
      }
    }
    for row in archiveRows ?? [] {
      guard let uri = row["uri"], uri.isTruthy, !gone(uri) else { continue }
      set(uri, row)
    }
    for row in feedRows ?? [] {
      guard let uri = row["uri"], uri.isTruthy, !gone(uri) else { continue }
      if let i = index(uri) {
        var held = byUri[i]
        for key in ["likes", "reposts", "replies", "quotes"] { held[key] = row[key] }
        byUri[i] = held
      } else {
        var fresh = row
        fresh["fresh"] = true
        set(uri, fresh)
      }
    }
    return TimerJS.v8Sorted(byUri) { (time($1["at"], timeZone) ?? -.infinity) - (time($0["at"], timeZone) ?? -.infinity) }
  }

  /// Timers still counting down, and the soonest `checkAt` among them.
  public static func timersOverview(_ rows: JSONValue?, timeZone: TimeZone? = nil) -> TimersOverview {
    let live = (rows?.arrayValue ?? []).filter { TimerService.isLiveTimer($0) }
    let checks = live.compactMap { $0["checkAt"] }.filter { time($0, timeZone) != nil }
    let next = TimerJS.v8Sorted(checks) { time($0, timeZone)! - time($1, timeZone)! }.first
    return TimersOverview(live: live.count, nextCheck: next.flatMap { $0.isTruthy ? $0 : nil })
  }

  /// "Today, 9:00 AM", "Tomorrow, 9:00 AM", "Fri, Nov 14, 9:00 AM", on this
  /// device's clock (`timeZone`). Without the weekday ("Nov 14, 9:00 AM")
  /// for a past time in a narrow column, where it fits on one line.
  public static func whenLabel(
    _ iso: JSONValue?, now: Double, weekday: Bool = true, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    guard let t = time(iso, zone) else { return "" }
    let clock = AppLocale.toLocaleTimeString(
      t, DateFormatOptions(hour: "numeric", minute: "2-digit"), locale: locale, timeZone: zone)
    func startOf(_ ms: Double) -> Double {
      guard let f = JSDate.fields(ms, timeZone: zone) else { return .nan }
      return JSDate.local(Double(f.year), Double(f.month), Double(f.date), timeZone: zone)
    }
    let days = ((startOf(t) - startOf(now)) / 86_400_000).jsRounded
    if days == 0 { return "Today, \(clock)" }
    if days == 1 { return "Tomorrow, \(clock)" }
    if days == -1 { return "Yesterday, \(clock)" }
    let sameYear = JSDate.fields(t, timeZone: zone)?.year == JSDate.fields(now, timeZone: zone)?.year
    let options = DateFormatOptions(
      weekday: weekday ? "short" : nil, year: sameYear ? nil : "numeric", month: "short", day: "numeric")
    return "\(AppLocale.toLocaleDateString(t, options, locale: locale, timeZone: zone)), \(clock)"
  }
}
