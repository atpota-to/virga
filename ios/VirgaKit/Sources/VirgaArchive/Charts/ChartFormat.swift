// Ports src/charts/format.js
//
// Number and axis formatting shared by every chart, figure and table: the
// scale and its rules, the dates under an axis, the trend's name, the heat
// map's steps and the ways a number is written. Numbers are written in
// `locale` (VirgaCore's active one by default).

import Foundation
import VirgaCore
import VirgaNetwork

/// `niceScale`'s answer: bounds on a round step.
public struct NiceScale: Codable, Hashable, Sendable {
  public var min: Double
  public var max: Double
  public var step: Double
}

/// `chartScale`'s answer: the y scale, the values ruled, and which of
/// those carry a number.
public struct ChartScale: Codable, Hashable, Sendable {
  public var min: Double
  public var max: Double
  public var ticks: [Double]
  public var labelled: [Double]
}

/// One date under a chart: which bucket, its words, and where they hang.
public struct AxisStop: Codable, Hashable, Sendable {
  public var i: Int
  public var text: String
  /// "start", "middle" or "end".
  public var anchor: String
}

/// `heatSteps`' Map: each value's step on the ramp, in the order the Map
/// holds them (0 first, then the values that aren't zero, smallest first,
/// then any negatives).
public struct HeatSteps: Hashable, Sendable {
  public var entries: [(value: Double, step: Int)]

  /// `steps.get(value)`.
  public subscript(_ value: Double?) -> Int? {
    guard let value else { return nil }
    return entries.first { $0.value == value || ($0.value.isNaN && value.isNaN) }?.step
  }

  public static func == (a: HeatSteps, b: HeatSteps) -> Bool {
    a.entries.count == b.entries.count && zip(a.entries, b.entries).allSatisfy { $0.value == $1.value && $0.step == $1.step }
  }

  public func hash(into hasher: inout Hasher) {
    for entry in entries {
      hasher.combine(entry.value)
      hasher.combine(entry.step)
    }
  }
}

public enum ChartFormat {
  /// A clean axis around [min, max]: a 1/2/2.5/5×10ⁿ step near a quarter
  /// of the span, the bounds floored and ceiled onto it.
  public static func niceScale(_ min: Double, _ max: Double) -> NiceScale {
    var max = max
    if max <= min { max = min + 1 }
    let rawStep = (max - min) / 4
    let mag = pow(10, floor(log10(rawStep)))
    let step = [1, 2, 2.5, 5, 10].map { $0 * mag }.first { $0 >= rawStep } ?? 10 * mag
    return NiceScale(min: floor(min / step) * step, max: ceil(max / step) * step, step: step)
  }

  /// The most rules a chart draws across its plot, the baseline included.
  static let maxTicks = 4

  /// A chart's y scale and the values it rules a line at, shared by the
  /// chart and the picture of it. The scale runs from niceScale's floor
  /// (zero for bars) to 8% over the data; the rules sit on niceScale's
  /// steps, every other one past four, and never on a fraction under 10.
  public static func chartScale(_ dataMin: Double, _ dataMax: Double, zeroBase: Bool = true, bars: Bool = false) -> ChartScale {
    let top = jsMax(dataMax, zeroBase ? 1 : dataMax)
    let nice = niceScale(zeroBase ? 0 : jsMax(0, dataMin), top)
    let min = nice.min
    let step = nice.step
    let max = top + (top - min) * 0.08
    let stepsRaw = floor((max - min) / step + 1e-9)
    var ticks: [Double] = []
    if stepsRaw.isFinite, stepsRaw >= 0 {
      let steps = Int(stepsRaw)
      var every = 1
      while steps / every + 1 > maxTicks { every += 1 }
      var k = 0
      while k <= steps {
        let v = ((min + Double(k) * step) * 1e6).jsRounded / 1e6
        if isInteger(v) || v >= 10 { ticks.append(v) }
        k += every
      }
    }
    let labelled = bars && zeroBase ? ticks.filter { $0 != min } : ticks
    return ChartScale(min: min, max: max, ticks: ticks, labelled: labelled)
  }

  /// `Number.isInteger(v)`.
  static func isInteger(_ v: Double) -> Bool {
    v.isFinite && v.rounded(.towardZero) == v
  }

  /// `Math.max(a, b)`: NaN if either is; +0 over -0.
  static func jsMax(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? b : a }
    return a > b ? a : b
  }

  /// `Math.min(a, b)`: NaN if either is; -0 under +0.
  static func jsMin(_ a: Double, _ b: Double) -> Double {
    if a.isNaN || b.isNaN { return .nan }
    if a == b { return a.sign == .minus ? a : b }
    return a < b ? a : b
  }

  /// Which buckets get a date under the chart: the first, the last, and
  /// the middle once there are five or more. The ends hang inward.
  public static func axisStops(
    _ series: [SeriesPoint], _ unit: AnalyticsUnit, locale: String? = nil,
    timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [AxisStop] {
    let n = series.count
    if n == 0 { return [] }
    func stop(_ i: Int, _ anchor: String) -> AxisStop {
      AxisStop(i: i, text: Analytics.bucketLabel(series[i].t, unit, locale: locale, timeZone: timeZone), anchor: anchor)
    }
    var out = [stop(0, "start")]
    if n >= 5 { out.append(stop((n - 1) / 2, "middle")) }
    if n > 1 { out.append(stop(n - 1, "end")) }
    return out
  }

  /// What a trend line is called: "7-day average" for the centred
  /// seven-bucket moving average, "Moving average" for anything else.
  public static func trendName(_ series: [SeriesPoint], _ trend: [TrendPoint], _ unit: AnalyticsUnit) -> String {
    let seven = Analytics.movingAverage(series, 7)
    let same =
      trend.count == seven.count
      && trend.indices.allSatisfy { i in
        guard let v = trend[i].v else { return false }
        return abs(v - seven[i].v) < 1e-9
      }
    return same ? "7-\(unitNoun(unit)) average" : "Moving average"
  }

  /// `trendName` for a trend with a value at every point.
  public static func trendName(_ series: [SeriesPoint], _ trend: [SeriesPoint], _ unit: AnalyticsUnit) -> String {
    trendName(series, trend.map { TrendPoint(t: $0.t, v: $0.v) }, unit)
  }

  /// Each value's step on the ramp by its rank among the values above zero,
  /// spread from step 1 to step 6; ties share the lower step, zero is step
  /// 0, negatives are 0, and nil has none.
  public static func heatSteps(_ values: [Double?]) -> HeatSteps {
    let positive = values.compactMap { $0 }.filter { $0 > 0 }
    let ranked = JSSort.sort(positive) { $0 - $1 }
    let last = ranked.count - 1
    var entries: [(value: Double, step: Int)] = [(0, 0)]
    func index(_ v: Double) -> Int? { entries.firstIndex { $0.value == v } }
    for (rank, v) in ranked.enumerated() where index(v) == nil {
      let share = last != 0 ? Double(rank) / Double(last) : 1
      entries.append((v, 1 + Int(floor(share * 5.999))))
    }
    for case let v? in values where v < 0 {
      if let i = index(v) { entries[i].step = 0 } else { entries.append((v, 0)) }
    }
    return HeatSteps(entries: entries)
  }

  /// Axis-tick formatting: compact like the figures, but honest about halves.
  public static func fmtTick(_ v: Double, locale: String? = nil) -> String {
    isInteger(v) ? Analytics.fmtCompact(v, locale: locale) : JSNumber.format((v * 10).jsRounded / 10)
  }

  /// `Math.min(hi, Math.max(lo, v))`.
  public static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    jsMin(hi, jsMax(lo, v))
  }

  /// A count as the charts write it: whole, with thousands separators.
  public static func fmtCount(_ v: Double?, locale: String? = nil) -> String {
    guard let v else { return "—" }
    return AppLocale.formatNumber(v.jsRounded, locale: locale)
  }

  /// A rate (engagement per post): one decimal while small; words for none.
  public static func fmtRate(_ v: Double?, locale: String? = nil) -> String {
    guard let v else { return "no posts" }
    return v < 10
      ? AppLocale.formatNumber((v * 10).jsRounded / 10, locale: locale)
      : AppLocale.formatNumber(v.jsRounded, locale: locale)
  }

  /// An average of counts: one decimal while small, written even when
  /// nought ("2.0"); whole above ten.
  public static func fmtAverage(_ v: Double?, locale: String? = nil) -> String {
    guard let v else { return "—" }
    if v < 10 { return AppLocale.formatNumber(v, locale: locale, minimumFractionDigits: 1, maximumFractionDigits: 1) }
    return AppLocale.formatNumber(v.jsRounded, locale: locale)
  }

  /// A number for a figure: whole with separators, or one decimal while small.
  public static func fmtFigure(_ v: Double?, decimals: Bool = false, locale: String? = nil) -> String {
    guard let v, !v.isNaN else { return "—" }
    if decimals && abs(v) < 10 { return AppLocale.formatNumber((v * 10).jsRounded / 10, locale: locale) }
    return AppLocale.formatNumber(v.jsRounded, locale: locale)
  }

  /// "Daily", "Weekly", "Monthly".
  public static func unitLabel(_ unit: AnalyticsUnit) -> String {
    switch unit {
    case .month: return "Monthly"
    case .week: return "Weekly"
    case .day: return "Daily"
    }
  }

  /// "day", "week", "month": for titles ("Posts per day").
  public static func unitNoun(_ unit: AnalyticsUnit) -> String {
    unit.rawValue
  }

  /// A change in percent, as a delta chip reads it: "+12%", "−4%", "new".
  public static func deltaText(_ pct: Double?, locale: String? = nil) -> String {
    guard let pct else { return "new" }
    if pct == 0 { return "0%" }
    let v = abs(pct) >= 10 ? abs(pct).jsRounded : (abs(pct) * 10).jsRounded / 10
    return "\(pct > 0 ? "+" : "−")\(AppLocale.formatNumber(v, locale: locale))%"
  }
}
