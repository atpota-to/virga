// What src/styles/theme.test.js checks about the tokens, held against the
// Swift tables and resolver: the values known by heart, the skies sharing a
// page, every accent giving the same tokens, the contrast every word and
// mark needs on every ground (WCAG 2), the swatches, high contrast's flat
// sky. Plus what the SwiftUI layer leans on: every token resolving to its
// kind in every state, the phone's measures, and the kit going through the
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
    #expect(dusk.bg.hexString == "#ffffff" && dusk.skyTop.hexString == "#cbc5f4" && dusk.ink.hexString == "#0f1b33")
    let night = page(.night)
    #expect(night.bg.hexString == "#0d152b" && night.skyTop.hexString == "#0e1a3a")
    #expect(night.ink.hexString == "#f2f5fc" && night.onBtn.hexString == "#0d152b")
    #expect(night.focusRing == night.accentInk)
    #expect(night.colorScheme == .dark && day.colorScheme == .light)
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
    for block in accentBlocks {
      #expect(block.declarations.map(\.token).sorted { $0.rawValue < $1.rawValue }
        == ThemeTokens.accentTokens.sorted { $0.rawValue < $1.rawValue }, "\(block.selectors)")
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
      #expect(t.skyTop == t.bg && t.skyMid == t.bg, "\(name(s))")
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
    #expect(t.sans.first == "Instrument Sans Variable" && t.code.first == "ui-monospace")
    #expect(t.ease == ThemeCubicBezier(0.2, 0.8, 0.2, 1))
    #expect(ThemeTokens.fontWeights == [400, 500, 600])
  }

  @Test func aPhoneHasLessRoomRoundThePageAndAShorterSky() {
    let deskPage = page(.day)
    let phone = page(.day, width: 390)
    #expect(deskPage.pagePad == 51.2 && phone.pagePad == 20)
    #expect(deskPage.pageTop == 40 && phone.pageTop == 8)
    #expect(phone.textTitle == 28 && phone.skyMidAt == 170 && phone.skyEnd == 420)
    #expect(phone.textBase == 15 && page(.day, width: 820).textBase == 14)
    #expect(page(.night, width: 390).skyEnd == 460 && page(.night).skyEnd == 620)
    let compactPhone = page(.day, density: .compact, width: 390)
    #expect(compactPhone.pagePad == 16 && compactPhone.pageTop == 8 && compactPhone.gridGap == 22)
    let compactDesk = page(.day, density: .compact)
    #expect(compactDesk.pagePad == 38.4 && compactDesk.pageTop == 28 && compactDesk.controlH == 32)
    #expect(page(.day, width: 899).pagePad == 20 && page(.day, width: 900).pagePad == 36)
    // The figure that leads a page grows with the viewport between 40 and 60.
    #expect(page(.day, width: 390).textFigure == 40 && page(.day, width: 1920).textFigure == 60)
    #expect(deskPage.measure == .value(54, .ch))
    #expect(deskPage.points(.measure, in: ThemeLengthContext(viewportWidth: desk, chWidth: 8)) == 432)
    #expect(deskPage.shellMax == 272 + 1040 + 51.2 * 2)
  }

  @Test func theKitGoesThroughTheTheme() throws {
    let t = page(.day)
    #expect(t.points(of: ThemeKit.buttonHeight) == 36)
    #expect(page(.day, density: .compact).points(of: ThemeKit.buttonHeight) == 32)
    #expect(ThemeKit.touchButtonHeight == .px(40) && ThemeKit.touchGhostIconButtonSize == .px(44))
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
    #expect(t.bg.hexString == "#000000" && t.accent.hexString == "#f893ab")
    prefs.contrast = .normal
    let night = ThemeTokens.resolve(Preferences.rootAttributes(prefs), viewportWidth: desk)
    #expect(night.bg.hexString == "#0d152b" && night.accent.hexString == "#f191a7")
  }
}
