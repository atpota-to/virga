// Ports src/reports/annotations.js
//
// Notes on the charts: a day and a few words ("Changed my handle", "The
// zine went out"), kept per account on this device and drawn on every
// time-series chart at the bucket holding that day. And the milestones the
// follower curve passes on its own (1,000, 5,000, …), which nobody has to
// write down.
//
// Pure, apart from the two functions that read and write the key-value
// store (the web's localStorage), with the web's key and JSON.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

/// One note: `{ id, day, label }`, `day` a local 'YYYY-MM-DD'.
public struct Annotation: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var day: String
  public var label: String

  public init(id: String, day: String, label: String) {
    self.id = id
    self.day = day
    self.label = label
  }

  public var json: JSONValue { ["id": .string(id), "day": .string(day), "label": .string(label)] }
}

/// Something drawn on a chart at a moment: a note or a milestone.
public struct ChartMark: Hashable, Sendable {
  public enum Kind: String, Codable, Hashable, Sendable {
    case note, milestone
  }

  public var t: Double
  public var label: String
  public var kind: Kind
  /// A note's id.
  public var id: String?
  /// A milestone's follower count.
  public var count: Int?

  public init(t: Double, label: String, kind: Kind, id: String? = nil, count: Int? = nil) {
    self.t = t
    self.label = label
    self.kind = kind
    self.id = id
    self.count = count
  }

  public var json: JSONValue {
    var members: [String: JSONValue] = ["t": .number(t), "label": .string(label), "kind": .string(kind.rawValue)]
    if let id { members["id"] = .string(id) }
    if let count { members["count"] = .number(Double(count)) }
    return .object(members)
  }
}

/// The marks one bucket of a series holds: its index and start, what it
/// reads as (a note when any of them is one) and each mark's words.
public struct SeriesMark: Hashable, Sendable {
  public struct Item: Hashable, Sendable {
    public var label: String
    public var kind: ChartMark.Kind
  }

  public var i: Int
  public var t: Double
  public var kind: ChartMark.Kind
  public var items: [Item]

  public var json: JSONValue {
    [
      "i": .number(Double(i)), "t": .number(t), "kind": .string(kind.rawValue),
      "items": .array(items.map { ["label": .string($0.label), "kind": .string($0.kind.rawValue)] }),
    ]
  }
}

public enum Annotations {
  public static let annotationLabelMax = 80
  public static let annotationsMax = 200

  public static func annotationsKey(_ did: String) -> String {
    "virga:annotations:\(did)"
  }

  /// Stored notes, checked: `[{ id, day, label }]`, oldest day first. A note
  /// needs words (trimmed, at most 80 UTF-16 units), a string id not seen
  /// before and a day that is one; the newest 200 are kept.
  public static func cleanAnnotations(_ raw: JSONValue?, timeZone: TimeZone = AppLocale.activeTimeZone()) -> [Annotation] {
    var seen = Set<JSKey>()
    var out: [Annotation] = []
    for a in raw?.arrayValue ?? [] {
      let label = a["label"]?.stringValue.map { $0.jsTrimmed().jsSlice(0, annotationLabelMax) } ?? ""
      guard !label.isEmpty, let id = a["id"]?.stringValue, !seen.contains(JSKey(id)) else { continue }
      // A day must be a string here (the web would also take ['2026-10-03'],
      // which reads as one; nothing writes that).
      guard let day = a["day"]?.stringValue, Periods.dayStartMs(day, timeZone: timeZone).isFinite else { continue }
      seen.insert(JSKey(id))
      out.append(Annotation(id: id, day: day, label: label))
    }
    let sorted = JSSort.sort(out) { a, b in
      JSMath.less(a.day, b.day) ? -1 : JSMath.less(b.day, a.day) ? 1 : 0
    }
    return Array(sorted.suffix(annotationsMax))
  }

  /// `cleanAnnotations` of notes already typed.
  public static func cleanAnnotations(_ list: [Annotation], timeZone: TimeZone = AppLocale.activeTimeZone()) -> [Annotation] {
    cleanAnnotations(.array(list.map(\.json)), timeZone: timeZone)
  }

  /// The account's notes, or none when nothing (or nothing readable) is stored.
  public static func readAnnotations(
    _ did: String, store: (any KeyValueStore)?, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [Annotation] {
    let text = store?.getItem(annotationsKey(did)).flatMap { $0.isEmpty ? nil : $0 } ?? "[]"
    guard let raw = try? JSONValue.parse(text) else { return [] }
    return cleanAnnotations(raw, timeZone: timeZone)
  }

  /// Keeps the account's notes, checked, as the web writes them
  /// (`JSON.stringify`). A full or refused store costs the note on reload,
  /// nothing else.
  public static func writeAnnotations(
    _ did: String, _ list: [Annotation], store: (any KeyValueStore)?, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) {
    try? store?.setItem(annotationsKey(did), serialize(cleanAnnotations(list, timeZone: timeZone)))
  }

  /// `JSON.stringify(list)`, byte for byte.
  public static func serialize(_ list: [Annotation]) -> String {
    "[" + list.map { "{\"id\":\($0.id.jsJSONQuoted),\"day\":\($0.day.jsJSONQuoted),\"label\":\($0.label.jsJSONQuoted)}" }
      .joined(separator: ",") + "]"
  }

  /// A new note's id: `n`, the time in base 36 and four random base-36
  /// digits (the web's `n${Date.now().toString(36)}${…random}`).
  public static func newId(now: Double = Date().timeIntervalSince1970 * 1000) -> String {
    let digits = Array("0123456789abcdefghijklmnopqrstuvwxyz")
    let time = String(UInt64(Swift.max(0, now)), radix: 36)
    let random = String((0..<4).map { _ in digits[Int.random(in: 0..<36)] })
    return "n\(time)\(random)"
  }

  /// The list with a note added. An empty label or a day that isn't one
  /// changes nothing: the list itself comes back.
  public static func addAnnotation(
    _ list: [Annotation]?, day: String, label: String, id: String = newId(),
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [Annotation] {
    let next = cleanAnnotations(.array((list ?? []).map(\.json) + [["id": .string(id), "day": .string(day), "label": .string(label)]]), timeZone: timeZone)
    return next.contains { $0.id.jsEquals(id) } ? next : list ?? []
  }

  public static func removeAnnotation(_ list: [Annotation]?, _ id: String) -> [Annotation] {
    (list ?? []).filter { !$0.id.jsEquals(id) }
  }

  // MARK: - Milestones

  /// 100, 250, 500, 1,000, 2,500, 5,000, … up to `max`.
  public static func milestoneSteps(_ max: Double) -> [Double] {
    var out: [Double] = []
    var base: Double = 100
    while base <= max {
      for k in [1, 2.5, 5] where base * k <= max { out.append(base * k) }
      base *= 10
    }
    return out
  }

  /// The day the follower count reached each round number, from the
  /// followers the account has today, each dated by their follow record:
  /// the Nth of them to arrive marks N. People who followed and have since
  /// left aren't in the list, so the real count got there on that day or
  /// before it; the reports say so. Followers with no readable date are
  /// counted from the start.
  public static func followerMilestones(
    _ followers: [FollowerRow]?, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [ChartMark] {
    var times: [Double] = []
    var undated = 0
    for f in followers ?? [] {
      let t = JSDate.parse(f.followedAt ?? "", timeZone: timeZone)
      if t.isFinite { times.append(t) } else { undated += 1 }
    }
    times = JSSort.sort(times) { $0 - $1 }
    var out: [ChartMark] = []
    for count in milestoneSteps(Double(times.count + undated)) {
      let index = Int(count) - undated - 1
      if index < 0 { continue }  // reached before anything that can be dated
      let label = "\(AppLocale.formatNumber(count.jsRounded, locale: locale)) followers"
      out.append(ChartMark(t: times[index], label: label, kind: .milestone, count: Int(count)))
    }
    return out
  }

  // MARK: - Onto a chart

  /// A note as a mark: the middle of its day, so no time zone edge moves it.
  public static func noteMark(_ annotation: Annotation, timeZone: TimeZone = AppLocale.activeTimeZone()) -> ChartMark {
    ChartMark(
      t: Periods.dayStartMs(annotation.day, timeZone: timeZone) + 43_200_000, label: annotation.label, kind: .note,
      id: annotation.id)
  }

  /// Where marks land on a series: for each bucket that holds any, its index
  /// and what to say there. `series` is the buckets' starts, `unit` their
  /// size. Marks outside the series are left out.
  public static func marksOnSeries(
    _ series: [Double]?, _ unit: AnalyticsUnit, _ marks: [ChartMark]?, timeZone: TimeZone = AppLocale.activeTimeZone(),
    weekStart: Int? = nil
  ) -> [SeriesMark] {
    guard let series, !series.isEmpty, let marks, !marks.isEmpty else { return [] }
    var index: [Double: Int] = [:]
    for (i, t) in series.enumerated() { index[t] = i }
    var order: [Int] = []
    var byBucket: [Int: SeriesMark] = [:]
    for mark in marks {
      guard mark.t.isFinite else { continue }
      guard let i = index[Analytics.bucketStartMs(mark.t, unit, timeZone: timeZone, weekStart: weekStart)] else { continue }
      if byBucket[i] == nil {
        byBucket[i] = SeriesMark(i: i, t: series[i], kind: mark.kind, items: [])
        order.append(i)
      }
      byBucket[i]!.items.append(SeriesMark.Item(label: mark.label, kind: mark.kind))
      // A bucket holding a note reads as a note: that one was put there by hand.
      if mark.kind == .note { byBucket[i]!.kind = .note }
    }
    return JSSort.sort(order.map { byBucket[$0]! }) { Double($0.i - $1.i) }
  }

  /// `marksOnSeries` over a series' points.
  public static func marksOnSeries(
    _ series: [SeriesPoint]?, _ unit: AnalyticsUnit, _ marks: [ChartMark]?,
    timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> [SeriesMark] {
    marksOnSeries(series?.map(\.t), unit, marks, timeZone: timeZone, weekStart: weekStart)
  }

  /// `marksOnSeries` over a rate's points.
  public static func marksOnSeries(
    _ series: [RatePoint]?, _ unit: AnalyticsUnit, _ marks: [ChartMark]?,
    timeZone: TimeZone = AppLocale.activeTimeZone(), weekStart: Int? = nil
  ) -> [SeriesMark] {
    marksOnSeries(series?.map(\.t), unit, marks, timeZone: timeZone, weekStart: weekStart)
  }

  /// "Oct 3: 5,000 followers; Changed my handle": a bucket's marks in words.
  public static func markText(
    _ mark: SeriesMark, _ unit: AnalyticsUnit, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> String {
    "\(Analytics.bucketLabel(mark.t, unit, locale: locale, timeZone: timeZone)): \(mark.items.map(\.label).joined(separator: "; "))"
  }

  /// Today as a 'YYYY-MM-DD' day, for a date field's default and its max.
  public static func todayKey(_ now: Double, timeZone: TimeZone = AppLocale.activeTimeZone()) -> String {
    Periods.dayKey(now, timeZone: timeZone)
  }

  // MARK: - useChartMarks

  /// The marks for one chart: the account's notes, and with `milestones`
  /// the round numbers its follower count has passed (cached per archive
  /// revision, as the web caches them), each placed on the bucket of
  /// `series` (in `unit`) that holds its day.
  public static func chartMarks(
    notes: [Annotation], archive: ReportArchive, series: [Double], unit: AnalyticsUnit, milestones: Bool = false,
    formats: ReportFormats = .active
  ) -> [SeriesMark] {
    var marks = notes.map { noteMark($0, timeZone: formats.timeZone) }
    if milestones {
      marks += ReportModels.cached(archive, "milestones", nil, [], formats: formats) {
        followerMilestones(archive.followers, locale: formats.locale, timeZone: formats.timeZone)
      }
    }
    return marksOnSeries(series, unit, marks, timeZone: formats.timeZone, weekStart: formats.weekStart)
  }
}
