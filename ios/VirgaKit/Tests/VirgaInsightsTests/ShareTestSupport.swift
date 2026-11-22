// Reading a share spec back from a fixture, and a canvas that records the
// calls drawShareImage makes as ios/parity/cases/_share.js records the
// web's: properties set and calls in order, text measured by the same rule.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

/// A point of a spec's series as a fixture holds it.
func sharePoint(_ p: JSONValue) -> SharePoint {
  SharePoint(t: p["t"]?.doubleValue ?? .nan, v: p["v"]?.doubleValue, total: p["total"]?.doubleValue, posts: p["posts"]?.doubleValue)
}

/// A spec as a fixture holds it (`format` by name).
func shareSpecification(_ json: JSONValue) -> ShareSpecification? {
  guard let kind = json["kind"]?.stringValue.flatMap(ShareSpecification.Kind.init(rawValue:)) else { return nil }
  let figure = json["figure"].flatMap { f -> ShareFigure? in
    guard let value = f["value"]?.stringValue else { return nil }
    return ShareFigure(value: value, label: f["label"]?.stringValue ?? "")
  }
  let marks = (json["marks"]?.arrayValue ?? []).map { m in
    SeriesMark(
      i: m["i"]?.intValue ?? 0, t: m["t"]?.doubleValue ?? .nan,
      kind: ChartMark.Kind(rawValue: m["kind"]?.stringValue ?? "") ?? .note,
      items: (m["items"]?.arrayValue ?? []).map {
        SeriesMark.Item(label: $0["label"]?.stringValue ?? "", kind: ChartMark.Kind(rawValue: $0["kind"]?.stringValue ?? "") ?? .note)
      })
  }
  return ShareSpecification(
    kind: kind, title: json["title"]?.stringValue ?? "", subtitle: json["subtitle"]?.stringValue ?? "", figure: figure,
    series: (json["series"]?.arrayValue ?? []).map(sharePoint), unit: AnalyticsUnit(json["unit"]?.stringValue),
    mode: json["mode"]?.stringValue ?? "bars", trend: json["trend"]?.arrayValue?.map(sharePoint),
    zeroBase: json["zeroBase"]?.boolValue ?? true,
    format: json["format"]?.stringValue == "fmtRate" ? .rate : .count, marks: marks, noun: json["noun"]?.stringValue ?? "",
    ghost: json["ghost"]?["v"]?.doubleValue,
    rows: (json["rows"]?.arrayValue ?? []).map {
      ShareBarRow(label: $0["label"]?.stringValue ?? "", value: $0["value"]?.doubleValue ?? .nan, display: $0["display"]?.stringValue ?? "")
    },
    measure: json["measure"]?.stringValue ?? "")
}

/// A colour as both recorders write it: `rgba(r,g,b,a)`, channels 0–255.
func canonical(_ c: ThemeColor) -> String {
  func channel(_ x: Double) -> String { String(Int((x * 255).rounded())) }
  return "rgba(\(channel(c.red)),\(channel(c.green)),\(channel(c.blue)),\(JSNumber.format(c.alpha)))"
}

/// A theme from a fixture's canonical colours.
func shareTheme(_ json: JSONValue) -> ShareTheme? {
  func c(_ key: String) -> ThemeColor? { json[key]?.stringValue.flatMap { ThemeColor(css: $0) } }
  guard let surface = c("surface"), let skyTop = c("skyTop"), let skyMid = c("skyMid"), let ink = c("ink"),
    let ink2 = c("ink2"), let muted = c("muted"), let line = c("line"), let grid = c("grid"), let chart1 = c("chart1"),
    let chart2 = c("chart2"), let area = c("area"), let track = c("track"), let accent = c("accent")
  else { return nil }
  return ShareTheme(
    surface: surface, skyTop: skyTop, skyMid: skyMid, ink: ink, ink2: ink2, muted: muted, line: line, grid: grid,
    chart1: chart1, chart2: chart2, area: area, track: track, accent: accent)
}

/// Records every call and property set, as `[name, ...args]` and
/// `["set", property, value]`; measures a UTF-16 unit as 0.55 of the size,
/// plus the letter spacing.
final class RecordingCanvas: ShareCanvas {
  var log: [JSONValue] = []

  func style(_ s: ShareStyle) -> JSONValue {
    switch s {
    case .color(let c): return .string(canonical(c))
    case .linearGradient(let g):
      return [
        "x0": .number(g.x0), "y0": .number(g.y0), "x1": .number(g.x1), "y1": .number(g.y1),
        "stops": .array(g.stops.map { [.number($0.offset), .string(canonical($0.color))] }),
      ]
    }
  }

  func set(_ name: String, _ value: JSONValue) { log.append([.string("set"), .string(name), value]) }
  func call(_ name: String, _ args: Double...) { log.append(.array([.string(name)] + args.map(JSONValue.number))) }

  var fillStyle: ShareStyle = .color(.transparent) { didSet { set("fillStyle", style(fillStyle)) } }
  var strokeStyle: ShareStyle = .color(.transparent) { didSet { set("strokeStyle", style(strokeStyle)) } }
  var font = ShareFont(weight: 400, size: 10) {
    didSet { set("font", [.number(Double(font.weight)), .number(font.size)]) }
  }
  var textAlign: ShareTextAlign = .left { didSet { set("textAlign", .string(textAlign.rawValue)) } }
  var textBaseline: ShareTextBaseline = .alphabetic { didSet { set("textBaseline", .string(textBaseline.rawValue)) } }
  var lineWidth: Double = 1 { didSet { set("lineWidth", .number(lineWidth)) } }
  var lineCap: ShareLineCap = .butt { didSet { set("lineCap", .string(lineCap.rawValue)) } }
  var lineJoin: ShareLineJoin = .miter { didSet { set("lineJoin", .string(lineJoin.rawValue)) } }
  var supportsLetterSpacing = true
  var letterSpacing: Double = 0 { didSet { set("letterSpacing", .number(letterSpacing)) } }

  func measureText(_ text: String) -> Double {
    let n = Double(text.utf16.count)
    return n * font.size * 0.55 + n * letterSpacing
  }

  func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) { call("fillRect", x, y, width, height) }
  func fillText(_ text: String, _ x: Double, _ y: Double) {
    log.append([.string("fillText"), .string(text), .number(x), .number(y)])
  }
  func save() { call("save") }
  func restore() { call("restore") }
  func translate(_ x: Double, _ y: Double) { call("translate", x, y) }
  func scale(_ x: Double, _ y: Double) { call("scale", x, y) }
  func beginPath() { call("beginPath") }
  func moveTo(_ x: Double, _ y: Double) { call("moveTo", x, y) }
  func lineTo(_ x: Double, _ y: Double) { call("lineTo", x, y) }
  func arc(_ x: Double, _ y: Double, _ radius: Double, _ startAngle: Double, _ endAngle: Double) {
    call("arc", x, y, radius, startAngle, endAngle)
  }
  func arcTo(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ radius: Double) { call("arcTo", x1, y1, x2, y2, radius) }
  func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) { call("rect", x, y, width, height) }
  func closePath() { call("closePath") }
  func fill() { call("fill") }
  func stroke() { call("stroke") }
  func clip() { call("clip") }
  func setLineDash(_ segments: [Double]) { log.append([.string("setLineDash"), .array(segments.map(JSONValue.number))]) }

  /// The log as `JSON.stringify` writes it, for its SHA-256.
  var text: String {
    func write(_ v: JSONValue) -> String {
      switch v {
      case .null: return "null"
      case .bool(let b): return b ? "true" : "false"
      case .number(let n): return n.isFinite ? JSNumber.format(n == 0 ? 0 : n) : "null"
      case .string(let s): return s.jsJSONQuoted
      case .array(let items): return "[" + items.map(write).joined(separator: ",") + "]"
      case .object(let members):
        // Gradients, in the order the web's recorder builds them.
        let order = ["x0", "y0", "x1", "y1", "stops"]
        return "{" + order.compactMap { k in members[k].map { "\(k.jsJSONQuoted):\(write($0))" } }.joined(separator: ",") + "}"
      }
    }
    return write(.array(log))
  }
}
