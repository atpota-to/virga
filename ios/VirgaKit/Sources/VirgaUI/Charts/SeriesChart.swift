// Ports src/charts/SeriesChart.jsx
// Ports src/charts/charts.css (.an-chart, its legend, plot, tooltip and marks)
//
// The one time-series chart, in Swift Charts. `.bars` draws columns from a
// zero baseline, a 2-point gap between neighbours, at most 24 wide; `.line`
// draws a 2-point line over the --chart-area wash (the cumulative view),
// with a dot on its last point. `trend` overlays a moving average in
// --chart-2, named in a legend over the plot ("7-day average"), broken
// where it has no value; `secondary` overlays a second, dashed line (with
// `stacked`, an additive layer on the first). `ghost` (line only) is the
// dashed reach from the line's end up to a value the line can't arrive at
// (the profile's own follower count), in --chart-ghost, past the last
// bucket, with an open dot and its words: never dressed as data. `marks`
// are the days worth pointing at (a note, a milestone), a dashed rule and a
// diamond each, named in the readout and listed under the chart (the
// newest five).
//
// A press (or a drag along it) is the web's hover: a crosshair at the
// nearest bucket and one readout over it, on the tooltip's own ground (dark
// by day, light at night). The rules carry their numbers at the column's
// edge (fmtTick), the dates hang under the first, the middle and the last
// bucket (axisStops). Every value is reachable without the chart through
// ChartTable, under it.

#if canImport(UIKit)
import Charts
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// One bucket: its time and its value (nil: nothing to show there).
public struct ChartPoint: Hashable, Sendable {
  public var t: Double
  public var v: Double?

  public init(t: Double, v: Double?) {
    self.t = t
    self.v = v
  }

  public init(_ point: SeriesPoint) { self.init(t: point.t, v: point.v) }
  public init(_ point: TrendPoint) { self.init(t: point.t, v: point.v) }
  public init(_ point: RatePoint) { self.init(t: point.t, v: point.v) }

  public static func of(_ points: [SeriesPoint]) -> [ChartPoint] { points.map(ChartPoint.init) }
  public static func of(_ points: [TrendPoint]) -> [ChartPoint] { points.map(ChartPoint.init) }
  public static func of(_ points: [RatePoint]) -> [ChartPoint] { points.map(ChartPoint.init) }

  /// As SeriesPoint, a missing value read as 0 (for the format helpers).
  var seriesPoint: SeriesPoint { SeriesPoint(t: t, v: v ?? 0) }
}

public enum ChartMode: Sendable {
  case bars, line
}

/// `ghost`: the reach's value, its words by the open dot, and the line
/// the readout adds on the last point.
public struct ChartGhost: Sendable {
  public var v: Double
  public var label: String?
  public var readout: String?

  public init(v: Double, label: String? = nil, readout: String? = nil) {
    self.v = v
    self.label = label
    self.readout = readout
  }
}

/// `secondary`: a second line, and its name.
public struct ChartSecondary: Sendable {
  public var label: String?
  public var series: [ChartPoint]

  public init(label: String?, series: [ChartPoint]) {
    self.label = label
    self.series = series
  }
}

public struct SeriesChart: View {
  @Environment(\.virgaTheme) private var theme
  @State private var selection: Double?

  private let series: [ChartPoint]
  private let seriesLabel: String?
  private let secondary: ChartSecondary?
  private let stacked: Bool
  private let trend: [ChartPoint]?
  private let mode: ChartMode
  private let unit: AnalyticsUnit
  private let zeroBase: Bool
  private let ghost: ChartGhost?
  private let format: (Double?) -> String
  private let trendFormat: (Double?) -> String
  private let marks: [SeriesMark]
  private let height: CGFloat
  private let label: String

  public init(
    series: [ChartPoint], seriesLabel: String? = nil, secondary: ChartSecondary? = nil, stacked: Bool = false,
    trend: [ChartPoint]? = nil, mode: ChartMode = .bars, unit: AnalyticsUnit = .day, zeroBase: Bool = true,
    ghost: ChartGhost? = nil, format: ((Double?) -> String)? = nil, marks: [SeriesMark]? = nil, height: CGFloat = 200,
    accessibilityLabel: String = "Series"
  ) {
    self.series = series
    self.seriesLabel = seriesLabel
    self.secondary = secondary
    self.stacked = stacked
    self.trend = trend
    self.mode = mode
    self.unit = unit
    self.zeroBase = zeroBase
    self.ghost = ghost
    self.format = format ?? { ChartFormat.fmtCount($0) }
    // An average of counts keeps its decimal while small.
    self.trendFormat = format ?? { ChartFormat.fmtAverage($0) }
    self.marks = marks ?? []
    self.height = height
    self.label = accessibilityLabel
  }

  // MARK: What is drawn

  private var n: Int { series.count }

  /// The second line, when it has a bucket for each of the first's.
  private var secondarySeries: [ChartPoint]? {
    guard mode == .line, let s = secondary?.series, s.count == n else { return nil }
    return s
  }

  /// With `stacked`, the second series sits on the first.
  private var secondaryPlot: [ChartPoint]? {
    guard let s = secondarySeries else { return nil }
    guard stacked else { return s }
    return s.indices.map { i in ChartPoint(t: s[i].t, v: (s[i].v ?? 0) + (series[i].v ?? 0)) }
  }

  private var showGhost: Bool { ghost != nil && mode == .line && n > 0 }

  private var shownMarks: [SeriesMark] { marks.filter { $0.i >= 0 && $0.i < n } }

  /// `dataMax`: the series, the second line as plotted, the trend's top and
  /// the ghost's reach.
  private var dataMax: Double {
    let values = series.map { $0.v ?? 0 }
    let second = secondaryPlot?.map { $0.v ?? 0 } ?? []
    let trendMax = trend.map { $0.map { $0.v ?? 0 }.max() ?? 0 } ?? 0
    return (values + second + [trendMax, showGhost ? ghost?.v ?? 0 : 0]).max() ?? 0
  }

  private var scale: ChartScale {
    let values = series.map { $0.v ?? 0 }
    let second = secondaryPlot?.map { $0.v ?? 0 } ?? []
    let low = (values + second).min() ?? 0
    return ChartFormat.chartScale(low, dataMax, zeroBase: zeroBase, bars: mode == .bars)
  }

  private var trendName: String? {
    guard let trend, trend.contains(where: { $0.v != nil }) else { return nil }
    return ChartFormat.trendName(series.map(\.seriesPoint), trend.map { TrendPoint(t: $0.t, v: $0.v) }, unit)
  }

  private var hovered: Int? {
    guard let selection, n > 0 else { return nil }
    return min(n - 1, max(0, Int(selection.rounded())))
  }

  // MARK: The view

  public var body: some View {
    if series.isEmpty {
      Text("Nothing in this window.")
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
    } else {
      VStack(alignment: .leading, spacing: theme.space2) {
        legend
        GeometryReader { geometry in
          plot(width: geometry.size.width)
        }
        .frame(height: height)
        marksList
      }
    }
  }

  @ViewBuilder private var legend: some View {
    let second = secondarySeries != nil
    if second || trendName != nil {
      HStack(spacing: theme.space4) {
        Spacer(minLength: 0)
        if second {
          LegendKey(color: theme.chart1, dashed: false, text: seriesLabel ?? "Primary")
          LegendKey(color: theme.chart2, dashed: true, text: secondary?.label ?? "Secondary")
        }
        if let trendName {
          LegendKey(color: theme.chart2, dashed: false, text: trendName)
        }
      }
      .virgaText(.textSm)
      .foregroundStyle(theme.muted)
      .accessibilityHidden(true)
    }
  }

  private func plot(width: CGFloat) -> some View {
    let scale = self.scale
    // The plot's slots: the ghost's reach takes a fixed 28 past the last.
    let gutterPoints: CGFloat = showGhost ? Measure.Chart.ghostGutter : 0
    let slot = max(1, (width - Measure.Chart.labelColumn - gutterPoints) / CGFloat(max(1, n)))
    let gutter = Double(gutterPoints / slot)
    let barWidth = max(1, min(Measure.Chart.barMax, slot - Measure.Chart.barGap))
    let stops = Self.dates(ChartFormat.axisStops(series.map(\.seriesPoint), unit), slot: slot, reach: mode == .bars ? barWidth / 2 : 0, width: width)
    return Chart {
      dataMarks(barWidth: barWidth, scale: scale)
      trendMarks
      secondaryMarks
      markRules(scale: scale)
      selectionMarks(scale: scale)
    }
    .chartXScale(domain: -0.5...(Double(n) - 0.5 + gutter))
    .chartYScale(domain: scale.min...max(scale.max, scale.min + 1e-9))
    .chartXAxis {
      AxisMarks(values: stops.map { Double($0.i) }) { value in
        let stop = stops.first { Double($0.i) == value.as(Double.self) }
        AxisValueLabel(anchor: Self.anchor(stop?.anchor)) {
          Text(stop?.text ?? "")
            .virgaText(size: Measure.Chart.labelSize)
            .foregroundStyle(theme.muted)
        }
      }
    }
    .chartYAxis {
      AxisMarks(values: scale.ticks) { _ in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 1))
          .foregroundStyle(theme.chartGrid)
      }
      AxisMarks(position: .leading, values: scale.labelled) { value in
        AxisValueLabel {
          Text(ChartFormat.fmtTick(value.as(Double.self) ?? 0))
            .virgaText(size: Measure.Chart.labelSize)
            .foregroundStyle(theme.muted)
        }
      }
    }
    .chartXSelection(value: $selection)
    .chartOverlay { proxy in
      GeometryReader { geometry in
        if let anchor = proxy.plotFrame {
          let frame = geometry[anchor]
          overlay(proxy: proxy, frame: frame, gutter: gutter, scale: scale)
        }
      }
      .allowsHitTesting(false)
    }
    // One image to VoiceOver, as the web's `<svg role="img">` is: without
    // this every mark and axis label is a stop of its own, named by bucket
    // index. Show as table is the way to the values.
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(summary(scale))
    .accessibilityIdentifier("series-chart")
  }

  /// The dates under the plot: the middle one steps aside when a narrow
  /// chart would run it into an end one (the web's estimate of the words'
  /// width at 12 points is enough to tell). The ends hang from a bar's own
  /// edges, a line's from its points.
  static func dates(_ stops: [AxisStop], slot: CGFloat, reach: CGFloat, width: CGFloat) -> [AxisStop] {
    func x(_ i: Int) -> CGFloat { Measure.Chart.labelColumn + slot * (CGFloat(i) + 0.5) }
    func at(_ s: AxisStop) -> CGFloat {
      switch s.anchor {
      case "start": return max(0, x(s.i) - reach)
      case "end": return min(width, x(s.i) + reach)
      default: return x(s.i)
      }
    }
    func words(_ s: AxisStop) -> CGFloat { CGFloat(s.text.jsLength) * Measure.Chart.dateCharWidth }
    var out: [AxisStop] = []
    for (k, s) in stops.enumerated() {
      guard s.anchor == "middle", let first = stops.first else {
        out.append(s)
        continue
      }
      let half = words(s) / 2
      let clearsFirst = at(s) - half > at(first) + words(first) + Measure.Chart.dateClearance
      let next = k + 1 < stops.count ? stops[k + 1] : nil
      let clearsLast = next.map { at(s) + half < at($0) - words($0) - Measure.Chart.dateClearance } ?? true
      if clearsFirst && clearsLast { out.append(s) }
    }
    return out
  }

  static func anchor(_ name: String?) -> UnitPoint {
    switch name {
    case "start": return .topLeading
    case "end": return .topTrailing
    default: return .top
    }
  }

  private func summary(_ scale: ChartScale) -> String {
    var out = "\(label): \(n) \(unit.rawValue) buckets, peak \(format(dataMax))"
    if showGhost, let ghost {
      out += "; dashed reference reaching \(AppLocale.formatNumber(ghost.v.jsRounded))"
    }
    let marked = shownMarks.count
    if marked > 0 { out += "; \(marked) marked \(marked == 1 ? "day" : "days"), listed below" }
    return out
  }

  // MARK: Marks

  @ChartContentBuilder
  private func dataMarks(barWidth: CGFloat, scale: ChartScale) -> some ChartContent {
    if mode == .bars {
      ForEach(Array(series.enumerated()), id: \.offset) { i, point in
        if let v = point.v, v > 0 {
          BarMark(
            x: .value("Bucket", Double(i)), yStart: .value("Value", max(0, scale.min)), yEnd: .value("Value", v),
            width: .fixed(barWidth)
          )
          .cornerRadius(Measure.Chart.barRadius)
          .foregroundStyle(theme.chart1.opacity(hovered == i ? 1 : Measure.Chart.barOpacity))
        }
      }
    } else {
      ForEach(Array(series.enumerated()), id: \.offset) { i, point in
        if secondarySeries == nil || stacked {
          AreaMark(x: .value("Bucket", Double(i)), yStart: .value("Value", scale.min), yEnd: .value("Value", point.v ?? 0))
            .foregroundStyle(theme.chartArea)
        }
      }
      ForEach(Array(series.enumerated()), id: \.offset) { i, point in
        LineMark(x: .value("Bucket", Double(i)), y: .value("Value", point.v ?? 0), series: .value("Series", "primary"))
          .foregroundStyle(theme.chart1)
          .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
      }
      if let last = series.last {
        PointMark(x: .value("Bucket", Double(n - 1)), y: .value("Value", last.v ?? 0))
          .symbol { Dot(fill: theme.chart1, edge: theme.bg, size: Measure.Chart.dot) }
      }
    }
  }

  /// The trend, broken where it has no value: each run is a line of its own.
  @ChartContentBuilder
  private var trendMarks: some ChartContent {
    if let trend {
      ForEach(Array(trend.enumerated()), id: \.offset) { i, point in
        if let v = point.v {
          LineMark(x: .value("Bucket", Double(i)), y: .value("Value", v), series: .value("Series", "trend-\(Self.run(trend, i))"))
            .foregroundStyle(theme.chart2)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
      }
    }
  }

  /// Which run of values a trend point is in (a gap starts the next).
  static func run(_ points: [ChartPoint], _ i: Int) -> Int {
    var run = 0
    for k in 0..<i where points[k].v == nil && (k + 1 < points.count && points[k + 1].v != nil) {
      run += 1
    }
    return run
  }

  @ChartContentBuilder
  private var secondaryMarks: some ChartContent {
    if let plot = secondaryPlot {
      ForEach(Array(plot.enumerated()), id: \.offset) { i, point in
        LineMark(x: .value("Bucket", Double(i)), y: .value("Value", point.v ?? 0), series: .value("Series", "secondary"))
          .foregroundStyle(theme.chart2)
          .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: Measure.Chart.secondaryDash))
      }
      if let last = plot.last {
        PointMark(x: .value("Bucket", Double(n - 1)), y: .value("Value", last.v ?? 0))
          .symbol { Dot(fill: theme.chart2, edge: theme.bg, size: Measure.Chart.dot) }
      }
    }
  }

  @ChartContentBuilder
  private func markRules(scale: ChartScale) -> some ChartContent {
    ForEach(shownMarks, id: \.i) { mark in
      RuleMark(x: .value("Bucket", Double(mark.i)), yStart: .value("Value", scale.min), yEnd: .value("Value", scale.max))
        .foregroundStyle(theme.muted)
        .lineStyle(StrokeStyle(lineWidth: 1, dash: Measure.Chart.markDash))
      PointMark(x: .value("Bucket", Double(mark.i)), y: .value("Value", scale.max))
        .symbol {
          Rectangle()
            .fill(mark.kind == .milestone ? theme.chart1 : theme.ink2)
            .frame(width: Measure.Chart.diamond, height: Measure.Chart.diamond)
            .rotationEffect(.degrees(45))
        }
    }
  }

  @ChartContentBuilder
  private func selectionMarks(scale: ChartScale) -> some ChartContent {
    if let i = hovered {
      RuleMark(x: .value("Bucket", Double(i)), yStart: .value("Value", scale.min), yEnd: .value("Value", scale.max))
        .foregroundStyle(theme.line2)
        .lineStyle(StrokeStyle(lineWidth: 1))
        .annotation(position: .top, spacing: Measure.Chart.tipSpace, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
          ChartTip(lines: tipLines(i))
        }
      if mode == .line, let v = series[i].v {
        PointMark(x: .value("Bucket", Double(i)), y: .value("Value", v))
          .symbol { Dot(fill: theme.chart1, edge: theme.bg, size: Measure.Chart.marker) }
      }
      if let plot = secondaryPlot, let v = plot[i].v {
        PointMark(x: .value("Bucket", Double(i)), y: .value("Value", v))
          .symbol { Dot(fill: theme.chart2, edge: theme.bg, size: Measure.Chart.marker) }
      }
    }
  }

  /// The readout over bucket `i`.
  private func tipLines(_ i: Int) -> [ChartTip.Line] {
    var out: [ChartTip.Line] = []
    let point = series[i]
    out.append(.init(text: (seriesLabel.map { "\($0) " } ?? "") + format(point.v), style: .strong))
    if let s = secondarySeries?[i], let v = s.v {
      out.append(.init(text: "\(secondary?.label ?? "") \(AppLocale.formatNumber(v.jsRounded))", style: .strongSecond))
    }
    if stacked, let total = secondaryPlot?[i].v {
      out.append(.init(text: "Total \(AppLocale.formatNumber(total.jsRounded))", style: .strong))
    }
    out.append(.init(text: Analytics.bucketLabel(point.t, unit), style: .plain))
    if showGhost, i == n - 1, let ghost {
      out.append(.init(text: ghost.readout ?? "Profile counter \(ChartFormat.fmtCount(ghost.v))", style: .plain))
    }
    if let trendName, let v = trend?[i].v {
      out.append(.init(text: "\(trendName) \(trendFormat(v))", style: .second))
    }
    for mark in shownMarks where mark.i == i {
      for item in mark.items { out.append(.init(text: item.label, style: .mark)) }
    }
    return out
  }

  // MARK: Drawn over the plot

  /// The ghost's reach and the stacked layer's wash, placed through the
  /// chart's own scales.
  @ViewBuilder
  private func overlay(proxy: ChartProxy, frame: CGRect, gutter: Double, scale: ChartScale) -> some View {
    let base = proxy.position(forY: scale.min).map { $0 + frame.minY } ?? frame.maxY
    if showGhost, let ghost, let last = series.last,
      let x0 = proxy.position(forX: Double(n - 1)), let y0 = proxy.position(forY: last.v ?? 0),
      let y1 = proxy.position(forY: ghost.v)
    {
      let start = CGPoint(x: frame.minX + x0, y: frame.minY + y0)
      let end = CGPoint(x: frame.maxX - Measure.Chart.ghostInset, y: frame.minY + y1)
      ZStack(alignment: .topLeading) {
        Path { path in
          path.move(to: CGPoint(x: start.x, y: base))
          path.addLine(to: start)
          path.addLine(to: end)
          path.addLine(to: CGPoint(x: end.x, y: base))
          path.closeSubpath()
        }
        .fill(theme.chartArea)
        Path { path in
          path.move(to: start)
          path.addLine(to: end)
        }
        .stroke(theme.chartGhost, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: Measure.Chart.ghostDash))
        Circle()
          .fill(theme.bg)
          .overlay(Circle().stroke(theme.chartGhost, lineWidth: 1.5))
          .frame(width: Measure.Chart.dot, height: Measure.Chart.dot)
          .position(end)
        // Its words, out of the way while a readout hangs over them.
        if hovered.map({ $0 < n - 3 }) ?? true {
          // `text-anchor: end` at the dot, riding above it (below, when the
          // dot brushes the top), on the ground so a rule behind can't
          // strike through it. The web tests the dot's height in its SVG,
          // whose plot starts `PAD.t` down (and MARKS_ROOM more with marked
          // days); this plot starts at the overlay's top, so its room is
          // counted in.
          let padT = Measure.Chart.plotTop + (shownMarks.isEmpty ? 0 : Measure.Chart.marksRoom)
          let baseline = y1 + padT - 8 < 12 ? end.y + 16 : end.y - 8
          Text(ghost.label ?? "\(ChartFormat.fmtCount(ghost.v)) on profile")
            .virgaText(size: Measure.Chart.labelSize)
            .foregroundStyle(theme.muted)
            .padding(.horizontal, 2)
            .background(theme.bg.opacity(0.85))
            .fixedSize()
            .alignmentGuide(.leading) { d in d[.trailing] - end.x }
            .alignmentGuide(.top) { d in d[.lastTextBaseline] - baseline }
        }
      }
    }
    if stacked, let plot = secondaryPlot {
      Path { path in
        for (i, point) in plot.enumerated() {
          guard let x = proxy.position(forX: Double(i)), let y = proxy.position(forY: point.v ?? 0) else { continue }
          let at = CGPoint(x: frame.minX + x, y: frame.minY + y)
          if i == 0 { path.move(to: at) } else { path.addLine(to: at) }
        }
        for (i, point) in series.enumerated().reversed() {
          guard let x = proxy.position(forX: Double(i)), let y = proxy.position(forY: point.v ?? 0) else { continue }
          path.addLine(to: CGPoint(x: frame.minX + x, y: frame.minY + y))
        }
        path.closeSubpath()
      }
      .fill(theme.chart2.opacity(Measure.Chart.stackedOpacity))
    }
  }

  // MARK: Under the chart

  @ViewBuilder private var marksList: some View {
    let shown = shownMarks
    if !shown.isEmpty {
      FlowLayout(spacing: Measure.Chart.marksGap, lineSpacing: Measure.Chart.marksLineGap) {
        ForEach(shown.suffix(Measure.Chart.marksListed), id: \.i) { mark in
          HStack(spacing: Measure.Chart.marksDiamondGap) {
            Rectangle()
              .fill(mark.kind == .milestone ? theme.chart1 : theme.ink2)
              .frame(width: 6, height: 6)
              .rotationEffect(.degrees(45))
              .accessibilityHidden(true)
            Text(Annotations.markText(mark, unit))
          }
          .foregroundStyle(theme.ink2)
        }
        if shown.count > Measure.Chart.marksListed {
          Text("and \(shown.count - Measure.Chart.marksListed) earlier")
            .foregroundStyle(theme.muted)
        }
      }
      .virgaText(.textSm)
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Marked on this chart")
    }
  }
}

/// A legend's key: a short line in the series' colour, and its name.
struct LegendKey: View {
  let color: Color
  let dashed: Bool
  let text: String

  var body: some View {
    HStack(spacing: Measure.Chart.legendGap) {
      Path { path in
        path.move(to: CGPoint(x: 0, y: 1))
        path.addLine(to: CGPoint(x: 16, y: 1))
      }
      .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: dashed ? [4, 3] : []))
      .frame(width: 16, height: 2)
      Text(text)
    }
  }
}

/// A point's dot: filled in its colour, edged in the ground.
struct Dot: View {
  let fill: Color
  let edge: Color
  let size: CGFloat

  var body: some View {
    Circle()
      .fill(fill)
      .overlay(Circle().stroke(edge, lineWidth: 2))
      .frame(width: size, height: size)
  }
}

/// `.an-chart-tip`: the readout, on its own ground (dark by day, light at
/// night), its first line strong.
struct ChartTip: View {
  struct Line: Hashable {
    /// `strong` the first line; `strongSecond` the second series' value
    /// (`<strong className="an-chart-tip-secondary">`); `second` the trend's.
    enum Style { case strong, strongSecond, second, plain, mark }
    var text: String
    var style: Style
  }

  @Environment(\.virgaTheme) private var theme
  let lines: [Line]

  var body: some View {
    let night = theme.colorScheme == .dark
    VStack(alignment: .leading, spacing: 1) {
      ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
        switch line.style {
        case .strong:
          Text(line.text)
            .virgaText(.textBase, weight: VirgaWeight.semibold)
            .foregroundStyle(night ? Measure.Chart.tipStrongNight : Measure.Chart.tipStrongDay)
        case .strongSecond:
          Text(line.text)
            .virgaText(.textBase, weight: VirgaWeight.semibold)
            .foregroundStyle(theme.secondTip)
        case .second:
          Text(line.text).foregroundStyle(theme.secondTip)
        case .mark:
          Text(line.text).virgaText(.textSm, weight: VirgaWeight.semibold)
        case .plain:
          Text(line.text)
        }
      }
    }
    .virgaText(.textSm)
    .foregroundStyle(night ? Measure.Chart.tipInkNight : Measure.Chart.tipInkDay)
    .lineLimit(1)
    .fixedSize()
    .padding(Measure.Chart.tipPadding)
    .background(
      RoundedRectangle(cornerRadius: theme.radius).fill(night ? Measure.Chart.tipFillNight : Measure.Chart.tipFillDay)
    )
    .virgaShadow(theme.shadow(theme.tokens.shadowMd))
    .accessibilityElement(children: .combine)
  }
}

#Preview("Series") {
  let now = 1_763_683_200_000.0
  let days = (0..<30).map { ChartPoint(t: now - Double(29 - $0) * 86_400_000, v: Double(($0 * 37) % 23)) }
  return VirgaPreviewHost {
    VStack(spacing: 32) {
      SeriesChart(series: days, seriesLabel: nil, mode: .bars, accessibilityLabel: "New followers")
      SeriesChart(
        series: days.enumerated().map { ChartPoint(t: $1.t, v: Double(4_800 + $0 * 9)) }, mode: .line, zeroBase: false,
        ghost: ChartGhost(v: 5_120), accessibilityLabel: "Followers")
    }
    .padding()
  }
}
#endif
