// Ports src/posting/timers/selfDestruct.js
//
// The timer in words: every sentence and phrase selfDestruct.js builds,
// word for word (curly quotes included). Numbers and times are written in
// the active locale and zone (AppLocale) unless `locale` and `timeZone` are
// passed, as the web writes them with `activeLocale()` and the browser's
// local time. A function given a `timeZone` also reads every date-time
// without an offset in it (a rule's pin included), as the web reads both in
// its one local zone.

import Foundation
import VirgaCore

extension SelfDestruct {
  /// "from people you don't follow", or nothing for a clause about everyone.
  public static func describeFrom(_ clause: TimerClause?, locale: String? = nil) -> String {
    describeFrom(clause?.json, locale: locale)
  }

  /// describeFrom for a loose clause (`clause.from` read as the web reads it).
  public static func describeFrom(_ clause: JSONValue?, locale: String? = nil) -> String {
    guard let f = clause?["from"], f.isTruthy else { return "" }
    var parts: [String] = []
    if f["notFollowed"]?.isTruthy == true { parts.append("you don't follow") }
    if let over = f["followersOver"], over.isTruthy {
      parts.append("with over \(TimerJS.toLocaleString(over, locale: locale)) followers")
    }
    if parts.isEmpty { return "" }
    let joiner = f["match"] == .string("all") ? " and " : " or "
    return " from people \(parts.joined(separator: joiner))"
  }

  /// '1 like', '2 likes', '1 reply', '3 replies of your own'.
  public static func plural(_ n: Double, _ noun: String) -> String {
    let count = JSNumber.format(n)
    if noun == "reply" { return n == 1 ? "1 reply" : "\(count) replies" }
    // The self-replies noun is a phrase, so the plural is not on the last word.
    if noun == "reply of your own" { return n == 1 ? "1 reply of your own" : "\(count) replies of your own" }
    return n == 1 ? "1 \(noun)" : "\(count) \(noun)s"
  }

  public static func plural(_ n: Int, _ noun: String) -> String {
    plural(Double(n), noun)
  }

  /// What fitting did to the writer's rule on this post, as an editor note;
  /// '' when it applies as written.
  public static func describeFitChange(_ rule: some TimerRuleInput, _ fit: TimerFit = TimerFit()) -> String {
    let r = normalizeTimer(rule)
    if !r.enabled || !fit.available { return "" }
    let isGate = { (e: TimerEffect) in blueskyOnlyEffects.contains(e.action) }
    let isReplyLimit = { (e: TimerEffect) in e.action == .limitReplies }
    let gatesDropped = !fit.gatesSupported && r.effects.contains(where: isGate)
    let replyLimitDropped = fit.gatesSupported && !fit.replyLimitSupported && r.effects.contains(where: isReplyLimit)
    let conditionsDropped = !fit.conditionsSupported && !r.conditions.clauses.isEmpty
    var parts: [String] = []
    if !fitTimerToPost(r, fit).enabled {
      // Why it has no lifespan here at all.
      if gatesDropped && r.effects.allSatisfy(isGate) {
        parts.append(
          "Your rule only changes reply and quote settings, which this post can’t have, so it has no lifespan here.")
      } else if replyLimitDropped && r.effects.allSatisfy(isReplyLimit) {
        parts.append("Your rule only limits replies, which a reply can’t do, so this reply has no lifespan.")
      } else if conditionsDropped && r.conditions.sense == .onlyIf {
        parts.append("Your “only if” rule can’t be checked on this post, so it has no lifespan here.")
      }
    } else {
      if gatesDropped { parts.append("Its reply and quote changes don’t apply to this post.") }
      if replyLimitDropped { parts.append("Limiting replies doesn’t apply to a reply.") }
      if conditionsDropped { parts.append("The conditions you set don’t apply here.") }
    }
    if parts.isEmpty { return "" }
    return "\(parts.joined(separator: " ")) Your rule is kept as you set it, and applies again where it can."
  }

  /// 'your followers' / 'people you follow and people you mentioned' /
  /// 'nobody'.
  public static func describeAllow(_ entries: [AllowEntry]?) -> String {
    describeAllow(entries.map { JSONValue.array($0.map(\.json)) })
  }

  /// describeAllow for a loose list: a known key is its phrase, an object
  /// with a `list` is "people in" its name, anything else is skipped. A
  /// value that isn't a list says 'nobody' (the web iterates a string's
  /// characters, which comes to the same, and throws on an object or a
  /// non-zero number).
  public static func describeAllow(_ entries: JSONValue?) -> String {
    var parts: [String] = []
    for entry in entries?.arrayValue ?? [] {
      if let key = entry.stringValue {
        if let phrase = allowOptions.first(where: { $0.key == key })?.phrase { parts.append(phrase) }
      } else if entry.isTruthy, let list = entry["list"], list.isTruthy {
        if let name = entry["name"], name.isTruthy {
          parts.append("people in \(name.jsString)")
        } else {
          parts.append("people in a list you chose")
        }
      }
    }
    if parts.isEmpty { return "nobody" }
    if parts.count == 1 { return parts[0] }
    return "\(parts.dropLast().joined(separator: ", ")) and \(parts[parts.count - 1])"
  }

  /// e.g. 'Deletes itself', 'Limits replies to your followers', 'Turns off
  /// quotes and deletes itself'.
  public static func describeEffects(_ effects: some TimerEffectsInput) -> String {
    let list = normalizeEffects(effects)
    let parts = list.enumerated().map { i, effect -> String in
      let meta = Self.effects.first { $0.key == effect.action.rawValue }!
      // Only the first verb is capitalized, so the parts read as one sentence.
      let verb = i == 0 ? meta.verb : meta.verb.lowercased()
      if effect.action != .limitReplies { return verb }
      return "\(verb) to \(describeAllow(effect.allow))"
    }
    if parts.count == 1 { return parts[0] }
    return "\(parts.dropLast().joined(separator: ", ")) and \(parts[parts.count - 1])"
  }

  /// Why a post going out now can't keep its pinned time, as a composer
  /// error; '' when it can. Checked before anything is written so a
  /// 'passed' or 'tooLate' pin is refused rather than rewritten into a timer
  /// nobody picked.
  public static func immediateTimerProblem(_ timer: some TimerRuleInput, _ now: Double) -> String {
    let status = pinnedDeadlineStatus(timer, now)
    if status == "passed" {
      return
        "The delete time you picked for this post has already passed. Pick a new time or a length in its lifespan, then post again."
    }
    if status == "tooLate" {
      return
        "The delete time you picked is more than \(formatLifespan(maxLifespanSeconds)) away. Pick an earlier time or a length in its lifespan, then post again."
    }
    return ""
  }

  /// Suffix for the "Posted." toast when settleForPublish moved the timer,
  /// or ''. Keep short.
  public static func timerAdjustmentNote(_ adjusted: String?, _ effects: some TimerEffectsInput) -> String {
    let deletes = effectsDelete(effects)
    if adjusted == "floor" {
      return deletes
        ? "The time you picked had passed, so it comes down in \(formatLifespan(minLifespanSeconds))."
        : "The time you picked had passed, so its timer runs in \(formatLifespan(minLifespanSeconds))."
    }
    return ""
  }

  /// Why a post scheduled for `publishAt` can't keep its pinned instant, as
  /// a sentence for the writer; '' when it can. The schedule is refused
  /// rather than silently swapping the pin for the duration behind it. The
  /// pin is said against `now` (the web says it against the clock).
  public static func scheduledTimerProblem(
    _ timer: some TimerRuleInput, _ publishAt: Double, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    TimerJS.inZone(timeZone) { scheduledTimerProblemHere(timer, publishAt, now: now, locale: locale) }
  }

  static func scheduledTimerProblemHere(
    _ timer: some TimerRuleInput, _ publishAt: Double, now: Double, locale: String?
  ) -> String {
    let t = normalizeTimer(timer)
    let status = pinnedDeadlineStatus(t, publishAt)
    let when = t.deleteAt.map { describeDeleteAt($0, now: now, locale: locale) } ?? ""
    let verb = effectsDelete(t.effects) ? "delete it" : "act on it"
    if status == "tooSoon" || status == "passed" {
      return
        "This post’s lifespan is set to \(verb) \(when), which is less than \(formatLifespan(minLifespanSeconds)) after it would go out. Pick a later delete time in its lifespan, or give it a length instead."
    }
    if status == "tooLate" {
      return
        "This post’s lifespan is set to \(verb) \(when), more than \(formatLifespan(maxLifespanSeconds)) after it would go out. Pick an earlier delete time in its lifespan, or give it a length instead."
    }
    return ""
  }

  /// What the draft-saved confirmation says about the dropped timer, or ''
  /// when the timer matches the default (which comes back on reopen anyway).
  public static func draftTimerNote(_ rule: some TimerRuleInput, _ touched: Bool, _ defaults: some TimerRuleInput)
    -> String
  {
    if !touched || sameTimer(rule, defaults) { return "" }
    return normalizeTimer(defaults).enabled
      ? "Lifespan settings aren’t kept with drafts, so the default applies when you open it."
      : "Its lifespan isn’t kept with drafts."
  }

  /// Said when the server reports timers unavailable while the writer has
  /// one set for the post.
  public static let timersUnavailableNote =
    "Post timers aren’t available right now, so this post will go out without the lifespan you set."

  /// Said when a restored timer's picked time had passed while the composer
  /// was closed.
  public static let expiredDraftTimerNote =
    "The delete time you picked for this post passed while it was closed, so its lifespan is off. Set a new one if you still want it."

  // MARK: - Sentences

  /// A lifespan as a phrase: '30 minutes', '6 hours', '1 week'.
  public static func formatLifespan(_ seconds: JSONValue?) -> String {
    let s = normalizeLifespan(seconds)
    if let preset = lifespanPresets.first(where: { $0.seconds == s }) { return preset.label }
    // Unit by magnitude, not exact division (a pin-derived window is rarely
    // whole); rounding to the nearest unit is fine here.
    let x = Double(s)
    if s < 90 * minute { return plural((x / Double(minute)).jsRounded, "minute") }
    if s < 2 * day { return plural((x / Double(hour)).jsRounded, "hour") }
    return plural((x / Double(day)).jsRounded, "day")
  }

  public static func formatLifespan(_ seconds: Int) -> String {
    formatLifespan(.number(Double(seconds)))
  }

  /// The clauses as a phrase joined by the logic: '5 likes or more than 2
  /// replies'.
  public static func describeClauses(_ conditions: some TimerConditionsInput, locale: String? = nil) -> String {
    let c = normalizeConditions(conditions)
    let parts = c.clauses.map { clause in
      "\(op(clause.op).phrase)\(plural(clause.value, metric(clause.metric).noun))\(describeFrom(clause, locale: locale))"
    }
    if parts.isEmpty { return "" }
    if parts.count == 1 { return parts[0] }
    let joiner = c.logic == .all ? " and " : " or "
    return "\(parts.dropLast().joined(separator: ", "))\(joiner)\(parts[parts.count - 1])"
  }

  /// e.g. 'today at 11:30 PM', 'tomorrow at 9:00 AM', 'Friday at 6:00 PM',
  /// '12 Sept at 6:00 PM'. Days are counted between local midnights in
  /// `timeZone` (the local zone by default).
  public static func describeDeleteAt(
    _ iso: String?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    describeDeleteAt(iso.map(JSONValue.string), now: now, locale: locale, timeZone: timeZone)
  }

  /// describeDeleteAt for a loose value, read as `new Date(value)` reads
  /// it: nil (`undefined`) says nothing, null and 0 are the epoch, a number
  /// a time, an array its text.
  public static func describeDeleteAt(
    _ iso: JSONValue?, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    let zone = TimerJS.zone(timeZone)
    let tag = locale ?? AppLocale.activeLocale()
    let at = TimerJS.dateMs(iso, timeZone: zone)
    guard at.isFinite else { return "" }
    func midnight(_ ms: Double) -> Double {
      guard let f = VirgaCore.JSDate.fields(ms, timeZone: zone) else { return .nan }
      return VirgaCore.JSDate.local(Double(f.year), Double(f.month), Double(f.date), timeZone: zone)
    }
    let days = ((midnight(at) - midnight(VirgaCore.JSDate.timeClip(now))) / 86_400_000).jsRounded
    let time = AppLocale.toLocaleTimeString(
      at, DateFormatOptions(hour: "numeric", minute: "2-digit"), locale: tag, timeZone: zone)
    if days == 0 { return "today at \(time)" }
    if days == 1 { return "tomorrow at \(time)" }
    if days > 1 && days <= 6 {
      return "\(AppLocale.toLocaleDateString(at, DateFormatOptions(weekday: "long"), locale: tag, timeZone: zone)) at \(time)"
    }
    return
      "\(AppLocale.toLocaleDateString(at, DateFormatOptions(month: "short", day: "numeric"), locale: tag, timeZone: zone)) at \(time)"
  }

  /// '1 hour' for a duration, or the pinned instant ('tomorrow at 9:00 AM').
  public static func describeWhen(
    _ timer: some TimerRuleInput, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    TimerJS.inZone(timeZone) {
      let t = normalizeTimer(timer)
      if let deleteAt = t.deleteAt { return describeDeleteAt(deleteAt, now: now, locale: locale) }
      return formatLifespan(t.lifespanSeconds)
    }
  }

  /// How a length is counted, for describeTimer: the post isn't out yet,
  /// or is.
  static let countedFrom: [String: String] = [
    "goesUp": "after it goes up",
    "wentUp": "after it went up",
    "now": "from now",
  ]

  /// The full rule as one sentence for the composer, including what happens
  /// to a spared post. `from` says where a length is counted from: 'goesUp'
  /// (a post not out yet, the default), or for a post already out, 'wentUp'
  /// or 'now'.
  public static func describeTimer(
    _ timer: some TimerRuleInput, now: Double, from: String = "goesUp", locale: String? = nil,
    timeZone: TimeZone? = nil
  ) -> String {
    TimerJS.inZone(timeZone) { describeTimerHere(timer, now: now, from: from, locale: locale) }
  }

  static func describeTimerHere(_ timer: some TimerRuleInput, now: Double, from: String, locale: String?) -> String {
    let t = normalizeTimer(timer)
    let c = t.conditions
    let at =
      t.deleteAt.map { describeDeleteAt($0, now: now, locale: locale) }
      ?? "\(formatLifespan(t.lifespanSeconds)) \(countedFrom[from] ?? countedFrom["goesUp"]!)"
    let does = describeEffects(t.effects)
    if c.clauses.isEmpty { return "\(does) \(at)." }

    let clauses = describeClauses(c, locale: locale)
    // "Stays up for good" only applies when the rule would have deleted.
    let deletes = effectsDelete(t.effects)
    let kept = deletes ? "it stays up for good." : "nothing happens."
    let spared =
      c.onSpare == .extend
      ? "\(deletes ? "it gets another" : "this runs again in") \(formatLifespan(extendWindowSeconds(t, now))), up to \(plural(c.maxExtensions, "time"))."
      : kept

    if c.sense == .onlyIf {
      return "\(does) \(at), but only if it has \(clauses) by then. Otherwise \(spared)"
    }
    return "\(does) \(at), unless it has \(clauses) by then. If it does, \(spared)"
  }

  /// A compact label for the composer indicator: '1 hour', '1 hour · unless
  /// 5 likes'.
  public static func timerChipLabel(
    _ timer: some TimerRuleInput, now: Double, locale: String? = nil, timeZone: TimeZone? = nil
  ) -> String {
    TimerJS.inZone(timeZone) { timerChipLabelHere(timer, now: now, locale: locale) }
  }

  static func timerChipLabelHere(_ timer: some TimerRuleInput, now: Double, locale: String?) -> String {
    let t = normalizeTimer(timer)
    let when = describeWhen(t, now: now, locale: locale)
    // Only name the action when it isn't delete.
    let does =
      effectsDelete(t.effects) ? when : "\(PostingJS.toLowerCase(describeEffects(t.effects))) · \(when)"
    if t.conditions.clauses.isEmpty { return does }
    let lead = t.conditions.sense == .onlyIf ? "only if" : "unless"
    return "\(does) · \(lead) \(describeClauses(t.conditions, locale: locale))"
  }

  // MARK: - Countdown

  /// e.g. 'in 4 minutes', 'in 3 hours'. Past due reads 'any moment now': a
  /// due timer has been claimed by the worker and is about to run.
  public static func timeUntil(_ iso: JSONValue?, now: Double, timeZone: TimeZone? = nil) -> String {
    let at = TimerJS.dateMs(iso, timeZone: timeZone)
    guard at.isFinite else { return "" }
    let ms = at - now
    if ms <= 30 * 1000 { return "any moment now" }
    let minutes = (ms / 60000).jsRounded
    if minutes < 60 { return "in \(plural(minutes, "minute"))" }
    let hours = (minutes / 60).jsRounded
    if hours < 24 { return "in \(plural(hours, "hour"))" }
    return "in \(plural((hours / 24).jsRounded, "day"))"
  }

  public static func timeUntil(_ iso: String?, now: Double, timeZone: TimeZone? = nil) -> String {
    timeUntil(iso.map(JSONValue.string), now: now, timeZone: timeZone)
  }
}
