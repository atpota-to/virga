// Ports src/share/chartImage.js
//
// A card as a picture: the title, whose numbers they are, the headline
// figure and the chart, drawn at a size Bluesky shows whole (16:9), under
// the sky that is on screen and in its colours.
//
// The layout is worked out by pure functions, and the drawing is the web's
// canvas calls, one for one, made on a `ShareCanvas`: VirgaUI's canvas
// draws them with SwiftUI (GraphicsContext, through ImageRenderer) and
// measures text with the app's typeface; the tests record them and hold
// them to the web's, call by call. What a canvas is (a fill style, a font,
// a path) is ChartImage+Canvas.swift.

import Foundation
import VirgaArchive
import VirgaCore

public enum ChartImage {
  public static let shareWidth: Double = 1200
  public static let shareHeight: Double = 675

  static let pad: Double = 56
  /// The plot starts a clear line under the headline figure, so its top
  /// rule's number never sits against the figure's words, and ends with
  /// room for its dates over the mark in the corner.
  public static let plot = ShareBox(left: pad, right: shareWidth - pad, top: 264, bottom: shareHeight - 130)
  /// Room at the right for the dashed reach to a reference the line can't arrive at.
  static let ghostGutter: Double = 70
  /// The typeface the picture is set in, first choice first.
  public static let fontFamily = [
    "Instrument Sans Variable", "Instrument Sans", "system-ui", "-apple-system", "Segoe UI", "sans-serif",
  ]
  /// Room between the widest of the rules' numbers and the first bar or point.
  static let labelGap: Double = 14

  // MARK: - The theme

  /// The page's colours, read off it so the picture matches the screen:
  /// the ground, the two colours of the sky over it, the ink and the
  /// chart's own. A token with no value takes the web's fallback.
  public static func readShareTheme(_ theme: ResolvedTheme) -> ShareTheme {
    func v(_ token: ThemeToken, _ fallback: ThemeColor) -> ThemeColor { theme.color(token) ?? fallback }
    let ground = v(.bg, .hex(0xFFFFFF))
    return ShareTheme(
      surface: ground,
      skyTop: v(.skyTop, ground),
      skyMid: v(.skyMid, ground),
      ink: v(.ink, .hex(0x0F1B33)),
      ink2: v(.ink2, .hex(0x33415C)),
      muted: v(.muted, .hex(0x46536B)),
      line: v(.line, .rgb(15, 27, 51, 0.14)),
      grid: v(.chartGrid, .rgb(15, 27, 51, 0.1)),
      chart1: v(.chart1, .hex(0x1D5EE0)),
      chart2: v(.chart2, .hex(0xE8553A)),
      area: v(.chartArea, .rgb(29, 94, 224, 0.08)),
      track: v(.tint, .rgb(15, 27, 51, 0.06)),
      accent: v(.accent, .hex(0x1D5EE0)))
  }

  // MARK: - Layout

  /// Where a series sits in the plot: the y scale, each point's x and y,
  /// the bar width, the rules (`ticks`) and which of them carry a number
  /// (`labelled`), on the same scale as the chart on the page (chartScale).
  public static func seriesLayout(_ spec: ShareSpecification, _ box: ShareBox = plot) -> SeriesLayout {
    let n = spec.series.count
    let values = spec.series.map { $0.v ?? 0 }
    var dataMax = -Double.infinity
    for v in values + (spec.trend.map { $0.map { $0.v ?? 0 } } ?? [0]) + [spec.ghost ?? 0] { dataMax = JSMath.max(dataMax, v) }
    // The ghost reaches past the last bucket, so the series cedes it a gutter.
    var box = box
    if spec.ghost != nil { box.right -= ghostGutter }
    var dataMin = Double.infinity
    for v in values { dataMin = JSMath.min(dataMin, v) }
    let scale = ChartFormat.chartScale(dataMin, dataMax, zeroBase: spec.zeroBase, bars: spec.mode == "bars")
    let span = JSMath.max(1e-9, scale.max - scale.min)
    let slot = (box.right - box.left) / Double(n)
    return SeriesLayout(
      n: n, min: scale.min, max: scale.max, slot: slot, box: box, span: span,
      barWidth: JSMath.max(1, JSMath.min(40, slot - JSMath.max(2, slot * 0.22))), ticks: scale.ticks,
      labelled: scale.labelled)
  }

  /// The dates under a chart (ChartFormat.axisStops), as the canvas aligns text.
  public static func axisLabels(
    _ series: [SharePoint], _ unit: AnalyticsUnit, locale: String? = nil, timeZone: TimeZone = AppLocale.activeTimeZone()
  ) -> [AxisLabel] {
    let points = series.map { SeriesPoint(t: $0.t, v: $0.v ?? 0) }
    let align: [String: ShareTextAlign] = ["start": .left, "middle": .center, "end": .right]
    return ChartFormat.axisStops(points, unit, locale: locale, timeZone: timeZone).map {
      AxisLabel(at: $0.i, text: $0.text, align: align[$0.anchor] ?? .left)
    }
  }

  /// Text cut to fit `width`, with an ellipsis, measured as the canvas
  /// measures it in its current font.
  public static func fitText(_ ctx: some ShareCanvas, _ text: String, _ width: Double) -> String {
    if ctx.measureText(text) <= width { return text }
    var cut = Array(text.utf16)
    while cut.count > 1 && ctx.measureText("\(String(jsUnits: cut[...]))…") > width { cut.removeLast() }
    return "\(String(jsUnits: cut[...]).jsTrimmingEnd())…"
  }

  static func roundRect(_ ctx: some ShareCanvas, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double) {
    let rr = JSMath.max(0, JSMath.min(r, JSMath.min(w / 2, h / 2)))
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }

  static func font(_ weight: Int, _ size: Double) -> ShareFont { ShareFont(weight: weight, size: size) }

  // MARK: - Drawing

  static func drawHead(_ ctx: some ShareCanvas, _ spec: ShareSpecification, _ theme: ShareTheme) {
    ctx.textBaseline = .alphabetic
    ctx.textAlign = .left
    ctx.fillStyle = .color(theme.ink)
    ctx.font = font(600, 40)
    ctx.fillText(fitText(ctx, spec.title, shareWidth - pad * 2), pad, pad + 36)
    ctx.fillStyle = .color(theme.muted)
    ctx.font = font(400, 22)
    ctx.fillText(fitText(ctx, spec.subtitle, shareWidth - pad * 2), pad, pad + 72)
    if let figure = spec.figure {
      // The figure as the app sets one: large, medium weight, drawn in close.
      ctx.fillStyle = .color(theme.ink)
      ctx.font = font(500, 64)
      let tight = ctx.supportsLetterSpacing
      if tight { ctx.letterSpacing = -2.5 }
      let value = figure.value
      ctx.fillText(value, pad, pad + 152)
      let after = pad + ctx.measureText(value) + 16
      if tight { ctx.letterSpacing = 0 }
      ctx.fillStyle = .color(theme.ink2)
      ctx.font = font(400, 24)
      ctx.fillText(fitText(ctx, figure.label, shareWidth - pad - after), after, pad + 148)
    }
  }

  static func drawFoot(_ ctx: some ShareCanvas, _ theme: ShareTheme) {
    // The mark: the cloud's arc with rain that never lands, in ink, as in the app.
    let s: Double = 30
    let x = pad - 4
    let y = shareHeight - pad - s + 6
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(s / 24, s / 24)
    ctx.strokeStyle = .color(theme.ink)
    ctx.lineWidth = 1.8
    ctx.lineCap = .round
    ctx.beginPath()
    ctx.arc(12, 11, 7, Double.pi, 0)
    ctx.moveTo(8.5, 14.5)
    ctx.lineTo(7.5, 18.5)
    ctx.moveTo(12.3, 14.5)
    ctx.lineTo(11, 20.5)
    ctx.moveTo(16, 14.5)
    ctx.lineTo(15.1, 17.7)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = .color(theme.ink)
    ctx.font = font(600, 22)
    ctx.textAlign = .left
    ctx.fillText("Virga", x + s + 8, y + 22)
  }

  static func drawSeries(_ ctx: some ShareCanvas, _ spec: ShareSpecification, _ theme: ShareTheme, _ formats: ReportFormats) {
    // The rules' numbers sit on the plot's left edge, the title's edge, and
    // the data starts past the widest of them, as on the page.
    ctx.font = font(400, 18)
    let tickText = { (v: Double) in ChartFormat.fmtTick(v, locale: formats.locale) }
    let first = seriesLayout(spec)
    var column: Double = 0
    if !first.labelled.isEmpty {
      var widest = -Double.infinity
      for tick in first.labelled { widest = JSMath.max(widest, ctx.measureText(tickText(tick))) }
      column = widest + labelGap
    }
    var box = plot
    box.left += column
    let L = seriesLayout(spec, box)
    let series = spec.series
    let P = plot

    ctx.lineWidth = 1
    ctx.strokeStyle = .color(theme.grid)
    for tick in L.ticks {
      let ty = L.y(tick).jsRounded + 0.5
      ctx.beginPath()
      ctx.moveTo(P.left, ty)
      ctx.lineTo(P.right, ty)
      ctx.stroke()
    }

    if spec.mode == "line" {
      ctx.beginPath()
      ctx.moveTo(L.x(0), P.bottom)
      for (i, p) in series.enumerated() { ctx.lineTo(L.x(i), L.y(p.v ?? 0)) }
      ctx.lineTo(L.x(L.n - 1), P.bottom)
      ctx.closePath()
      ctx.fillStyle = .color(theme.area)
      ctx.fill()
      ctx.beginPath()
      for (i, p) in series.enumerated() {
        if i == 0 { ctx.moveTo(L.x(i), L.y(p.v ?? 0)) } else { ctx.lineTo(L.x(i), L.y(p.v ?? 0)) }
      }
      ctx.strokeStyle = .color(theme.chart1)
      ctx.lineWidth = 4
      ctx.lineJoin = .round
      ctx.stroke()
      let endX = L.x(L.n - 1)
      let endY = L.y(series[L.n - 1].v ?? 0)
      if let ghost = spec.ghost {
        // Dashed and open, as on the card: a reference, not a measurement.
        let gx = P.right - 10
        let gy = L.y(ghost)
        ctx.beginPath()
        ctx.moveTo(endX, P.bottom)
        ctx.lineTo(endX, endY)
        ctx.lineTo(gx, gy)
        ctx.lineTo(gx, P.bottom)
        ctx.closePath()
        ctx.fillStyle = .color(theme.area)
        ctx.fill()
        ctx.setLineDash([8, 8])
        ctx.strokeStyle = .color(theme.muted)
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(endX, endY)
        ctx.lineTo(gx, gy)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(gx, gy, 7, 0, Double.pi * 2)
        ctx.fillStyle = .color(theme.surface)
        ctx.fill()
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(endX, endY, 7, 0, Double.pi * 2)
      ctx.fillStyle = .color(theme.chart1)
      ctx.fill()
    } else {
      ctx.fillStyle = .color(theme.chart1)
      for (i, p) in series.enumerated() {
        guard let v = p.v, v > 0 else { continue }
        let top = L.y(v)
        let h = JSMath.max(1, P.bottom - top)
        ctx.save()
        // Rounded at the data end only: the foot is clipped square to the baseline.
        ctx.beginPath()
        ctx.rect(P.left, P.top - 20, P.right - P.left, P.bottom - P.top + 20)
        ctx.clip()
        roundRect(ctx, L.x(i) - L.barWidth / 2, top, L.barWidth, h + 6, JSMath.min(6, L.barWidth / 2))
        ctx.fill()
        ctx.restore()
      }
    }

    let trend = spec.trend ?? []
    let hasTrend = trend.contains { $0.v != nil }
    if hasTrend {
      ctx.beginPath()
      var pen = false
      for (i, p) in trend.enumerated() {
        guard let v = p.v else {
          pen = false
          continue
        }
        if pen { ctx.lineTo(L.x(i), L.y(v)) } else { ctx.moveTo(L.x(i), L.y(v)) }
        pen = true
      }
      ctx.strokeStyle = .color(theme.chart2)
      ctx.lineWidth = 3
      ctx.lineJoin = .round
      ctx.stroke()
    }

    for m in spec.marks {
      let mx = L.x(m.i).jsRounded + 0.5
      ctx.strokeStyle = .color(theme.muted)
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 6])
      ctx.beginPath()
      ctx.moveTo(mx, P.top - 8)
      ctx.lineTo(mx, P.bottom)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = .color(m.kind == .milestone ? theme.chart1 : theme.ink2)
      ctx.beginPath()
      ctx.moveTo(mx, P.top - 22)
      ctx.lineTo(mx + 8, P.top - 14)
      ctx.lineTo(mx, P.top - 6)
      ctx.lineTo(mx - 8, P.top - 14)
      ctx.closePath()
      ctx.fill()
    }

    // The rules' numbers, each on its rule at the plot's left edge.
    ctx.font = font(400, 18)
    ctx.textAlign = .left
    ctx.fillStyle = .color(theme.muted)
    for tick in L.labelled { ctx.fillText(tickText(tick), P.left, L.y(tick).jsRounded - 6) }

    // Each date under its own bucket, the ends hanging inward from the
    // first and last bars' edges (a line's ends are its points), so the
    // dates stop where the buckets do, short of a ghost's gutter.
    let reach = spec.mode == "bars" ? L.barWidth / 2 : 0
    for label in axisLabels(series, spec.unit, locale: formats.locale, timeZone: formats.timeZone) {
      ctx.textAlign = label.align
      let lx: Double
      switch label.align {
      case .left: lx = L.x(label.at) - reach
      case .right: lx = L.x(label.at) + reach
      case .center: lx = L.x(label.at)
      }
      ctx.fillText(label.text, lx, P.bottom + 30)
    }

    if hasTrend {
      let points = series.map { SeriesPoint(t: $0.t, v: $0.v ?? 0) }
      let trendPoints = trend.map { TrendPoint(t: $0.t, v: $0.v) }
      drawTrendKey(ctx, ChartFormat.trendName(points, trendPoints, spec.unit), theme)
    }
  }

  /// The trend's legend, as on the page: a short stroke in its colour and
  /// its name, at the plot's top right.
  static func drawTrendKey(_ ctx: some ShareCanvas, _ name: String, _ theme: ShareTheme) {
    let cy = plot.top - 34
    ctx.font = font(400, 18)
    ctx.textAlign = .right
    ctx.textBaseline = .middle
    ctx.fillStyle = .color(theme.muted)
    ctx.fillText(name, plot.right, cy)
    let left = plot.right - ctx.measureText(name) - 10 - 28
    ctx.strokeStyle = .color(theme.chart2)
    ctx.lineWidth = 3
    ctx.lineCap = .round
    ctx.beginPath()
    ctx.moveTo(left, cy)
    ctx.lineTo(left + 28, cy)
    ctx.stroke()
    ctx.textBaseline = .alphabetic
  }

  static func drawBars(_ ctx: some ShareCanvas, _ spec: ShareSpecification, _ theme: ShareTheme) {
    let rows = Array(spec.rows.prefix(8))
    var top: Double = 1
    for r in rows { top = JSMath.max(top, r.value) }
    let rowH = JSMath.min(52, (shareHeight - 110 - plot.top + 20) / Double(rows.count))
    let labelW: Double = 300
    let valueW: Double = 110
    let trackX = pad + labelW
    let trackW = shareWidth - pad - valueW - trackX
    ctx.textBaseline = .middle
    for (i, r) in rows.enumerated() {
      let cy = plot.top - 6 + rowH * (Double(i) + 0.5)
      ctx.textAlign = .left
      ctx.fillStyle = .color(theme.ink2)
      ctx.font = font(500, 24)
      ctx.fillText(fitText(ctx, r.label, labelW - 20), pad, cy)
      ctx.fillStyle = .color(theme.track)
      roundRect(ctx, trackX, cy - 6, trackW, 12, 6)
      ctx.fill()
      ctx.fillStyle = .color(theme.chart1)
      roundRect(ctx, trackX, cy - 6, JSMath.max(12, (r.value / top) * trackW), 12, 6)
      ctx.fill()
      ctx.textAlign = .right
      ctx.fillStyle = .color(theme.ink)
      ctx.font = font(600, 24)
      ctx.fillText(r.display, shareWidth - pad, cy)
    }
    ctx.textBaseline = .alphabetic
  }

  /// Draws `spec` on a canvas `shareWidth` by `shareHeight`, the web's calls
  /// in the web's order. `formats` writes the rules' numbers and the dates.
  public static func drawShareImage(
    _ ctx: some ShareCanvas, _ spec: ShareSpecification, _ theme: ShareTheme, formats: ReportFormats = .active
  ) {
    ctx.fillStyle = .color(theme.surface)
    ctx.fillRect(0, 0, shareWidth, shareHeight)
    // The sky, as on the page: a wash over the title that has faded into
    // the ground by the time the chart starts. In high contrast it is the
    // ground.
    if theme.skyTop != theme.surface {
      let sky = ShareGradient(
        x0: 0, y0: 0, x1: 0, y1: plot.top + 120,
        stops: [(0, theme.skyTop), (0.45, theme.skyMid), (1, theme.surface)].map { ShareGradient.Stop(offset: $0.0, color: $0.1) })
      ctx.fillStyle = .linearGradient(sky)
      ctx.fillRect(0, 0, shareWidth, plot.top + 120)
    }
    drawHead(ctx, spec, theme)
    if spec.kind == .bars {
      drawBars(ctx, spec, theme)
    } else {
      drawSeries(ctx, spec, theme, formats)
    }
    drawFoot(ctx, theme)
  }
}
