// The share picture (ios/parity/cases/insights.chartImage.js): the page's
// colours in every sky, theme, contrast and a few accents, where a series
// sits in the plot, the dates under it, text cut to fit, and every canvas
// call drawShareImage makes, held to the web's call for call.

import Foundation
import Testing
import VirgaArchive
import VirgaCore
import VirgaTestSupport
@testable import VirgaInsights

@Suite struct ChartImageParity {
  let fixture = "insights.chartImage"

  func specs() throws -> [String: ShareSpecification] {
    var out: [String: ShareSpecification] = [:]
    for c in try Parity.cases(fixture, fn: "spec") {
      if let spec = shareSpecification(c.compactOutput) { out[c.id] = spec }
    }
    return out
  }

  @Test func constants() throws {
    let c = try Parity.cases(fixture, fn: "constants")[0]
    expectOutput(["SHARE_WIDTH": .number(ChartImage.shareWidth), "SHARE_HEIGHT": .number(ChartImage.shareHeight)], c, strictNulls: true)
  }

  @Test func readShareTheme() throws {
    for c in try Parity.cases(fixture, fn: "readShareTheme") {
      guard let sky = c["sky"].stringValue.flatMap(SkyPhase.init(rawValue:)),
        let theme = c["theme"].stringValue.flatMap(Theme.init(rawValue:)),
        let contrast = c["contrast"].stringValue.flatMap(Contrast.init(rawValue:)),
        let accent = c["accent"].stringValue.flatMap(Preferences.Accent.init(rawValue:)),
        let density = c["density"].stringValue.flatMap(Preferences.Density.init(rawValue:))
      else {
        Issue.record("\(c): attributes don't read")
        continue
      }
      let resolved = ThemeTokens.resolve(
        RootAttributes(sky: sky, theme: theme, accent: accent, contrast: contrast, density: density), viewportWidth: 1280)
      let share = ChartImage.readShareTheme(resolved)
      expectOutput(.object(Dictionary(uniqueKeysWithValues: share.named.map { ($0.0, .string(canonical($0.1))) })), c, strictNulls: true)
    }
  }

  @Test func seriesLayout() throws {
    let all = try specs()
    for c in try Parity.cases(fixture, fn: "seriesLayout") {
      guard let spec = all[c["spec"].stringValue ?? ""] else {
        Issue.record("\(c): no spec")
        continue
      }
      let box = c.input["box"].map { b in
        ShareBox(left: b["left"]!.doubleValue!, right: b["right"]!.doubleValue!, top: b["top"]!.doubleValue!, bottom: b["bottom"]!.doubleValue!)
      }
      let L = box.map { ChartImage.seriesLayout(spec, $0) } ?? ChartImage.seriesLayout(spec)
      let probes = [L.min, L.max, 0] + L.ticks + spec.series.map { $0.v ?? 0 } + (spec.ghost.map { [$0] } ?? [])
      let actual: JSONValue = [
        "n": .number(Double(L.n)), "min": .number(L.min), "max": .number(L.max), "slot": .number(L.slot),
        "barWidth": .number(L.barWidth), "ticks": .array(L.ticks.map(JSONValue.number)),
        "labelled": .array(L.labelled.map(JSONValue.number)), "xs": .array((0..<L.n).map { .number(L.x($0)) }),
        "ys": .array(probes.map { .number(L.y($0)) }),
      ]
      expectReport(actual, c)
    }
  }

  @Test func axisLabels() throws {
    for c in try Parity.cases(fixture, fn: "axisLabels") {
      let series = (c["series"].arrayValue ?? []).map(sharePoint)
      let labels = ChartImage.axisLabels(series, AnalyticsUnit(c["unit"].stringValue), locale: c.locale, timeZone: c.zone)
      expectOutput(.array(labels.map { ["at": .number(Double($0.at)), "text": .string($0.text), "align": .string($0.align.rawValue)] }), c)
    }
  }

  @Test func fitText() throws {
    for c in try Parity.cases(fixture, fn: "fitText") {
      let ctx = RecordingCanvas()
      ctx.font = ShareFont(weight: 400, size: c["size"].doubleValue ?? 10)
      ctx.letterSpacing = c["spacing"].doubleValue ?? 0
      expectOutput(.string(ChartImage.fitText(ctx, c["text"].stringValue ?? "", c["width"].doubleValue ?? 0)), c)
    }
  }

  @Test func drawShareImage() throws {
    let all = try specs()
    var themes: [String: ShareTheme] = [:]
    for c in try Parity.cases(fixture, fn: "theme") { themes[c.id] = shareTheme(c.output) }
    for c in try Parity.cases(fixture, fn: "drawShareImage") {
      guard let spec = all[c["spec"].stringValue ?? ""], let theme = themes[c["theme"].stringValue ?? ""] else {
        Issue.record("\(c): no spec or theme")
        continue
      }
      let ctx = RecordingCanvas()
      ChartImage.drawShareImage(ctx, spec, theme, formats: c.formats)
      let expected = c.compactOutput
      #expect(Double(ctx.log.count) == expected["length"]?.doubleValue, "\(c): \(ctx.log.count) calls")
      if let log = expected["log"] {
        let d = exactDiff(.array(ctx.log), log)
        #expect(d == nil, "\(c): \(d ?? "")")
        continue
      }
      // A long recording: its ends call for call, then all of it by hash.
      let head = exactDiff(.array(Array(ctx.log.prefix(60))), expected["head"] ?? .null)
      #expect(head == nil, "\(c) head: \(head ?? "")")
      let tail = exactDiff(.array(Array(ctx.log.suffix(60))), expected["tail"] ?? .null)
      #expect(tail == nil, "\(c) tail: \(tail ?? "")")
      let hash = SHA256.hash(ctx.text).map { String(format: "%02x", $0) }.joined()
      #expect(hash == expected["sha256"]?.stringValue, "\(c): the whole recording")
    }
  }

  /// A drawing the web gives up on part way (a line with no buckets, whose
  /// last point it reads): the same calls up to there, none after, and no
  /// picture, where the web throws.
  @Test func drawShareImagePartly() throws {
    let all = try specs()
    var themes: [String: ShareTheme] = [:]
    for c in try Parity.cases(fixture, fn: "theme") { themes[c.id] = shareTheme(c.output) }
    let cases = try Parity.cases(fixture, fn: "drawShareImagePartly")
    #expect(!cases.isEmpty)
    for c in cases {
      guard let spec = all[c["spec"].stringValue ?? ""], let theme = themes[c["theme"].stringValue ?? ""] else {
        Issue.record("\(c): no spec or theme")
        continue
      }
      let ctx = RecordingCanvas()
      let finished = ChartImage.drawShareImage(ctx, spec, theme, formats: c.formats)
      let expected = c.compactOutput
      #expect(finished == (expected["threw"] == .null), "\(c): finished \(finished), the web threw \(expected["threw"] ?? .null)")
      // The web's x for the last of no buckets is infinite, written as null.
      let d = exactDiff(recorded(.array(ctx.log)), expected["log"] ?? .null)
      #expect(d == nil, "\(c): \(d ?? "")")
    }
  }
}
