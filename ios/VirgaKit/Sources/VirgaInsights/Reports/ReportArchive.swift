// Ports src/reports/models.js
//
// What the report models read (`useArchive()` on the web): the account, the
// archive's rows and marks, and the one "now" every chart on a screen
// shares, along with the formats the numbers are bucketed and written in.

import Foundation
import VirgaArchive
import VirgaCore

/// The archive as a report reads it: whose it is, the rows and meta the
/// archive holds (`ArchiveData`), and `nowMs`, where every window ends (the
/// archive context's one "now" per change of data).
public struct ReportArchive: Sendable {
  public var did: String
  public var handle: String?
  /// The context's "now" (ms). The models take their own `nowMs` too, as the
  /// web's do; the cache and the Interaction lookup read this one.
  public var nowMs: Double?
  public var data: ArchiveData

  public init(did: String, handle: String? = nil, nowMs: Double? = nil, data: ArchiveData = .empty) {
    self.did = did
    self.handle = handle
    self.nowMs = nowMs
    self.data = data
  }

  /// The archive an ArchiveModel holds right now.
  @MainActor public init(_ model: ArchiveModel) {
    self.init(did: model.did, handle: model.handle, nowMs: model.nowMs, data: model.data)
  }

  public var posts: [PostRow] { data.posts }
  public var followers: [FollowerRow] { data.followers }
  public var following: [FollowingRow] { data.following }
  public var blocks: [BlockRow] { data.blocks }
  public var inbound: [EngagementEvent] { data.inbound }
  public var outbound: [EngagementEvent] { data.outbound }
  // The repo's records (`atmosphere`) are `data.atmosphere`: their type is
  // VirgaRepo's, which this target doesn't import by name.
  public var meta: ArchiveMeta { data.meta }
  public var rev: Int { data.rev }
  public var followRev: Int { data.followRev }
}

/// The formats a report is computed in: the web reads them from the
/// browser (its zone) and lib/locale.js (the locale, the first day of the
/// week, the clock); here they are passed in, the active ones by default.
public struct ReportFormats: Hashable, Sendable {
  /// The locale numbers and dates are written in.
  public var locale: String
  /// The first day of a week bucket (a getDay index).
  public var weekStart: Int
  /// Where "local time" is.
  public var timeZone: TimeZone
  /// Whether the clock reads "6 pm" (true) or "18" (false).
  public var twelveHour: Bool

  public init(locale: String? = nil, weekStart: Int? = nil, timeZone: TimeZone? = nil, twelveHour: Bool? = nil) {
    let locale = locale ?? AppLocale.activeLocale()
    self.locale = locale
    self.weekStart = weekStart ?? AppLocale.activeWeekStart()
    self.timeZone = timeZone ?? AppLocale.activeTimeZone()
    self.twelveHour = twelveHour ?? ReportFormats.twelveHour(locale)
  }

  /// The active formats (AppLocale's locale, week start, zone and clock).
  public static var active: ReportFormats {
    ReportFormats(
      locale: AppLocale.activeLocale(), weekStart: AppLocale.activeWeekStart(), timeZone: AppLocale.activeTimeZone(),
      twelveHour: AppLocale.uses12Hour())
  }

  /// Whether `locale` reads the clock in 12 hours (h11 or h12), as
  /// lib/locale.js's hourCycleOf.
  public static func twelveHour(_ locale: String) -> Bool {
    let cycle = LocaleData.profile(for: locale).hourCycle
    return cycle == "h11" || cycle == "h12"
  }

  /// `localeStamp()`, and the zone: what a cached value was computed in.
  var stamp: String { "\(locale)/\(weekStart)/\(timeZone.identifier)/\(twelveHour)" }
}
