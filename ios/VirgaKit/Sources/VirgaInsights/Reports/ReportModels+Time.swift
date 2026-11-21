// Ports src/reports/models.js
//
// When posts land: engagement by the weekday and hour each post was made,
// and the words for the hours.

import Foundation
import VirgaArchive
import VirgaCore
import VirgaNetwork

extension ReportModels {
  // Indexed from Monday everywhere in the model (`day` 0 is Monday), whatever
  // day the reader's week starts on; weekdayOrder() below is the order to
  // draw them in.
  public static let weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  public static let weekdaysLong = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

  /// The model's weekday indexes in the order the reader's week runs:
  /// [0...6] for a Monday start, [6, 0, 1, 2, 3, 4, 5] for a Sunday one.
  public static func weekdayOrder(_ weekStart: Int? = nil) -> [Int] {
    AppLocale.weekOrder(weekStart).map { ($0 + 6) % 7 }
  }

  /// The fewest posts a slot needs before its average is shown at all.
  public static let bestTimeMinPosts = 3

  /// The middle value of a list of numbers (the mean of the middle two).
  public static func median(_ values: [Double]) -> Double? {
    if values.isEmpty { return nil }
    let sorted = JSSort.sort(values) { $0 - $1 }
    let mid = sorted.count >> 1
    return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  /// Engagement per post by the weekday and hour each post was made, in
  /// local time, over the owner's own voice (top-level posts and threads;
  /// replies to other people earn differently and would drown it). `block`
  /// is the hours per column (2 gives a 7×12 grid); at least 1.
  ///
  /// Each slot reads its typical post, the median, not the mean: one post
  /// that went round would otherwise make its hour look like the best time
  /// forever. A slot with fewer than `bestTimeMinPosts` posts has no value.
  ///
  /// Counts are as of the last sync, so the newest posts are still
  /// collecting; posts younger than two days are left out for that reason.
  public static func bestTimeModel(
    _ archive: ReportArchive, _ period: AnalyticsPeriod, _ nowMs: Double, block: Int = 2,
    formats: ReportFormats = .active
  ) -> BestTimeReport {
    let nowMs = Periods.periodEnd(period, nowMs)
    let block = Swift.max(1, block)
    return cached(archive, "bestTime", period, [("block", .number(Double(block)))], formats: formats) {
      let cols = (24 + block - 1) / block
      let t0 = Periods.periodStart(period, nowMs) ?? -.infinity
      let settled = nowMs - 2 * dayMs
      var grid = Array(repeating: Array(repeating: [Double](), count: cols), count: 7)
      var all: [Double] = []
      for p in datedPosts(archive, formats: formats) {
        let atMs = at(p)
        if atMs < t0 || atMs > settled || !Analytics.isOwnVoicePost(p, archive.did) { continue }
        guard let d = JSDate.fields(atMs, timeZone: formats.timeZone) else { continue }
        let e = Double(Analytics.engagementOf(p, "all"))
        grid[(d.day + 6) % 7][d.hours / block].append(e)
        all.append(e)
      }
      let typical = { (list: [Double]) in list.count >= bestTimeMinPosts ? median(list) : nil }
      var slots: [BestTimeSlot] = []
      let rows = grid.enumerated().map { day, cells in
        BestTimeRow(
          label: weekdays[day],
          cells: cells.enumerated().map { col, list in
            let avg = typical(list)
            if let avg { slots.append(BestTimeSlot(day: day, col: col, avg: avg, posts: list.count)) }
            return BestTimeCell(posts: list.count, avg: avg)
          })
      }
      let best = JSSort.sort(slots) { a, b in JSMath.or(b.avg - a.avg, Double(b.posts - a.posts)) }
      let byDay = grid.enumerated().map { day, cells in
        let list = cells.flatMap { $0 }
        return BestTimeDay(day: day, posts: list.count, avg: typical(list))
      }
      let byHour = (0..<cols).map { col in
        let list = grid.flatMap { $0[col] }
        return BestTimeHour(col: col, posts: list.count, avg: typical(list))
      }
      return BestTimeReport(
        block: block, cols: cols, rows: rows, best: Array(best.prefix(3)), byDay: byDay, byHour: byHour,
        posts: all.count, overall: median(all))
    }
  }

  /// `String(n).padStart(2, '0')`.
  static func pad2(_ n: Int) -> String {
    let s = String(n)
    return s.utf16.count >= 2 ? s : String(repeating: "0", count: 2 - s.utf16.count) + s
  }

  /// "6–8 pm" for a column of `block` hours starting at `col * block`, or
  /// "18–20" where the reader's clock runs to 24.
  public static func hourRange(_ col: Int, _ block: Int = 2, twelveHour: Bool = AppLocale.uses12Hour()) -> String {
    let from = col * block
    if !twelveHour {
      return "\(pad2(from % 24))–\(pad2((from + block) % 24))"
    }
    func h(_ x: Int) -> (n: Int, ap: String) {
      let v = x % 24
      return (v % 12 == 0 ? 12 : v % 12, v < 12 ? "am" : "pm")
    }
    let a = h(from)
    let b = h(from + block)
    return a.ap == b.ap ? "\(a.n)–\(b.n) \(b.ap)" : "\(a.n) \(a.ap)–\(b.n) \(b.ap)"
  }

  /// Hour-of-day labels for a heatmap's columns: every third column labelled.
  public static func hourColumns(_ block: Int = 2, twelveHour: Bool = AppLocale.uses12Hour()) -> [HourColumn] {
    let block = Swift.max(1, block)
    let cols = (24 + block - 1) / block
    let every = Swift.max(1, Int((6 / Double(block)).jsRounded))
    var out: [HourColumn] = []
    var c = 0
    while c < cols {
      let h = c * block
      let label: String
      if !twelveHour {
        label = pad2(h)
      } else if h == 0 {
        label = "12a"
      } else if h == 12 {
        label = "12p"
      } else {
        label = h < 12 ? "\(h)a" : "\(h - 12)p"
      }
      out.append(HourColumn(label: label, span: Swift.min(every, cols - c)))
      c += every
    }
    return out
  }
}
