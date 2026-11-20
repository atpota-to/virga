// Ports src/styles/theme.css
//
// The values a design token can hold, as the stylesheet writes them and as a
// browser computes them: a colour (RGBA, each channel 0 to 1), a length
// expression (px, rem, em, ch, vw, cqi, %, calc(), clamp(), min(), max()),
// a stack of shadows, a font stack, a cubic-bezier() and a keyword, any of
// them with var() of another token, and color-mix() in sRGB.
//
// Each encodes to the JSON ios/parity/cases/_css.js writes for it, so the
// parity fixtures (ui.theme, ui.themeKit) compare them directly:
//
//   ThemeColor   { red, green, blue, alpha }
//   ThemeValue   { color } | { system } | { var } | { colorMix } | { length } |
//                { shadow } | { fonts } | { cubicBezier } | { keyword }
//   ThemeLength  { value, unit } | { number } | { var } | { op, left, right } |
//                { fn, args }
//
// Lengths stay expressions until they are used, as a custom property does
// in a browser: 26cqi is a quarter of whatever container the figure sits in,
// and 54ch depends on the font. `points(in:)` works one out for a context.

import Foundation

// MARK: - Colour

/// A colour in sRGB, as a browser computes it: each channel and the alpha
/// from 0 to 1. SwiftUI takes these as they are
/// (`Color(.sRGB, red:green:blue:opacity:)`).
public struct ThemeColor: Codable, Hashable, Sendable, CustomStringConvertible {
  public var red: Double
  public var green: Double
  public var blue: Double
  public var alpha: Double

  public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
    self.red = red
    self.green = green
    self.blue = blue
    self.alpha = alpha
  }

  /// `#rrggbb`.
  public static func hex(_ rgb: UInt32) -> ThemeColor {
    ThemeColor(
      red: Double((rgb >> 16) & 0xFF) / 255,
      green: Double((rgb >> 8) & 0xFF) / 255,
      blue: Double(rgb & 0xFF) / 255,
      alpha: 1
    )
  }

  /// `rgb(r g b / alpha)`: channels from 0 to 255, clamped as a computed
  /// value is.
  public static func rgb(_ r: Double, _ g: Double, _ b: Double, _ alpha: Double = 1) -> ThemeColor {
    func unit(_ x: Double) -> Double { Swift.min(1, Swift.max(0, x)) }
    return ThemeColor(red: unit(r / 255), green: unit(g / 255), blue: unit(b / 255), alpha: unit(alpha))
  }

  /// `transparent`.
  public static let transparent = ThemeColor(red: 0, green: 0, blue: 0, alpha: 0)

  /// `#rrggbb` (or `#rrggbbaa` with any transparency), each channel rounded
  /// to the nearest byte.
  public var hexString: String {
    func byte(_ x: Double) -> String {
      let b = Int((Swift.min(1, Swift.max(0, x)) * 255).rounded())
      let digits = String(b, radix: 16)
      return digits.count == 1 ? "0" + digits : digits
    }
    return "#" + byte(red) + byte(green) + byte(blue) + (alpha < 1 ? byte(alpha) : "")
  }

  public var description: String { hexString }

  /// color-mix(in srgb, a p1, b p2) as CSS Color 5 computes it. A missing
  /// percentage is what the other leaves of 100% (50% each when both are
  /// missing); the pair is scaled to sum to 100%, and a sum short of 100%
  /// is kept as a multiplier on the alpha; the channels are mixed
  /// premultiplied by their alphas. Nil when both percentages are zero.
  public static func mix(_ a: ThemeColor, _ p1: Double?, _ b: ThemeColor, _ p2: Double?) -> ThemeColor? {
    let (w1, w2): (Double, Double)
    switch (p1, p2) {
    case (nil, nil): (w1, w2) = (50, 50)
    case (nil, let q?): (w1, w2) = (100 - q, q)
    case (let p?, nil): (w1, w2) = (p, 100 - p)
    case (let p?, let q?): (w1, w2) = (p, q)
    }
    let sum = w1 + w2
    if sum == 0 { return nil }
    let multiplier = sum < 100 ? sum / 100 : 1
    let f1 = w1 / sum
    let f2 = w2 / sum
    let alpha = a.alpha * f1 + b.alpha * f2
    func channel(_ x: Double, _ y: Double) -> Double {
      alpha == 0 ? 0 : (x * a.alpha * f1 + y * b.alpha * f2) / alpha
    }
    return ThemeColor(
      red: channel(a.red, b.red),
      green: channel(a.green, b.green),
      blue: channel(a.blue, b.blue),
      alpha: alpha * multiplier
    )
  }

  /// The colour as it lands on a ground: itself blended into the ground by
  /// its own transparency (the ground's alpha is kept).
  public func over(_ ground: ThemeColor) -> ThemeColor {
    func blend(_ top: Double, _ under: Double) -> Double { top * alpha + under * (1 - alpha) }
    return ThemeColor(
      red: blend(red, ground.red),
      green: blend(green, ground.green),
      blue: blend(blue, ground.blue),
      alpha: ground.alpha
    )
  }

  /// WCAG 2's relative luminance, of the colour as it is (alpha ignored).
  public var relativeLuminance: Double {
    func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
  }

  /// WCAG 2's contrast ratio of this colour, laid on `ground`, against it.
  public func contrastRatio(on ground: ThemeColor) -> Double {
    let a = over(ground).relativeLuminance
    let b = ground.relativeLuminance
    return (Swift.max(a, b) + 0.05) / (Swift.min(a, b) + 0.05)
  }
}

// MARK: - Length

/// The units the stylesheets write lengths in.
public enum ThemeUnit: String, Codable, CaseIterable, Hashable, Sendable {
  case px, rem, em, ch, vw, vh, svh, dvh, cqi
  case percent = "%"
}

/// An operator inside calc().
public enum ThemeLengthOperator: String, Codable, CaseIterable, Hashable, Sendable {
  case add = "+"
  case subtract = "-"
  case multiply = "*"
  case divide = "/"
}

/// A math function, or `group` for parentheses inside one.
public enum ThemeLengthFunction: String, Codable, CaseIterable, Hashable, Sendable {
  case calc, clamp, min, max, group
}

/// What a length is measured against where it is used.
public struct ThemeLengthContext: Hashable, Sendable {
  /// The viewport's width (vw), in points.
  public var viewportWidth: Double
  /// The width of the container a cqi length is in; the viewport's when
  /// there is none, as CSS falls back to.
  public var containerWidth: Double?
  /// The font size an em is (the element's own).
  public var fontSize: Double
  /// The root's font size, a rem: 16.
  public var rootFontSize: Double
  /// The width of "0" in the font in use, a ch. Without it a ch length has
  /// no value here.
  public var chWidth: Double?

  public init(
    viewportWidth: Double,
    containerWidth: Double? = nil,
    fontSize: Double = 16,
    rootFontSize: Double = 16,
    chWidth: Double? = nil
  ) {
    self.viewportWidth = viewportWidth
    self.containerWidth = containerWidth
    self.fontSize = fontSize
    self.rootFontSize = rootFontSize
    self.chWidth = chWidth
  }
}

/// A length as the stylesheet writes it: a dimension, a number (inside an
/// expression), var() of a token, an operation, or a math function.
public indirect enum ThemeLength: Hashable, Sendable {
  case value(Double, ThemeUnit)
  case number(Double)
  case variable(ThemeToken)
  case operation(ThemeLengthOperator, ThemeLength, ThemeLength)
  case function(ThemeLengthFunction, [ThemeLength])

  public static func px(_ v: Double) -> ThemeLength { .value(v, .px) }
  public static func rem(_ v: Double) -> ThemeLength { .value(v, .rem) }
  public static func em(_ v: Double) -> ThemeLength { .value(v, .em) }

  /// The length in points (CSS px), as a browser computes it at its use.
  /// Nil when it needs a measure the context doesn't give (ch without
  /// `chWidth`, a percentage, a viewport height), or still holds var().
  public func points(in context: ThemeLengthContext) -> Double? {
    switch self {
    case .number(let n):
      return n
    case .variable:
      return nil
    case .value(let v, let unit):
      switch unit {
      case .px: return v
      case .rem: return v * context.rootFontSize
      case .em: return v * context.fontSize
      case .vw: return v * context.viewportWidth / 100
      case .cqi: return v * (context.containerWidth ?? context.viewportWidth) / 100
      case .ch: return context.chWidth.map { v * $0 }
      case .vh, .svh, .dvh, .percent: return nil
      }
    case .operation(let op, let l, let r):
      guard let a = l.points(in: context), let b = r.points(in: context) else { return nil }
      switch op {
      case .add: return a + b
      case .subtract: return a - b
      case .multiply: return a * b
      case .divide: return a / b
      }
    case .function(let fn, let args):
      var values: [Double] = []
      for arg in args {
        guard let v = arg.points(in: context) else { return nil }
        values.append(v)
      }
      switch fn {
      case .calc, .group: return values.first
      case .min: return values.min()
      case .max: return values.max()
      case .clamp:
        // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)): MIN wins over MAX.
        guard values.count == 3 else { return nil }
        return Swift.max(values[0], Swift.min(values[1], values[2]))
      }
    }
  }

  /// The tokens this length mentions.
  public var variables: [ThemeToken] {
    switch self {
    case .variable(let t): return [t]
    case .value, .number: return []
    case .operation(_, let l, let r): return l.variables + r.variables
    case .function(_, let args): return args.flatMap(\.variables)
    }
  }
}

// MARK: - Values

/// color-mix(in srgb, first firstPercent, second secondPercent).
public struct ThemeColorMix: Codable, Hashable, Sendable {
  public var space: String
  public var first: ThemeValue
  public var firstPercent: Double?
  public var second: ThemeValue
  public var secondPercent: Double?

  public init(
    space: String = "srgb",
    first: ThemeValue,
    firstPercent: Double?,
    second: ThemeValue,
    secondPercent: Double?
  ) {
    self.space = space
    self.first = first
    self.firstPercent = firstPercent
    self.second = second
    self.secondPercent = secondPercent
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(space, forKey: .space)
    try c.encode(first, forKey: .first)
    try c.encode(firstPercent, forKey: .firstPercent)
    try c.encode(second, forKey: .second)
    try c.encode(secondPercent, forKey: .secondPercent)
  }
}

/// One layer of a box-shadow: `[inset] x y [blur [spread]] [colour]`.
public struct ThemeShadowLayer: Codable, Hashable, Sendable {
  public var inset: Bool
  public var x: ThemeLength
  public var y: ThemeLength
  public var blur: ThemeLength?
  public var spread: ThemeLength?
  /// The colour; the text's own (currentColor) when there is none.
  public var color: ThemeValue?

  public init(
    inset: Bool = false,
    x: ThemeLength,
    y: ThemeLength,
    blur: ThemeLength? = nil,
    spread: ThemeLength? = nil,
    color: ThemeValue? = nil
  ) {
    self.inset = inset
    self.x = x
    self.y = y
    self.blur = blur
    self.spread = spread
    self.color = color
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(inset, forKey: .inset)
    try c.encode(x, forKey: .x)
    try c.encode(y, forKey: .y)
    try c.encode(blur, forKey: .blur)
    try c.encode(spread, forKey: .spread)
    try c.encode(color, forKey: .color)
  }
}

/// cubic-bezier(x1, y1, x2, y2). SwiftUI: `.timingCurve(x1, y1, x2, y2, duration:)`.
public struct ThemeCubicBezier: Codable, Hashable, Sendable {
  public var x1: Double
  public var y1: Double
  public var x2: Double
  public var y2: Double

  public init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
    self.x1 = x1
    self.y1 = y1
    self.x2 = x2
    self.y2 = y2
  }

  /// The curve a CSS easing keyword names (`ease`, `linear`, `ease-in`,
  /// `ease-out`, `ease-in-out`), or nil.
  public static func keyword(_ name: String) -> ThemeCubicBezier? {
    switch name {
    case "ease": return ThemeCubicBezier(0.25, 0.1, 0.25, 1)
    case "linear": return ThemeCubicBezier(0, 0, 1, 1)
    case "ease-in": return ThemeCubicBezier(0.42, 0, 1, 1)
    case "ease-out": return ThemeCubicBezier(0, 0, 0.58, 1)
    case "ease-in-out": return ThemeCubicBezier(0.42, 0, 0.58, 1)
    default: return nil
    }
  }

  public init(from decoder: Decoder) throws {
    var c = try decoder.unkeyedContainer()
    self.init(
      try c.decode(Double.self), try c.decode(Double.self), try c.decode(Double.self), try c.decode(Double.self))
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.unkeyedContainer()
    try c.encode(x1)
    try c.encode(y1)
    try c.encode(x2)
    try c.encode(y2)
  }
}

/// A token's value, as declared (with var() and color-mix()) or as
/// computed (with neither: `ResolvedTheme`).
public indirect enum ThemeValue: Hashable, Sendable {
  case color(ThemeColor)
  /// A system colour of forced-colours mode (CanvasText, Highlight, …).
  case system(String)
  case variable(ThemeToken)
  case colorMix(ThemeColorMix)
  case length(ThemeLength)
  case shadow([ThemeShadowLayer])
  case fonts([String])
  case cubicBezier(ThemeCubicBezier)
  case keyword(String)

  public var colorValue: ThemeColor? {
    if case .color(let c) = self { return c }
    return nil
  }

  public var lengthValue: ThemeLength? {
    if case .length(let l) = self { return l }
    return nil
  }
}

// MARK: - Coding

private struct AnyKey: CodingKey {
  var stringValue: String
  var intValue: Int? { nil }
  init(_ s: String) { stringValue = s }
  init?(stringValue: String) { self.stringValue = stringValue }
  init?(intValue: Int) { nil }
}

extension ThemeToken {
  init(decoding name: String, codingPath: [CodingKey]) throws {
    guard let token = ThemeToken(rawValue: name) else {
      throw DecodingError.dataCorrupted(.init(codingPath: codingPath, debugDescription: "no token \(name)"))
    }
    self = token
  }
}

extension ThemeLength: Codable {
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: AnyKey.self)
    if c.contains(AnyKey("unit")) {
      let unitName = try c.decode(String.self, forKey: AnyKey("unit"))
      guard let unit = ThemeUnit(rawValue: unitName) else {
        throw DecodingError.dataCorruptedError(forKey: AnyKey("unit"), in: c, debugDescription: "no unit \(unitName)")
      }
      self = .value(try c.decode(Double.self, forKey: AnyKey("value")), unit)
    } else if c.contains(AnyKey("number")) {
      self = .number(try c.decode(Double.self, forKey: AnyKey("number")))
    } else if c.contains(AnyKey("var")) {
      self = .variable(try ThemeToken(decoding: c.decode(String.self, forKey: AnyKey("var")), codingPath: c.codingPath))
    } else if c.contains(AnyKey("op")) {
      let name = try c.decode(String.self, forKey: AnyKey("op"))
      guard let op = ThemeLengthOperator(rawValue: name) else {
        throw DecodingError.dataCorruptedError(forKey: AnyKey("op"), in: c, debugDescription: "no operator \(name)")
      }
      self = .operation(
        op, try c.decode(ThemeLength.self, forKey: AnyKey("left")), try c.decode(ThemeLength.self, forKey: AnyKey("right")))
    } else {
      let name = try c.decode(String.self, forKey: AnyKey("fn"))
      guard let fn = ThemeLengthFunction(rawValue: name) else {
        throw DecodingError.dataCorruptedError(forKey: AnyKey("fn"), in: c, debugDescription: "no function \(name)")
      }
      self = .function(fn, try c.decode([ThemeLength].self, forKey: AnyKey("args")))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: AnyKey.self)
    switch self {
    case .value(let v, let unit):
      try c.encode(v, forKey: AnyKey("value"))
      try c.encode(unit.rawValue, forKey: AnyKey("unit"))
    case .number(let n):
      try c.encode(n, forKey: AnyKey("number"))
    case .variable(let t):
      try c.encode(t.rawValue, forKey: AnyKey("var"))
    case .operation(let op, let l, let r):
      try c.encode(op.rawValue, forKey: AnyKey("op"))
      try c.encode(l, forKey: AnyKey("left"))
      try c.encode(r, forKey: AnyKey("right"))
    case .function(let fn, let args):
      try c.encode(fn.rawValue, forKey: AnyKey("fn"))
      try c.encode(args, forKey: AnyKey("args"))
    }
  }
}

extension ThemeValue: Codable {
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: AnyKey.self)
    guard let key = c.allKeys.first, c.allKeys.count == 1 else {
      throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: "a value has one key"))
    }
    switch key.stringValue {
    case "color": self = .color(try c.decode(ThemeColor.self, forKey: key))
    case "system": self = .system(try c.decode(String.self, forKey: key))
    case "var": self = .variable(try ThemeToken(decoding: c.decode(String.self, forKey: key), codingPath: c.codingPath))
    case "colorMix": self = .colorMix(try c.decode(ThemeColorMix.self, forKey: key))
    case "length": self = .length(try c.decode(ThemeLength.self, forKey: key))
    case "shadow": self = .shadow(try c.decode([ThemeShadowLayer].self, forKey: key))
    case "fonts": self = .fonts(try c.decode([String].self, forKey: key))
    case "cubicBezier": self = .cubicBezier(try c.decode(ThemeCubicBezier.self, forKey: key))
    case "keyword": self = .keyword(try c.decode(String.self, forKey: key))
    default:
      throw DecodingError.dataCorruptedError(forKey: key, in: c, debugDescription: "no value kind \(key.stringValue)")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: AnyKey.self)
    switch self {
    case .color(let v): try c.encode(v, forKey: AnyKey("color"))
    case .system(let v): try c.encode(v, forKey: AnyKey("system"))
    case .variable(let t): try c.encode(t.rawValue, forKey: AnyKey("var"))
    case .colorMix(let v): try c.encode(v, forKey: AnyKey("colorMix"))
    case .length(let v): try c.encode(v, forKey: AnyKey("length"))
    case .shadow(let v): try c.encode(v, forKey: AnyKey("shadow"))
    case .fonts(let v): try c.encode(v, forKey: AnyKey("fonts"))
    case .cubicBezier(let v): try c.encode(v, forKey: AnyKey("cubicBezier"))
    case .keyword(let v): try c.encode(v, forKey: AnyKey("keyword"))
    }
  }
}
