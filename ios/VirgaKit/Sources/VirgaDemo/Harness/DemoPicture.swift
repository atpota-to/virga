// The demo's two pictures, read back from their addresses.
//
// The harness draws its people's faces and its posts' images as SVG data
// addresses (`World.avatarFor`: a square in the person's hue with their
// initial on it; `Views.placeholderImage`: a sky, a hill and a sun). A
// browser draws them; iOS's image decoders can't read SVG, so the app would
// show a plain letter disc or nothing. `DemoPicture.read` recognises exactly
// those two forms, as the makers write them, and says what is in one: its
// size, its background and the marks on it, for VirgaUI to draw with
// shapes and Text. Anything else, every real picture included, reads as
// nil and loads as it always has.

import Foundation
import VirgaCore

public struct DemoPicture: Hashable, Sendable {
  /// A point in the picture's own units (its viewBox).
  public struct Point: Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
      self.x = x
      self.y = y
    }
  }

  /// Something drawn over the background, in the order it's drawn.
  public enum Mark: Hashable, Sendable {
    /// `<text text-anchor="middle">` in `system-ui`: the words centred on
    /// `x`, their baseline at `baseline`, at `size` units and a CSS
    /// `weight` (100 to 900).
    case text(String, x: Double, baseline: Double, size: Double, weight: Double, fill: ThemeColor)
    /// A path of straight lines, closed and filled.
    case polygon([Point], fill: ThemeColor)
    case circle(center: Point, radius: Double, fill: ThemeColor)
  }

  /// The viewBox's size; its origin is 0 0.
  public var width: Double
  public var height: Double
  /// The rect that covers the whole viewBox.
  public var background: ThemeColor
  public var marks: [Mark]

  public init(width: Double, height: Double, background: ThemeColor, marks: [Mark]) {
    self.width = width
    self.height = height
    self.background = background
    self.marks = marks
  }

  static let prefix = "data:image/svg+xml,"

  /// The picture a demo address holds, or nil for any other address.
  ///
  /// The SVG has to be written exactly as the makers write it (the same
  /// elements in the same order, the same attributes, spaced the same way),
  /// with only the numbers, the `hsl()` colours and the initial free. An
  /// initial that SVG would trim or that needs an entity (whitespace, `&`)
  /// reads as nil.
  public static func read(_ src: String) -> DemoPicture? {
    guard src.utf8.starts(with: prefix.utf8),
      let svg = try? JSURI.decodeURIComponent(String(decoding: src.utf8.dropFirst(prefix.utf8.count), as: UTF8.self))
    else { return nil }
    var c = Cursor(Array(svg.utf8))
    guard c.take("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 "),
      let width = c.number(), c.take(" "), let height = c.number(), width > 0, height > 0,
      c.take("\"><rect width=\""), c.number() == width, c.take("\" height=\""), c.number() == height,
      c.take("\" fill=\""), let background = c.color(), c.take("\"/>")
    else { return nil }
    let marks: [Mark]
    if let text = c.text() {
      marks = [text]
    } else if let polygon = c.polygon(), let circle = c.circle() {
      marks = [polygon, circle]
    } else {
      return nil
    }
    guard c.take("</svg>"), c.atEnd else { return nil }
    return DemoPicture(width: width, height: height, background: background, marks: marks)
  }
}

/// A reader over the SVG's UTF-8, which takes what it was asked for or
/// leaves its place as it was.
private struct Cursor {
  let bytes: [UInt8]
  var at = 0

  init(_ bytes: [UInt8]) {
    self.bytes = bytes
  }

  var atEnd: Bool { at == bytes.count }

  mutating func take(_ literal: String) -> Bool {
    let wanted = Array(literal.utf8)
    guard bytes.count - at >= wanted.count, bytes[at..<at + wanted.count].elementsEqual(wanted) else { return false }
    at += wanted.count
    return true
  }

  /// A plain number: digits with a point among them, a minus before.
  mutating func number() -> Double? {
    var end = at
    if end < bytes.count, bytes[end] == 0x2D { end += 1 }
    let digits = end
    while end < bytes.count, (0x30...0x39).contains(bytes[end]) || bytes[end] == 0x2E { end += 1 }
    guard end > digits, let n = Double(String(decoding: bytes[at..<end], as: UTF8.self)), n.isFinite else { return nil }
    at = end
    return n
  }

  /// Everything up to `stop`, which has to come.
  mutating func until(_ stop: UInt8) -> String? {
    guard let end = bytes[at...].firstIndex(of: stop) else { return nil }
    let text = String(decoding: bytes[at..<end], as: UTF8.self)
    at = end
    return text
  }

  /// An `hsl()` colour, as a browser computes it, up to the closing quote.
  mutating func color() -> ThemeColor? {
    let start = at
    guard let text = until(0x22), text.hasPrefix("hsl("), let color = ThemeColor(css: text) else {
      at = start
      return nil
    }
    return color
  }

  /// What an initial can't hold: `&` (an entity, which isn't read here) and
  /// XML's whitespace (which SVG trims and folds).
  static let notPlain: Set<UInt8> = [0x26, 0x20, 0x09, 0x0A, 0x0D]

  /// `avatarFor`'s initial.
  mutating func text() -> DemoPicture.Mark? {
    let start = at
    guard take("<text x=\""), let x = number(), take("\" y=\""), let y = number(),
      take("\" font-family=\"system-ui,sans-serif\" font-size=\""), let size = number(), size > 0,
      take("\" font-weight=\""), let weight = number(),
      take("\" text-anchor=\"middle\" fill=\""), let fill = color(), take("\">"),
      let words = until(0x3C), !words.utf8.contains(where: Self.notPlain.contains),
      take("</text>")
    else {
      at = start
      return nil
    }
    return .text(words, x: x, baseline: y, size: size, weight: weight, fill: fill)
  }

  /// `placeholderImage`'s hill: `M x y`, then `L x y` for each corner, then `Z`.
  mutating func polygon() -> DemoPicture.Mark? {
    let start = at
    guard take("<path d=\"M"), let first = point() else {
      at = start
      return nil
    }
    var points = [first]
    while take(" L") {
      guard let next = point() else {
        at = start
        return nil
      }
      points.append(next)
    }
    guard take(" Z\" fill=\""), let fill = color(), take("\"/>") else {
      at = start
      return nil
    }
    return .polygon(points, fill: fill)
  }

  /// `placeholderImage`'s sun.
  mutating func circle() -> DemoPicture.Mark? {
    let start = at
    guard take("<circle cx=\""), let cx = number(), take("\" cy=\""), let cy = number(),
      take("\" r=\""), let r = number(), r >= 0,
      take("\" fill=\""), let fill = color(), take("\"/>")
    else {
      at = start
      return nil
    }
    return .circle(center: DemoPicture.Point(x: cx, y: cy), radius: r, fill: fill)
  }

  private mutating func point() -> DemoPicture.Point? {
    guard let x = number(), take(" "), let y = number() else { return nil }
    return DemoPicture.Point(x: x, y: y)
  }
}
