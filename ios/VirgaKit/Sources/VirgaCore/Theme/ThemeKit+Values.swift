// Ports src/styles/controls.css
// Ports src/styles/base.css
// Ports src/styles/app.css
//
// The shapes of the kit's measures (ThemeKit, ThemeTokens+Kit.swift): a box
// of four lengths (padding, margin, a radius per corner), a gap, a border,
// transitions, an animation and a linear gradient, each as the stylesheet
// writes it, with var() left for the theme to fill in
// (`ResolvedTheme.resolve`). Each encodes to the JSON _css.js's
// parseKitValue writes, so ui.themeKit holds them to the sheets.

import Foundation

/// `padding: 0 16px` and the like, spread to four sides as CSS spreads one
/// to four values (top, right, bottom, left; a radius: top-left, top-right,
/// bottom-right, bottom-left).
public struct ThemeBox: Codable, Hashable, Sendable {
  public var top: ThemeLength
  public var right: ThemeLength
  public var bottom: ThemeLength
  public var left: ThemeLength

  public init(top: ThemeLength, right: ThemeLength, bottom: ThemeLength, left: ThemeLength) {
    self.top = top
    self.right = right
    self.bottom = bottom
    self.left = left
  }
}

/// `gap: 12px 32px`: between rows, then between columns.
public struct ThemeGap: Codable, Hashable, Sendable {
  public var row: ThemeLength
  public var column: ThemeLength

  public init(row: ThemeLength, column: ThemeLength) {
    self.row = row
    self.column = column
  }
}

/// `border: 1px solid var(--line-2)` (or an outline).
public struct ThemeBorder: Codable, Hashable, Sendable {
  public var width: ThemeLength?
  public var style: String?
  public var color: ThemeValue?

  public init(width: ThemeLength?, style: String?, color: ThemeValue?) {
    self.width = width
    self.style = style
    self.color = color
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(width, forKey: .width)
    try c.encode(style, forKey: .style)
    try c.encode(color, forKey: .color)
  }
}

/// One transition: what changes, over how long (seconds), on which curve
/// (a keyword, cubic-bezier() or var(--ease)), after what delay.
public struct ThemeTransition: Codable, Hashable, Sendable {
  public var property: String
  public var duration: Double
  public var easing: ThemeValue
  public var delay: Double

  public init(property: String, duration: Double, easing: ThemeValue, delay: Double = 0) {
    self.property = property
    self.duration = duration
    self.easing = easing
    self.delay = delay
  }
}

/// An animation: its keyframes' name, duration and delay (seconds), curve,
/// how many times (`infinite` for ever) and how it fills.
public struct ThemeAnimation: Codable, Hashable, Sendable {
  public var name: String
  public var duration: Double
  public var easing: ThemeValue
  public var delay: Double
  public var iterations: Double
  public var infinite: Bool
  public var fill: String

  public init(
    name: String,
    duration: Double,
    easing: ThemeValue,
    delay: Double = 0,
    iterations: Double = 1,
    infinite: Bool = false,
    fill: String = "none"
  ) {
    self.name = name
    self.duration = duration
    self.easing = easing
    self.delay = delay
    self.iterations = iterations
    self.infinite = infinite
    self.fill = fill
  }
}

/// A colour stop: a colour, and where it is (nil: spread evenly, as CSS does).
public struct ThemeGradientStop: Codable, Hashable, Sendable {
  public var color: ThemeValue
  public var position: ThemeLength?

  public init(color: ThemeValue, position: ThemeLength?) {
    self.color = color
    self.position = position
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(color, forKey: .color)
    try c.encode(position, forKey: .position)
  }
}

/// `linear-gradient(angle, stops…)`. The angle is CSS's: 0 points up, 90
/// right, 180 (the default) down.
public struct ThemeGradient: Codable, Hashable, Sendable {
  public var angle: Double
  public var stops: [ThemeGradientStop]

  public init(angle: Double = 180, stops: [ThemeGradientStop]) {
    self.angle = angle
    self.stops = stops
  }
}

/// A kit measure of any kind, as the parity fixture records it.
public enum ThemeKitValue: Hashable, Sendable, Encodable {
  case length(ThemeLength)
  case box(ThemeBox)
  case gap(ThemeGap)
  case number(Double)
  case time(Double)
  /// A colour, a var(), a color-mix(), or (kind "value") any token value.
  case value(ThemeValue)
  case shadow([ThemeShadowLayer])
  case border(ThemeBorder)
  case transitions([ThemeTransition])
  case animation(ThemeAnimation)
  case gradient(ThemeGradient)
  case keyword(String)

  private struct Key: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  public func encode(to encoder: Encoder) throws {
    switch self {
    case .value(let v):
      try v.encode(to: encoder)
    case .length(let l):
      try ThemeValue.length(l).encode(to: encoder)
    case .shadow(let layers):
      try ThemeValue.shadow(layers).encode(to: encoder)
    case .keyword(let k):
      try ThemeValue.keyword(k).encode(to: encoder)
    case .box(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("box"))
    case .gap(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("gap"))
    case .number(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("number"))
    case .time(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("time"))
    case .border(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("border"))
    case .transitions(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("transitions"))
    case .animation(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("animation"))
    case .gradient(let v):
      var c = encoder.container(keyedBy: Key.self)
      try c.encode(v, forKey: Key("gradient"))
    }
  }
}

/// Where a kit measure comes from: the declaration in the stylesheet.
public struct ThemeKitEntry: Hashable, Sendable {
  /// Its name in ThemeKit.
  public var name: String
  public var file: String
  public var selector: String
  /// The media query the rule sits in, or nil.
  public var media: String?
  public var property: String
  /// How the declaration is read (_themeKit.js): length, box, gap, number,
  /// time, color, value, shadow, border, transitions, animation, gradient
  /// or keyword.
  public var kind: String
  /// The value as the stylesheet writes it.
  public var css: String
  public var important: Bool
  public var value: ThemeKitValue

  public init(
    _ name: String,
    file: String,
    selector: String,
    media: String? = nil,
    property: String,
    kind: String,
    css: String,
    important: Bool = false,
    value: ThemeKitValue
  ) {
    self.name = name
    self.file = file
    self.selector = selector
    self.media = media
    self.property = property
    self.kind = kind
    self.css = css
    self.important = important
    self.value = value
  }
}
