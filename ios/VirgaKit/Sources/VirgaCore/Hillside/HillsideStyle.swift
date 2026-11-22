// Ports src/hillside/hillside.css (its numbers)
//
// What hillside.css says, as data for VirgaUI to draw with: the flat
// picture of the same sky and field that shows until the scene's first
// picture is up (and wherever it can't be drawn), one gradient a sky with
// its stops placed about the crest; how the canvas comes in (it fades in,
// then the focus moves to the page as the canvas blurs, a little bigger
// than its box so the blur has no soft edges); and the live sky's band (a
// scene 1,100 tall with its crest near the foot, drained of colour and
// pushed to black and white, faded out downwards as the wash fades, laid
// over the wash with `screen`, turned down at night). Held to the
// stylesheet by ios/parity/cases/hillside.style.js.

import Foundation

public enum HillsideStyle {
  /// A stop of the flat picture: its colour at `crest × crestScale + offset`
  /// of the box's height (all fractions of it).
  public struct FlatStop: Hashable, Sendable {
    public var color: HillsideColor
    public var crestScale: Double
    public var offset: Double

    public init(_ hex: String, crest: Double, offset: Double) {
      color = HillsideColor(hex: hex)
      crestScale = crest
      self.offset = offset
    }

    /// Where it sits for a crest at `crest` of the height.
    public func position(crest: Double) -> Double { crest * crestScale + offset }
  }

  /// `--crest` when the page sets none.
  public static let defaultCrest = 0.5

  /// `.hillside`'s background, by sky.
  public static func flatStops(_ phase: SkyPhase) -> [FlatStop] {
    let colors: [String]
    switch phase {
    case .day: colors = ["#1c54cc", "#3a7fe2", "#8bbaf0", "#d4e7f8", "#94d43c", "#4fa624", "#236617"]
    case .dawn: colors = ["#3b5aa8", "#7890cf", "#e7b7a6", "#ffd59e", "#9cb04a", "#557c2c", "#22431e"]
    case .dusk: colors = ["#262a66", "#5d4a8f", "#c9796b", "#ffb070", "#7c8440", "#3c5429", "#172b1e"]
    case .night: colors = ["#050a1d", "#0c1838", "#182c55", "#2a4470", "#24463a", "#143026", "#081712"]
    }
    let places: [(crest: Double, offset: Double)] = [(0, 0), (0.5, 0), (1, -0.06), (1, -0.005), (1, 0), (1, 0.1), (0, 1)]
    return zip(colors, places).map { FlatStop($0, crest: $1.crest, offset: $1.offset) }
  }

  /// The flat picture for a crest at `crest` of the height, as a browser
  /// lays the gradient out: a stop placed before an earlier one moves up
  /// to it, and the stops are cut to the box (0 to 1), a stop past an edge
  /// leaving the colour it gives at the edge.
  public static func flatGradient(_ phase: SkyPhase, crest: Double) -> [(color: HillsideColor, at: Double)] {
    var placed: [(color: HillsideColor, at: Double)] = []
    var furthest = -Double.infinity
    for stop in flatStops(phase) {
      furthest = max(furthest, stop.position(crest: crest))
      placed.append((stop.color, furthest))
    }
    func colour(at y: Double) -> HillsideColor {
      guard let first = placed.first, let last = placed.last else { return .white }
      if y <= first.at { return first.color }
      if y >= last.at { return last.color }
      for (a, b) in zip(placed, placed.dropFirst()) where y >= a.at && y <= b.at {
        return b.at > a.at ? a.color.lerp(b.color, (y - a.at) / (b.at - a.at)) : b.color
      }
      return last.color
    }
    var out: [(color: HillsideColor, at: Double)] = [(colour(at: 0), 0)]
    for stop in placed where stop.at > 0 && stop.at < 1 { out.append(stop) }
    out.append((colour(at: 1), 1))
    return out
  }

  // MARK: The canvas

  /// `--hill-blur` when the page sets none, in points.
  public static let hillBlur: Double = 6
  /// `--bleed`: how far past each edge the canvas runs, in blurs.
  public static let bleedPerBlur = 2.5
  /// The canvas fades in over this once the first picture is up (`ease`).
  public static let fadeIn = 0.9
  /// Then the focus moves to the page: the blur comes in over this, after
  /// `focusDelay` (`ease`). Neither moves with reduced motion.
  public static let focusDuration = 1.6
  public static let focusDelay = 0.6

  /// What a hillside `width` × `height` points draws into: a canvas
  /// `bleed` bigger at each edge (so a blur has no soft edges), and the
  /// crest, set `crest` points from the top of the hillside, in the
  /// canvas's own terms (Hillside.jsx's `fit`, in the DOM's whole pixels).
  public struct Canvas: Hashable, Sendable {
    public var width: Double
    public var height: Double
    public var crest: Double
    public var bleed: Double
  }

  public static func canvas(width: Double, height: Double, crest: Double, blur: Double = hillBlur) -> Canvas {
    let bleed = blur * bleedPerBlur
    let w = (width + bleed * 2).rounded()
    let h = (height + bleed * 2).rounded()
    return Canvas(width: w, height: h, crest: (crest.rounded() + bleed) / (h == 0 ? 1 : h), bleed: bleed)
  }

  // MARK: The live sky

  /// `.live-sky-scene`: the scene's height, and where its crest is.
  public static let liveSkySceneHeight: Double = 1100
  public static let liveSkyCrest = 0.96
  /// Its opacity, and at night (the dark theme).
  public static let liveSkyOpacity = 0.8
  public static let liveSkyOpacityAtNight = 0.45
  /// `filter: grayscale(1) brightness(0.62) contrast(2.4)`.
  public static let liveSkyGrayscale: Double = 1
  public static let liveSkyBrightness = 0.62
  public static let liveSkyContrast = 2.4
  /// The mask's alpha at the top, at `--sky-mid-at` and at `--sky-end`.
  public static let liveSkyMask: [Double] = [1, 0.6, 0]

  /// The live sky's canvas across a band `width` wide: the scene's, with
  /// its crest near the foot.
  public static func liveSkyCanvas(width: Double) -> Canvas {
    canvas(width: width, height: liveSkySceneHeight, crest: liveSkySceneHeight * liveSkyCrest)
  }
}
