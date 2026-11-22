// Ports src/posting/schedule/queueCalendar.js
//
// The days ahead as a calendar: one column per day, one cell per weekly
// slot, with queued rows matched onto the minute they go out. Slots come
// from the slot walk the queue packs with (enumerateSlots). Pure; the page
// draws it.
//
// The web's days are this device's (`new Date()`'s local calendar): the
// port takes that zone as `timeZone` (nil for the active one), the zone a
// schedule without one is set in too. Instants are epoch milliseconds.

import Foundation
import VirgaCore

/// One cell of a calendar day: a slot (`row` the queued row on its minute,
/// or nil), or a row whose time matches no slot (`offSchedule`).
public struct CalendarSlot: Hashable, Sendable {
  /// The instant, epoch ms.
  public var at: Double
  /// `Math.floor(at / 60000)`: the minute rows are matched on.
  public var minute: Double
  public var row: JSONValue?
  public var offSchedule: Bool

  public var json: JSONValue {
    var out: JSONValue = ["at": ScheduleJS.isoJSON(at), "minute": .number(minute), "row": row ?? .null]
    if offSchedule { out["offSchedule"] = true }
    return out
  }
}

/// One day of the calendar: its local midnight, its key, its cells.
public struct CalendarDay: Hashable, Sendable {
  /// The day's start on this device's clock, epoch ms.
  public var date: Double
  /// `${year}-${month0}-${date}`.
  public var key: String
  public var slots: [CalendarSlot]

  public var json: JSONValue {
    ["date": ScheduleJS.isoJSON(date), "key": .string(key), "slots": .array(slots.map(\.json))]
  }
}

/// buildCalendarDays' answer.
public struct CalendarDays: Hashable, Sendable {
  public var days: [CalendarDay]
  /// Rows beyond the window (or in the past, or unreadable).
  public var laterCount: Int
  /// How many distinct row ids the calendar placed.
  public var claimedCount: Int

  public var json: JSONValue {
    [
      "days": .array(days.map(\.json)), "laterCount": .number(Double(laterCount)),
      "claimedCount": .number(Double(claimedCount)),
    ]
  }
}

/// The zones a calendar footer names.
public struct CalendarZones: Codable, Hashable, Sendable {
  /// Where the cells are drawn (this device).
  public var device: String
  /// Where the week was set.
  public var set: String
  public var differs: Bool
}

/// What the web throws reading a row that isn't one.
public struct QueueCalendarError: Error, LocalizedError, Hashable, Sendable {
  public var message: String
  public var errorDescription: String? { message }
}

public enum QueueCalendar {
  /// '9a' / '5:30p': short enough to sit inside a slot cell on a phone, on
  /// this device's clock (`timeZone`). 'NaNp' for an invalid date, as the
  /// web writes it.
  public static func compactTime(_ ms: Double, timeZone: TimeZone? = nil) -> String {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    guard let f = JSDate.fields(ms, timeZone: zone) else { return "NaN:NaNp" }
    let h = f.hours
    let m = f.minutes
    let h12 = ((h + 11) % 12) + 1
    let suffix = h < 12 ? "a" : "p"
    return m == 0 ? "\(h12)\(suffix)" : "\(h12):\(m < 10 ? "0" : "")\(m)\(suffix)"
  }

  /// compactTime for a loose value, read as `new Date(value)`.
  public static func compactTime(_ value: JSONValue?, timeZone: TimeZone? = nil) -> String {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    return compactTime(TimerJS.dateMs(value, timeZone: zone), timeZone: zone)
  }

  /// `dayCount` days from today (this device's days) × the slots on each,
  /// with queued rows matched onto their minute. A row whose time matches no
  /// slot (the schedule changed under it) gets its own `offSchedule` cell on
  /// its day; rows beyond the window are counted in `laterCount`. A
  /// schedule the slot walk can't read throws its error.
  public static func buildCalendarDays(
    _ schedule: JSONValue?, _ rows: [JSONValue]? = [], _ dayCount: Double = 7, now: Double,
    timeZone: TimeZone? = nil
  ) throws -> CalendarDays {
    let zone = timeZone ?? AppLocale.activeTimeZone()
    let first = ScheduleJS.startOfDay(now, zone)
    let firstDate = ScheduleJS.localDate(first, zone)
    var days: [CalendarDay] = []
    var i = 0.0
    while i < dayCount {
      let date = ScheduleJS.setDate(first, firstDate + i, zone)
      days.append(CalendarDay(date: date, key: ScheduleJS.dayKey(date, zone), slots: []))
      i += 1
    }
    // `new Map(days.map((d) => [d.key, d]))`: the last day with a key wins.
    var byKey: [String: Int] = [:]
    for (index, day) in days.enumerated() { byKey[day.key] = index }
    let windowEnd = ScheduleJS.setDate(first, firstDate + dayCount, zone)

    if !PostingQueue.isScheduleEmpty(schedule) {
      // The walk yields ascending instants, so the first past the window
      // ends it.
      var walk = PostingQueue.slotWalk(schedule, now, nil, localZone: zone)
      while let t = try walk.next() {
        if t >= windowEnd { break }
        if t <= now { continue }
        if let d = byKey[ScheduleJS.dayKey(t, zone)] {
          days[d].slots.append(
            CalendarSlot(at: t, minute: PostingQueue.minuteKey(ms: t), row: nil, offSchedule: false))
        }
      }
    }

    var claimed: [JSONValue?] = []
    func claim(_ id: JSONValue?) {
      if !claimed.contains(where: { ComposerJS.sameValueZero($0, id) }) {
        claimed.append(id)
      }
    }
    // The first slot of each minute, by day and cell.
    var slotsByMinute: [Double: (day: Int, slot: Int)] = [:]
    for (d, day) in days.enumerated() {
      for (s, slot) in day.slots.enumerated() where slotsByMinute[slot.minute] == nil {
        slotsByMinute[slot.minute] = (d, s)
      }
    }
    var laterCount = 0
    for row in rows ?? [] {
      if row.isNull { throw QueueCalendarError(message: "Cannot read properties of null (reading 'scheduledFor')") }
      let when = TimerJS.dateMs(row["scheduledFor"], timeZone: zone)
      let minute = PostingQueue.minuteKey(ms: when)
      if !minute.isNaN, let at = slotsByMinute[minute], days[at.day].slots[at.slot].row == nil {
        days[at.day].slots[at.slot].row = row
        claim(row["id"])
        continue
      }
      if let d = byKey[ScheduleJS.dayKey(when, zone)], when > now {
        days[d].slots.append(CalendarSlot(at: when, minute: minute, row: row, offSchedule: true))
        claim(row["id"])
      } else {
        laterCount += 1
      }
    }
    for d in days.indices {
      days[d].slots = TimerJS.v8Sorted(days[d].slots) { $0.at - $1.at }
    }
    return CalendarDays(days: days, laterCount: laterCount, claimedCount: claimed.count)
  }

  /// The zones a calendar footer names: where the cells are drawn (this
  /// device, `localZone`), and where the week was set when that differs.
  public static func calendarZones(_ schedule: JSONValue?, localZone: TimeZone? = nil) -> CalendarZones {
    let device = PostingQueue.resolveTimezone(nil, localZone: localZone)
    let set = PostingQueue.resolveTimezone(schedule, localZone: localZone)
    return CalendarZones(device: device, set: set, differs: !device.jsEquals(set))
  }
}
