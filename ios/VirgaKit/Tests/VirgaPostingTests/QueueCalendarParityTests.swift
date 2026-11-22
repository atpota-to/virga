// schedule/queueCalendar.js held to scheduling.queueCalendar: the calendar
// of the days ahead on this device's clock, a slot's short time and the
// footer's zones, in several zones across their clock changes.

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaPosting

@Suite struct QueueCalendarParity {
  static let f = "scheduling.queueCalendar"

  @Test func buildCalendarDays() throws {
    for c in try cases(Self.f, "buildCalendarDays") {
      let zone = ComposerFixtures.zone(c)
      let now = TimerJS.dateMs(c.input["now"], timeZone: zone)
      let result = outcome {
        try QueueCalendar.buildCalendarDays(
          c.input["schedule"], c.input["rows"]?.arrayValue ?? [], c.input["dayCount"]?.doubleValue ?? 7, now: now,
          timeZone: zone
        ).json
      }
      check(result, c, strictNulls: true)
    }
  }

  @Test func compactTime() throws {
    for c in try cases(Self.f, "compactTime") {
      check(.string(QueueCalendar.compactTime(c.input["d"], timeZone: ComposerFixtures.zone(c))), c)
    }
  }

  @Test func calendarZones() throws {
    for c in try cases(Self.f, "calendarZones") {
      check(json(QueueCalendar.calendarZones(c.input["schedule"], localZone: ComposerFixtures.zone(c))), c)
    }
  }
}
