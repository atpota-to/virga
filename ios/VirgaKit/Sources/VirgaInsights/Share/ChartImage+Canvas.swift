// Ports src/share/chartImage.js
//
// What the share picture is drawn on: the canvas calls drawShareImage
// makes (the 2D canvas API's, by the same names), and the values they take.
// VirgaUI's canvas carries them out with SwiftUI's GraphicsContext and
// measures text in the app's typeface; a test canvas records them.

import Foundation
import VirgaCore

/// A rectangle in the picture's pixels.
public struct ShareBox: Hashable, Sendable {
  public var left: Double
  public var right: Double
  public var top: Double
  public var bottom: Double

  public init(left: Double, right: Double, top: Double, bottom: Double) {
    self.left = left
    self.right = right
    self.top = top
    self.bottom = bottom
  }
}

/// `seriesLayout`: the y scale and where each bucket sits in `box`.
public struct SeriesLayout: Hashable, Sendable {
  public var n: Int
  public var min: Double
  public var max: Double
  /// Each bucket's share of the width.
  public var slot: Double
  /// The box the series sits in (narrowed for a ghost's gutter).
  public var box: ShareBox
  /// `max - min`, at least 1e-9.
  public var span: Double
  public var barWidth: Double
  public var ticks: [Double]
  public var labelled: [Double]

  /// The middle of bucket `i`.
  public func x(_ i: Int) -> Double { box.left + slot * (Double(i) + 0.5) }

  /// Where value `v` sits.
  public func y(_ v: Double) -> Double { box.bottom - ((v - min) / span) * (box.bottom - box.top) }
}

/// A date under the chart: which bucket, its words, how it hangs.
public struct AxisLabel: Hashable, Sendable {
  public var at: Int
  public var text: String
  public var align: ShareTextAlign
}

/// The page's colours the picture is drawn in (`readShareTheme`).
public struct ShareTheme: Hashable, Sendable {
  public var surface: ThemeColor
  public var skyTop: ThemeColor
  public var skyMid: ThemeColor
  public var ink: ThemeColor
  public var ink2: ThemeColor
  public var muted: ThemeColor
  public var line: ThemeColor
  public var grid: ThemeColor
  public var chart1: ThemeColor
  public var chart2: ThemeColor
  public var area: ThemeColor
  public var track: ThemeColor
  public var accent: ThemeColor

  public init(
    surface: ThemeColor, skyTop: ThemeColor, skyMid: ThemeColor, ink: ThemeColor, ink2: ThemeColor, muted: ThemeColor,
    line: ThemeColor, grid: ThemeColor, chart1: ThemeColor, chart2: ThemeColor, area: ThemeColor, track: ThemeColor,
    accent: ThemeColor
  ) {
    self.surface = surface
    self.skyTop = skyTop
    self.skyMid = skyMid
    self.ink = ink
    self.ink2 = ink2
    self.muted = muted
    self.line = line
    self.grid = grid
    self.chart1 = chart1
    self.chart2 = chart2
    self.area = area
    self.track = track
    self.accent = accent
  }

  /// The colours by the web's names.
  public var named: [(String, ThemeColor)] {
    [
      ("surface", surface), ("skyTop", skyTop), ("skyMid", skyMid), ("ink", ink), ("ink2", ink2), ("muted", muted),
      ("line", line), ("grid", grid), ("chart1", chart1), ("chart2", chart2), ("area", area), ("track", track),
      ("accent", accent),
    ]
  }
}

/// A linear gradient from (x0, y0) to (x1, y1).
public struct ShareGradient: Hashable, Sendable {
  public struct Stop: Hashable, Sendable {
    public var offset: Double
    public var color: ThemeColor
  }

  public var x0: Double
  public var y0: Double
  public var x1: Double
  public var y1: Double
  public var stops: [Stop]
}

/// What fills or strokes: a colour or a gradient.
public enum ShareStyle: Hashable, Sendable {
  case color(ThemeColor)
  case linearGradient(ShareGradient)
}

/// The font a canvas sets text in: a weight and a size in pixels, in
/// ChartImage.fontFamily.
public struct ShareFont: Hashable, Sendable {
  public var weight: Int
  public var size: Double
}

public enum ShareTextAlign: String, Hashable, Sendable {
  case left, center, right
}

public enum ShareTextBaseline: String, Hashable, Sendable {
  case alphabetic, middle
}

public enum ShareLineCap: String, Hashable, Sendable {
  case butt, round
}

public enum ShareLineJoin: String, Hashable, Sendable {
  case miter, round
}

/// A 2D canvas as drawShareImage uses one: state that the next call reads
/// (as a canvas context's properties are), paths built up and filled or
/// stroked, a clip, a transform, and text measured in the current font.
/// Angles are radians, measured clockwise from the x axis in the canvas's
/// y-down space, as the canvas API's are.
public protocol ShareCanvas: AnyObject {
  var fillStyle: ShareStyle { get set }
  var strokeStyle: ShareStyle { get set }
  var font: ShareFont { get set }
  var textAlign: ShareTextAlign { get set }
  var textBaseline: ShareTextBaseline { get set }
  var lineWidth: Double { get set }
  var lineCap: ShareLineCap { get set }
  var lineJoin: ShareLineJoin { get set }
  /// Whether the canvas can space letters (`'letterSpacing' in ctx`).
  var supportsLetterSpacing: Bool { get }
  /// Extra space between letters, in pixels.
  var letterSpacing: Double { get set }

  /// The width of `text` in the current font and letter spacing.
  func measureText(_ text: String) -> Double
  func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double)
  func fillText(_ text: String, _ x: Double, _ y: Double)
  func save()
  func restore()
  func translate(_ x: Double, _ y: Double)
  func scale(_ x: Double, _ y: Double)
  func beginPath()
  func moveTo(_ x: Double, _ y: Double)
  func lineTo(_ x: Double, _ y: Double)
  func arc(_ x: Double, _ y: Double, _ radius: Double, _ startAngle: Double, _ endAngle: Double)
  func arcTo(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ radius: Double)
  func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double)
  func closePath()
  func fill()
  func stroke()
  func clip()
  func setLineDash(_ segments: [Double])
}
