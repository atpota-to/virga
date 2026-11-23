// What src/styles/theme.test.js checks about the tokens, held against the
// Swift tables and resolver: the values known by heart, the skies sharing a
// page, every accent giving the same tokens, the contrast every word and
// mark needs on every ground (WCAG 2), the two series apart in OKLab for
// ordinary and colour-blind eyes, the heatmap's ramp, the swatches, high
// contrast's flat sky. (Its one check against charts.css, the second
// series on the chart's tooltip, is the web's: charts.css isn't read here.)
// Plus what the SwiftUI layer leans on: every token resolving to its kind
// in every state, the phone's measures, and the kit going through the
// theme.

import Foundation
import Testing
@testable import VirgaCore

private let desk: Double = 1280

private func page(_ sky: SkyPhase, _ contrast: Contrast = .normal, _ accent: Preferences.Accent = .blue,
                  density: Preferences.Density = .comfortable, width: Double = desk) -> ResolvedTheme {
  ThemeTokens.resolve(
    RootAttributes(sky: sky, theme: Sky.themeOf(sky), accent: accent, contrast: contrast, density: density),
    viewportWidth: width)
}

/// Every sky × contrast × accent, as theme.test.js's STATES.
private let states: [(sky: SkyPhase, contrast: Contrast, accent: Preferences.Accent)] = SkyPhase.allCases.flatMap { sky in
  Contrast.allCases.flatMap { contrast in Preferences.Accent.allCases.map { (sky, contrast, $0) } }
}

private func name(_ s: (sky: SkyPhase, contrast: Contrast, accent: Preferences.Accent)) -> String {
  "\(s.accent), \(s.sky)\(s.contrast == .high ? ", high contrast" : "")"
}

/// Runs `check` for every state and reports every shortfall at once.
private func everyState(
  _ only: [(sky: SkyPhase, contrast: Contrast, accent: Preferences.Accent)] = states,
  _ check: (ResolvedTheme, Contrast, (String, Double, Double) -> Void) -> Void
) {
  var short: [String] = []
  for s in only {
    check(page(s.sky, s.contrast, s.accent), s.contrast) { label, got, least in
      if !(got >= least) { short.append("\(name(s)): \(label) is \(String(format: "%.2f", got)), needs \(least)") }
    }
  }
  #expect(short.isEmpty, "\(short.prefix(20).joined(separator: "\n"))")
}

private let words: [Contrast: Double] = [.normal: 4.5, .high: 7]
private let marks: [Contrast: Double] = [.normal: 3, .high: 4.5]
private let grounds: [ThemeToken] = [.bg, .surface, .surface2, .surface3, .hover, .skyTop, .skyMid]
private let markGrounds: [ThemeToken] = [.bg, .surface, .skyMid]

private func ratio(_ t: ResolvedTheme, _ ink: ThemeToken, on ground: ThemeToken) -> Double {
  t[ink: ink].contrastRatio(on: t[ink: ground])
}

private extension ResolvedTheme {
  subscript(ink token: ThemeToken) -> ThemeColor { color(token) ?? .transparent }
}

// MARK: OKLab, and colour blindness (theme.test.js's own arithmetic)

private func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }

/// OKLab from linear sRGB.
private func oklab(_ rgb: [Double]) -> [Double] {
  let (r, g, b) = (rgb[0], rgb[1], rgb[2])
  let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/// Machado, Oliveira and Fernandes (2009), severity 1.0, on linear RGB.
private let colourBlind: [(String, [[Double]])] = [
  ("protanopia", [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]),
  ("deuteranopia", [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]]),
  ("tritanopia", [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]]),
]

/// How far apart two solid colours are (OKLab, × 100), as they are or as
/// one kind of colour blindness sees them.
private func apart(_ a: ThemeColor, _ b: ThemeColor, _ matrix: [[Double]]? = nil) -> Double {
  func seen(_ c: ThemeColor) -> [Double] {
    let lin = [c.red, c.green, c.blue].map(linear)
    guard let matrix else { return oklab(lin) }
    return oklab(matrix.map { row in Swift.max(0, Swift.min(1, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])) })
  }
  let (p, q) = (seen(a), seen(b))
  let (dl, da, db) = (p[0] - q[0], p[1] - q[1], p[2] - q[2])
  return 100 * (dl * dl + da * da + db * db).squareRoot()
}

private func lightness(_ c: ThemeColor) -> Double { oklab([c.red, c.green, c.blue].map(linear))[0] }

@Suite struct ThemeTokensBehaviour {
  @Test func readTheWayABrowserReadsIt() {
    let day = page(.day)
    #expect(day.bg.hexString == "#ffffff")
    #expect(day.skyTop.hexString == "#b9d5ff")
    #expect(day.accent.hexString == "#1d5ee0")
    #expect(day.chart2.hexString == "#e8553a")
    #expect(day.up.hexString == "#1849b5")
    #expect(day.btn.hexString == "#0f1b33")
    let dusk = page(.dusk)
    #expect(dusk.bg.hexString == "#ffffff")
    #expect(dusk.skyTop.hexString == "#cbc5f4")
    #expect(dusk.ink.hexString == "#0f1b33")
    let night = page(.night)
    #expect(night.bg.hexString == "#0d152b")
    #expect(night.skyTop.hexString == "#0e1a3a")
    #expect(night.ink.hexString == "#f2f5fc")
    #expect(night.onBtn.hexString == "#0d152b")
    #expect(night.focusRing == night.accentInk)
    #expect(night.colorScheme == .dark)
    #expect(day.colorScheme == .light)
    let strongest = page(.night, .high, .amber)
    #expect(strongest.bg.hexString == "#000000")
    #expect(strongest.skyTop.hexString == "#000000")
    #expect(strongest.focusRing == strongest.accent)
    #expect(strongest.down == strongest.secondInk)
  }

  @Test func dawnDayAndDuskShareAPageAndNightHasItsOwn() {
    func rest(_ t: ResolvedTheme) -> [ThemeToken: ThemeValue] {
      t.values.filter { !$0.key.rawValue.hasPrefix("--sky-") }
    }
    let (dawn, day, dusk, night) = (page(.dawn), page(.day), page(.dusk), page(.night))
    #expect(rest(dawn) == rest(day))
    #expect(rest(dusk) == rest(day))
    #expect(rest(night) != rest(day))
    #expect(Set([dawn.skyTop, day.skyTop, dusk.skyTop, night.skyTop]).count == 4)
  }

  @Test func anAccentItDoesNotKnowIsBlue() {
    var html = ThemeTokens.htmlAttributes(Preferences.rootAttributes(nil))
    let accents = Preferences.Accent.allCases.map { page(.day, .normal, $0).accent }
    #expect(Set(accents).count == Preferences.Accent.allCases.count)
    html["data-accent"] = "chartreuse"
    #expect(ThemeTokens.resolve(html: html, viewportWidth: desk).accent == page(.day).accent)
  }

  @Test func everyAccentBlockGivesTheSameTokens() {
    let accentBlocks = ThemeTokens.blocks.filter { block in
      block.media == nil && block.selectors.contains { selector in
        guard let last = selector.compounds.last, case .attribute("data-accent", _)? = last.last else { return false }
        return true
      }
    }
    #expect(accentBlocks.count == Preferences.Accent.allCases.count * 4)
    let expected: [String] = ThemeTokens.accentTokens.map(\.rawValue).sorted()
    for block in accentBlocks {
      let declared: [String] = block.declarations.map(\.token.rawValue).sorted()
      #expect(declared == expected, "\(block.selectors)")
    }
  }

  @Test func darkHighContrastSaysEverythingLightHighContrastSays() {
    func tokens(_ css: String) -> [ThemeToken] {
      ThemeTokens.blocks.filter { $0.media == nil && $0.selectors.map(\.css) == [css] }.flatMap { $0.declarations.map(\.token) }
    }
    let light = tokens(":root[data-contrast='high']")
    let dark = tokens(":root[data-contrast='high'][data-theme='dark']")
    #expect(light.count > 10)
    #expect(light.filter { !dark.contains($0) }.isEmpty)
  }

  @Test func everyTokenResolvesToItsKindEverywhere() {
    var missing: [String] = []
    for sky in SkyPhase.allCases {
      for theme in Theme.allCases {
        for accent in Preferences.Accent.allCases {
          for contrast in Contrast.allCases {
            for density in Preferences.Density.allCases {
              for width in [desk, 820, 390] {
                let attrs = RootAttributes(sky: sky, theme: theme, accent: accent, contrast: contrast, density: density)
                let t = ThemeTokens.resolve(attrs, viewportWidth: width)
                for token in ThemeToken.allCases {
                  let ok: Bool
                  switch (token.kind, t[token]) {
                  case (.color, .color?), (.length, .length?), (.shadow, .shadow?), (.fonts, .fonts?),
                    (.easing, .cubicBezier?), (.keyword, .keyword?):
                    ok = true
                  default:
                    ok = false
                  }
                  if !ok { missing.append("\(attrs) at \(width): \(token.rawValue)") }
                }
              }
            }
          }
        }
      }
    }
    #expect(missing.isEmpty, "\(missing.prefix(10))")
  }

  // MARK: Words

  @Test func wordsAreReadableOnEveryGroundTheSkyIncluded() {
    everyState { t, c, need in
      for ground in grounds {
        for ink in [ThemeToken.ink, .ink2, .muted] {
          need("\(ink.rawValue) on \(ground.rawValue)", ratio(t, ink, on: ground), words[c]!)
        }
      }
    }
  }

  @Test func wordsOnAButtonAreReadable() {
    everyState { t, c, need in
      need("--on-btn on --btn", ratio(t, .onBtn, on: .btn), words[c]!)
      need("--on-btn on --btn-hover", ratio(t, .onBtn, on: .btnHover), words[c]!)
    }
  }

  @Test func wordsInAndOnTheAccentAreReadable() {
    everyState { t, c, need in
      for ground in [ThemeToken.bg, .surface, .skyMid, .accentWash] {
        need("--accent-ink on \(ground.rawValue)", ratio(t, .accentInk, on: ground), words[c]!)
      }
      need("--on-accent on --accent", ratio(t, .onAccent, on: .accent), words[c]!)
      need("--on-accent on --accent-hover", ratio(t, .onAccent, on: .accentHover), words[c]!)
      for ground in [ThemeToken.bg, .surface, .skyMid, .secondWash] {
        need("--second-ink on \(ground.rawValue)", ratio(t, .secondInk, on: ground), words[c]!)
      }
    }
  }

  @Test func wordsThatWarnOrReportAFailureAreReadable() {
    everyState { t, c, need in
      for (ink, wash) in [(ThemeToken.warn, ThemeToken.warnWash), (.danger, .dangerWash)] {
        for ground in [ThemeToken.bg, .surface, wash] {
          need("\(ink.rawValue) on \(ground.rawValue)", ratio(t, ink, on: ground), words[c]!)
        }
      }
    }
  }

  // MARK: Marks

  @Test func theAccentAndTheFocusRingShowAgainstThePageAndTheSky() {
    everyState { t, c, need in
      for ground in markGrounds + [.skyTop] {
        need("--accent on \(ground.rawValue)", ratio(t, .accent, on: ground), marks[c]!)
        need("--focus-ring on \(ground.rawValue)", ratio(t, .focusRing, on: ground), marks[c]!)
      }
    }
  }

  @Test func theFocusRingIsASolidLineThickerInHighContrast() {
    everyState { t, c, need in
      let rings = t.focus
      let at = rings.firstIndex { $0.color == .color(t.focusRing) }
      need("a ring in --focus-ring", at == nil ? 0 : 1, 1)
      guard let at else { return }
      let spread = rings[at].spread?.points(in: t.lengthContext) ?? 0
      let inner = at > 0 ? rings[at - 1].spread?.points(in: t.lengthContext) ?? 0 : 0
      need("the solid ring's width in px", spread - inner, c == .high ? 3 : 1)
    }
  }

  @Test func chartMarksShowAgainstThePageAndTheSkyUnderTheTitle() {
    everyState { t, c, need in
      for ground in markGrounds {
        for mark in [ThemeToken.chart1, .chart2, .chartGhost] {
          need("\(mark.rawValue) on \(ground.rawValue)", ratio(t, mark, on: ground), marks[c]!)
        }
      }
    }
  }

  @Test func theTwoSeriesStayApartForOrdinaryAndColourBlindEyes() {
    everyState { t, _, need in
      let (one, two) = (t.chart1, t.chart2)
      need("--chart-1 from --chart-2", apart(one, two), 20)
      for (kind, matrix) in colourBlind {
        need("--chart-1 from --chart-2 under \(kind)", apart(one, two, matrix), 15)
      }
    }
  }

  @Test func aHeatmapRunsOneWayInStepsThatCanBeToldApart() {
    for s in states {
      let t = page(s.sky, s.contrast, s.accent)
      #expect(t.heat0.alpha == 1, "\(name(s)): the ramp is solid")
    }
    everyState { t, _, need in
      let ramp = [t.heat0, t.heat1, t.heat2, t.heat3, t.heat4, t.heat5, t.heat6]
      let toward: Double = t.colorScheme == .light ? -1 : 1
      for i in 1..<ramp.count {
        need("--heat-\(i) past --heat-\(i - 1)", (lightness(ramp[i]) - lightness(ramp[i - 1])) * toward, 0.03)
      }
      // "Nothing" sits next to the page; the two fullest steps are marks in their own right.
      for ground in [ThemeToken.bg, .surface] {
        let g = t[ink: ground]
        need("--heat-0 beside \(ground.rawValue) (1 / contrast)", 1 / ramp[0].contrastRatio(on: g), 1 / 1.3)
        need("--heat-5 on \(ground.rawValue)", ramp[5].contrastRatio(on: g), 3)
        need("--heat-6 on \(ground.rawValue)", ramp[6].contrastRatio(on: g), 3)
      }
    }
  }

  @Test func theAreaUnderALineIsATintOfThatLine() {
    for s in states {
      let t = page(s.sky, s.contrast, s.accent)
      var solid = t.chartArea
      solid.alpha = 1
      #expect(solid == t.chart1, "\(name(s))")
      #expect(t.chartArea.alpha <= 0.25, "\(name(s))")
    }
  }

  // MARK: High contrast

  @Test func highContrastDrawsLinesAt3To1AndIsAStepPastTheOrdinarySet() {
    let high = states.filter { $0.contrast == .high }
    everyState(high) { t, _, need in
      for line in [ThemeToken.line, .line2, .lineSoft, .accentLine, .chartAxis] {
        need("\(line.rawValue) on --surface", ratio(t, line, on: .surface), 3)
        need("\(line.rawValue) on --bg", ratio(t, line, on: .bg), 3)
      }
      need("--faint on --surface", ratio(t, .faint, on: .surface), 3)
      need("--ok on --surface", ratio(t, .ok, on: .surface), 3)
    }
    for s in high {
      let plain = page(s.sky, .normal, s.accent)
      let strong = page(s.sky, .high, s.accent)
      for (ink, ground) in [(ThemeToken.muted, ThemeToken.surface), (.accentInk, .surface), (.onAccent, .accent), (.line, .surface)] {
        #expect(ratio(strong, ink, on: ground) > ratio(plain, ink, on: ground), "\(name(s)): \(ink.rawValue) on \(ground.rawValue)")
      }
    }
  }

  @Test func highContrastHasNoSky() {
    for s in states where s.contrast == .high {
      let t = page(s.sky, .high, s.accent)
      #expect(t.skyTop == t.bg, "\(name(s))")
      #expect(t.skyMid == t.bg, "\(name(s))")
    }
  }

  @Test func theBrowsersChromeTakesTheColourAtTheTopOfTheSky() {
    for sky in SkyPhase.allCases {
      for contrast in Contrast.allCases {
        #expect(Sky.skyColor(sky, contrast: contrast) == page(sky, contrast).skyTop.hexString, "\(sky) \(contrast)")
      }
    }
  }

  // MARK: Swatches

  @Test func aSwatchShowsTheAccentItNamesInThePagesOwnSkyAndContrast() {
    for s in states {
      let attrs = RootAttributes(sky: s.sky, theme: Sky.themeOf(s.sky), accent: s.accent, contrast: s.contrast, density: .comfortable)
      for accent in Preferences.Accent.allCases {
        let shown = ThemeTokens.swatch(accent, in: attrs, viewportWidth: desk)
        let meant = page(s.sky, s.contrast, accent)
        for token in ThemeTokens.accentTokens {
          #expect(shown[token] == meant[token], "\(accent) swatch on a page that is \(name(s)): \(token.rawValue)")
        }
        // What <html> worked out from its own accent, a swatch inherits as it is.
        #expect(shown.focusRing == page(s.sky, s.contrast, s.accent).focusRing)
      }
    }
  }

  // MARK: Measures

  @Test func theTypeAndSpaceScales() {
    let t = page(.day)
    #expect(ThemeTokens.typeScale.prefix(8).map { t.points($0) ?? 0 } == [12, 13, 14, 15, 18, 22, 28, 36])
    #expect(ThemeTokens.spaceScale.map { t.points($0) ?? 0 } == [4, 8, 12, 16, 24, 32, 48])
    #expect(ThemeTokens.radii.map { t.points($0) ?? 0 } == [6, 8, 12, 999])
    #expect(t.textTitle == 32)
    #expect(t.sans.first == "Instrument Sans Variable")
    #expect(t.code.first == "ui-monospace")
    #expect(t.ease == ThemeCubicBezier(0.2, 0.8, 0.2, 1))
    #expect(ThemeTokens.fontWeights == [400, 500, 600])
  }

  @Test func aPhoneHasLessRoomRoundThePageAndAShorterSky() {
    let deskPage = page(.day)
    let phone = page(.day, width: 390)
    #expect(deskPage.pagePad == 51.2)
    #expect(phone.pagePad == 20)
    #expect(deskPage.pageTop == 40)
    #expect(phone.pageTop == 8)
    #expect(phone.textTitle == 28)
    #expect(phone.skyMidAt == 170)
    #expect(phone.skyEnd == 420)
    #expect(phone.textBase == 15)
    #expect(page(.day, width: 820).textBase == 14)
    #expect(page(.night, width: 390).skyEnd == 460)
    #expect(page(.night).skyEnd == 620)
    let compactPhone = page(.day, density: .compact, width: 390)
    #expect(compactPhone.pagePad == 16)
    #expect(compactPhone.pageTop == 8)
    #expect(compactPhone.gridGap == 22)
    let compactDesk = page(.day, density: .compact)
    #expect(compactDesk.pagePad == 38.4)
    #expect(compactDesk.pageTop == 28)
    #expect(compactDesk.controlH == 32)
    #expect(page(.day, width: 899).pagePad == 20)
    #expect(page(.day, width: 900).pagePad == 36)
    // The figure that leads a page grows with the viewport between 40 and 60.
    #expect(page(.day, width: 390).textFigure == 40)
    #expect(page(.day, width: 1920).textFigure == 60)
    #expect(deskPage.measure == .value(54, .ch))
    #expect(deskPage.points(.measure, in: ThemeLengthContext(viewportWidth: desk, chWidth: 8)) == 432)
    // Typed first: Xcode's type checker gives up on the mixed literals inline.
    let shellMax: Double = 272 + 1040 + 51.2 * 2
    #expect(deskPage.shellMax == shellMax)
  }

  @Test func theKitGoesThroughTheTheme() throws {
    let t = page(.day)
    #expect(t.points(of: ThemeKit.buttonHeight) == 36)
    #expect(page(.day, density: .compact).points(of: ThemeKit.buttonHeight) == 32)
    #expect(ThemeKit.touchButtonHeight == .px(40))
    #expect(ThemeKit.touchGhostIconButtonSize == .px(44))
    #expect(t.color(of: ThemeKit.primaryButtonFill) == t.btn)
    #expect(page(.night).color(of: ThemeKit.dangerButtonFillAtNight)?.hexString == "#b42318")
    let field = try #require(t.color(of: ThemeKit.inputFill))
    #expect(ThemeColor(red: field.red, green: field.green, blue: field.blue).hexString == t.surface.hexString)
    #expect(abs(field.alpha - 0.72) < 1e-12)
    let wash = ThemeKit.skyWash.stops.compactMap { t.color(of: $0.color) }
    #expect(wash == [t.skyTop, t.skyMid, t.bg])
    #expect(ThemeKit.skyWash.stops.compactMap { $0.position.flatMap { t.points(of: $0) } } == [0, 240, 560])
    #expect(ThemeKit.buttonTransition.map(\.duration) == [0.12, 0.12, 0.12])
    #expect(ThemeKit.menuSheetAnimation.easing == .variable(.ease))
    // A field that is the trouble declares its ring again, in the danger colour.
    let invalid = t.declaring([(.focusRing, ThemeKit.invalidFocusRing), (.focus, ThemeKit.invalidFocus)])
    #expect(invalid.focusRing == t.danger)
    #expect(invalid.focus.map(\.color) == [.color(t.danger), .color(ThemeColor.mix(t.danger, 32, .transparent, nil)!)])
    #expect(invalid.accent == t.accent)
    let strong = page(.day, .high).declaring([(.focusRing, ThemeKit.invalidFocusRing), (.focus, ThemeKit.highContrastInvalidFocus)])
    #expect(strong.focus.map(\.color) == [.color(strong.surface), .color(strong.danger)])
  }

  @Test func preferencesStampTheAttributesTheTokensAreReadFor() {
    var prefs = Preferences()
    prefs.sky = .night
    prefs.accent = .rose
    prefs.contrast = .system
    let t = ThemeTokens.resolve(Preferences.rootAttributes(prefs, moreContrast: true), viewportWidth: desk)
    #expect(t.bg.hexString == "#000000")
    #expect(t.accent.hexString == "#f893ab")
    prefs.contrast = .normal
    let night = ThemeTokens.resolve(Preferences.rootAttributes(prefs), viewportWidth: desk)
    #expect(night.bg.hexString == "#0d152b")
    #expect(night.accent.hexString == "#f191a7")
  }
}
