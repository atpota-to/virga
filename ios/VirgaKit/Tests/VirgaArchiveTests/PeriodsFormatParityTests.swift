// Parity with src/lib/periods.js and src/charts/format.js (fixtures
// archive.periods and archive.format).

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport
@testable import VirgaArchive

/// A period object from a case (markers read back).
func period(_ value: JSONValue?) -> AnalyticsPeriod? {
  guard let value, case .object = value else { return nil }
  let v = markers(value)
  return AnalyticsPeriod(
    key: v["key"]?.stringValue ?? "", days: v["days"]?.intValue, label: v["label"]?.stringValue ?? "",
    start: v["start"]?.doubleValue, end: v["end"]?.doubleValue, from: v["from"]?.stringValue, to: v["to"]?.stringValue,
    custom: v["custom"]?.boolValue)
}

@Suite struct PeriodsParity {
  @Test func constants() throws {
    try forEachCase("archive.periods", "constants") { _ in
      ["DEFAULT_PERIOD_KEY": .string(Periods.defaultPeriodKey), "CUSTOM_PERIOD": .string(Periods.customPeriod)]
    }
  }

  @Test func presetPeriod() throws {
    try forEachCase("archive.periods", "presetPeriod") { c in
      Periods.presetPeriod(c["key"].stringValue).map(encoded) ?? .null
    }
  }

  @Test func dayStartMs() throws {
    try forEachCase("archive.periods", "dayStartMs") { c in
      js(Periods.dayStartMs(c["day"].stringValue, timeZone: c.zone))
    }
  }

  @Test func dayKey() throws {
    try forEachCase("archive.periods", "dayKey") { c in
      .string(Periods.dayKey(c.number("ms"), timeZone: c.zone))
    }
  }

  @Test func rangeLabel() throws {
    try forEachCase("archive.periods", "rangeLabel") { c in
      let from = c.has("fromMs") ? c.number("fromMs") : Periods.dayStartMs(c["from"].stringValue, timeZone: c.zone)
      let to = c.has("toMs") ? c.number("toMs") : Periods.dayStartMs(c["to"].stringValue, timeZone: c.zone)
      let joiner = c["joiner"].stringValue ?? " – "
      return .string(Periods.rangeLabel(from, to, joiner, locale: c.locale, timeZone: c.zone))
    }
  }

  @Test func customPeriod() throws {
    try forEachCase("archive.periods", "customPeriod") { c in
      Periods.customPeriod(c["from"].stringValue, c["to"].stringValue, c.number("now"), locale: c.locale, timeZone: c.zone)
        .map(encoded) ?? .null
    }
  }

  @Test func resolvePeriod() throws {
    try forEachCase("archive.periods", "resolvePeriod") { c in
      let prefs = c["prefs"]
      return encoded(
        Periods.resolvePeriod(
          period: prefs["period"]?.stringValue, periodFrom: prefs["periodFrom"]?.stringValue,
          periodTo: prefs["periodTo"]?.stringValue, nowMs: c.number("now"), locale: c.locale, timeZone: c.zone))
    }
  }

  @Test func words() throws {
    try forEachCase("archive.periods", "words") { c in
      let p = period(c.input["period"])
      let now = c.number("now")
      return [
        "phrase": .string(Periods.periodPhrase(p, locale: c.locale, timeZone: c.zone)),
        "line": .string(Periods.periodLine(p, now, locale: c.locale, timeZone: c.zone)),
        "windowWord": .string(Periods.periodWindowWord(p)),
        "before": .string(Periods.periodBefore(p)),
        "beforeCapital": .string(Periods.periodBefore(p, true)),
        "start": js(Periods.periodStart(p, now)),
        "end": js(Periods.periodEnd(p, now)),
      ]
    }
  }

  @Test func resolvesStoredPreferences() {
    var prefs = Preferences.defaultPreferences
    prefs.period = .custom
    prefs.periodFrom = "2026-10-01"
    prefs.periodTo = "2026-10-31"
    let utc = TimeZone(identifier: "UTC")!
    let now = JSDate.utc(2026, 10, 14, 15)
    let resolved = Periods.resolvePeriod(prefs, nowMs: now, locale: "en-US", timeZone: utc)
    #expect(resolved.key == "custom:2026-10-01:2026-10-31")
    #expect(resolved.days == 31)
    #expect(Periods.resolvePeriod(nil, nowMs: now, timeZone: utc).key == "30d")
  }
}

private func points(_ value: JSONValue?) -> [SeriesPoint] {
  (value?.arrayValue ?? []).map { SeriesPoint(t: num($0["t"]), v: num($0["v"])) }
}

@Suite struct ChartFormatParity {
  @Test func niceScale() throws {
    try forEachCase("archive.format", "niceScale") { c in
      encoded(ChartFormat.niceScale(c.number("min"), c.number("max")))
    }
  }

  @Test func chartScale() throws {
    try forEachCase("archive.format", "chartScale") { c in
      encoded(
        ChartFormat.chartScale(
          c.number("min"), c.number("max"), zeroBase: c["zeroBase"].boolValue ?? true, bars: c["bars"].boolValue ?? false))
    }
  }

  @Test func axisStops() throws {
    try forEachCase("archive.format", "axisStops") { c in
      encoded(
        ChartFormat.axisStops(points(c.input["series"]), AnalyticsUnit(c["unit"].stringValue), locale: c.locale, timeZone: c.zone))
    }
  }

  @Test func trendName() throws {
    try forEachCase("archive.format", "trendName") { c in
      let trend = (c["trend"].arrayValue ?? []).map { TrendPoint(t: num($0["t"]), v: $0["v"]?.doubleValue) }
      return .string(ChartFormat.trendName(points(c.input["series"]), trend, AnalyticsUnit(c["unit"].stringValue)))
    }
  }

  @Test func heatSteps() throws {
    try forEachCase("archive.format", "heatSteps") { c in
      let values: [Double?] = (c["values"].arrayValue ?? []).map { $0.isNull ? nil : num($0) }
      let steps = ChartFormat.heatSteps(values)
      return .array(steps.entries.map { [js($0.value), .number(Double($0.step))] })
    }
  }

  @Test func heatStepsLookUp() {
    let steps = ChartFormat.heatSteps([0, nil, 1, 2, 3, 4, 5, 1000])
    #expect(steps[0] == 0)
    #expect(steps[nil] == nil)
    #expect(steps[1] == 1)
    #expect(steps[1000] == 6)
  }

  @Test func fmtTick() throws {
    try forEachCase("archive.format", "fmtTick") { c in
      .string(ChartFormat.fmtTick(c.number("v"), locale: c.locale))
    }
  }

  @Test func clamp() throws {
    try forEachCase("archive.format", "clamp") { c in
      js(ChartFormat.clamp(c.number("v"), c.number("lo"), c.number("hi")))
    }
  }

  @Test func numbers() throws {
    try forEachCase("archive.format", "numbers") { c in
      let v = c.optionalNumber("v")
      return [
        "count": .string(ChartFormat.fmtCount(v, locale: c.locale)),
        "rate": .string(ChartFormat.fmtRate(v, locale: c.locale)),
        "average": .string(ChartFormat.fmtAverage(v, locale: c.locale)),
        "figure": .string(ChartFormat.fmtFigure(v, locale: c.locale)),
        "figureDecimals": .string(ChartFormat.fmtFigure(v, decimals: true, locale: c.locale)),
        "delta": .string(ChartFormat.deltaText(v, locale: c.locale)),
      ]
    }
  }

  @Test func units() throws {
    try forEachCase("archive.format", "units") { c in
      let unit = AnalyticsUnit(c["unit"].stringValue)
      return ["label": .string(ChartFormat.unitLabel(unit)), "noun": .string(ChartFormat.unitNoun(unit))]
    }
  }
}
