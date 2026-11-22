// Ports src/hillside/hillside.css and src/shell/bits.jsx (useSkyTaps) (their parity cases)

import Foundation
import Testing
import VirgaCore
import VirgaTestSupport

@Suite struct HillsideStyleParity {
  /// A channel as two hex digits.
  static func byte(_ channel: Double) -> String {
    let text = String(Int((channel * 255).rounded()), radix: 16)
    return text.count < 2 ? "0" + text : text
  }

  @Test func style() throws {
    let c = try Parity.cases("hillside.style", fn: "style")[0]
    var flat: [String: JSONValue] = [:]
    for phase in SkyPhase.allCases {
      flat[phase.rawValue] = .array(
        HillsideStyle.flatStops(phase).map { stop in
          let hex = "#" + [stop.color.r, stop.color.g, stop.color.b].map(Self.byte).joined()
          return ["color": .string(hex), "crest": .number(stop.crestScale), "offset": .number(stop.offset)]
        })
    }
    let canvas: JSONValue = [
      "hillBlur": .number(HillsideStyle.hillBlur), "bleedPerBlur": .number(HillsideStyle.bleedPerBlur),
      "fadeIn": .number(HillsideStyle.fadeIn), "focusDuration": .number(HillsideStyle.focusDuration),
      "focusDelay": .number(HillsideStyle.focusDelay),
    ]
    let live: JSONValue = [
      // The band is as tall as the wash (VirgaUI takes --sky-end from the theme), laid on it with screen.
      "height": .string("var(--sky-end)"), "blend": .string("screen"),
      "sceneHeight": .number(HillsideStyle.liveSkySceneHeight), "crest": .number(HillsideStyle.liveSkyCrest),
      "opacity": .number(HillsideStyle.liveSkyOpacity), "opacityAtNight": .number(HillsideStyle.liveSkyOpacityAtNight),
      "grayscale": .number(HillsideStyle.liveSkyGrayscale), "brightness": .number(HillsideStyle.liveSkyBrightness),
      "contrast": .number(HillsideStyle.liveSkyContrast), "mask": .array(HillsideStyle.liveSkyMask.map { .number($0) }),
    ]
    let actual: JSONValue = [
      "flat": .object(flat), "defaultCrest": .number(HillsideStyle.defaultCrest), "canvas": canvas, "liveSky": live,
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }

  @Test func skyTaps() throws {
    let c = try Parity.cases("hillside.style", fn: "skyTaps")[0]
    let actual: JSONValue = [
      "window": .number(SkyTaps.window), "needed": .number(Double(SkyTaps.needed)), "putAway": .string(SkyTaps.putAway),
      "out": .string(SkyTaps.out),
    ]
    let d = Parity.diff(actual, c.output)
    #expect(d == nil, "\(d ?? "")")
  }
}

/// Hillside.jsx's fit (lines 73–78): the canvas runs `--bleed` (the blur
/// times 2.5) past each edge, and the crest is measured on the page and
/// moved into the canvas's terms.
@Suite struct HillsideCanvasBehaviour {
  @Test func theLiveSkysCanvas() {
    let canvas = HillsideStyle.liveSkyCanvas(width: 390)
    #expect(canvas.width == 420)
    #expect(canvas.height == 1130)
    #expect(canvas.bleed == 15)
    let crest: Double = (1056 + 15) / 1130
    #expect(canvas.crest == crest)
  }

  @Test func aHillWithItsOwnBlur() {
    let canvas = HillsideStyle.canvas(width: 1024.4, height: 700, crest: 455.6, blur: 10)
    #expect(canvas.width == 1074)
    #expect(canvas.height == 750)
    let crest: Double = (456 + 25) / 750
    #expect(canvas.crest == crest)
  }
}

/// hillside.css's flat picture (lines 7–61) as a browser lays it out.
@Suite struct HillsideFlatPictureBehaviour {
  @Test func halfWayDown() {
    let stops = HillsideStyle.flatGradient(.day, crest: 0.5)
    let places = stops.map(\.at)
    let expected: [Double] = [0, 0.25, 0.44, 0.495, 0.5, 0.6, 1]
    #expect(places.count == expected.count)
    for (a, b) in zip(places, expected) { #expect(abs(a - b) < 1e-12) }
    #expect(stops[4].color == HillsideColor(hex: "#94d43c"))
  }

  @Test func aCrestNearTheTopMovesStopsUpToEachOther() {
    // at 4%: the low sky at −2% and the horizon at 3.5% come before the
    // mid sky at 2%, so they move up to it, and the box starts partway
    let stops = HillsideStyle.flatGradient(.night, crest: 0.04)
    let places = stops.map(\.at)
    #expect(places == places.sorted())
    #expect(places.first == 0)
    #expect(places.last == 1)
    #expect(stops.last?.color == HillsideColor(hex: "#081712"))
  }

  @Test func aCrestNearTheFootCutsTheField() {
    let stops = HillsideStyle.flatGradient(.dawn, crest: 0.96)
    // the field's mid green sits at 106%, past the box: the foot is part way to it
    let foot = stops.last?.color
    #expect(foot != HillsideColor(hex: "#557c2c"))
    #expect(stops.map(\.at) == stops.map(\.at).sorted())
  }
}

/// useSkyTaps' count (bits.jsx lines 32–46): each tap within 1,500 ms of
/// the last counts on, any later starts again at one, and the fifth turns
/// the sky and starts the count over.
@Suite struct SkyTapsBehaviour {
  @Test func fiveQuickTapsTurnIt() {
    var taps = SkyTaps()
    let times: [Double] = [10_000, 10_400, 11_000, 12_400, 13_899]
    let turned = times.map { taps.tap(now: $0) }
    #expect(turned == [false, false, false, false, true])
  }

  @Test func aSlowTapStartsAgain() {
    var taps = SkyTaps()
    // the fourth comes 1,500 after the third: not "within", so it is the first again
    let times: [Double] = [0, 100, 200, 1700, 1800, 1900, 2000]
    let turned = times.map { taps.tap(now: $0) }
    #expect(turned == [false, false, false, false, false, false, false])
    let fifth = taps.tap(now: 2100)
    #expect(fifth)
  }

  @Test func theCountStartsOverAfterATurn() {
    var taps = SkyTaps()
    for t in 0..<5 { _ = taps.tap(now: Double(t) * 100) }
    let next = (5..<9).map { taps.tap(now: Double($0) * 100) }
    #expect(next == [false, false, false, false])
    let again = taps.tap(now: 900)
    #expect(again)
  }

  /// Demo mode's UI tests widen the window (SkyTapsButton.windowMs); the
  /// default stays the web's 1.5 seconds.
  @Test func aWiderWindowCountsSlowerTaps() {
    #expect(SkyTaps().windowMs == SkyTaps.window)
    var wide = SkyTaps(windowMs: 60_000)
    let times: [Double] = [0, 1_500, 3_100, 4_600, 6_200]
    #expect(times.map { wide.tap(now: $0) } == [false, false, false, false, true])
    var web = SkyTaps()
    #expect(times.map { web.tap(now: $0) } == [false, false, false, false, false])
  }

  @Test func theToastSaysWhichWay() {
    #expect(SkyTaps.toast(wasOn: true) == "The live sky is put away.")
    #expect(SkyTaps.toast(wasOn: false) == "The live sky is out. Settings › Appearance puts it away again.")
  }
}
