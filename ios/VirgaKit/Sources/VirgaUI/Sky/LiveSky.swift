// Ports src/hillside/LiveSky.jsx
// Ports src/hillside/hillside.css (.live-sky, .live-sky-scene)
//
// The live sky: the 3D scene from Virga's first version, drawn in the sky
// at the top of the page instead of the flat wash. Only its sky and its
// clouds show: the scene is 1,100 points tall with its crest at 96%, so the
// hill sits below the fold of a band as tall as the wash (`--sky-end`),
// and the band fades into the page as the wash does. It is the page's sky,
// so it shows whichever of the four the page is under (PreferencesModel's
// effective sky), and it scrolls away with the page: it is drawn where the
// wash is (PageSky, and the front page's sky), moved as the wash is moved.
//
// As the web lays it on the wash with `screen`, drained of colour and
// pushed to black and white, the band draws the wash itself and lays the
// scene on it in its shaders (HillsideShaders' band pass), so the dark
// words on a day's sky keep the contrast the wash gives them and at night
// the scene is turned down. Until its first picture is up, the wash alone
// shows: the web's flat picture under the canvas, through the same filter,
// comes out black, which `screen` leaves as it was.
//
// Off unless Settings › Appearance (or five taps on the mark) turns it on,
// and never in high contrast, where there is no sky at all. Every page's
// band draws from one scene (LiveSkyDrivers), as the web's shell keeps one
// LiveSky while its pages change. Decorative, so hidden from VoiceOver.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct LiveSky: View {
  /// LiveSky.jsx's `depth`: a paler blue at the top, for a page with a lot
  /// of words on its sky.
  static let depth = 0.55

  @Environment(PreferencesModel.self) private var preferences: PreferencesModel?
  private let inView: Bool

  /// - Parameter inView: whether the page still has the band in view (its
  ///   sky not yet scrolled away).
  public init(inView: Bool = true) {
    self.inView = inView
  }

  public var body: some View {
    if let preferences, preferences.effectiveContrast != .high {
      LiveSkyBand(phase: preferences.effectiveSky, inView: inView)
    }
  }
}

/// `.live-sky`: the band across the top of the page, as tall as the wash.
struct LiveSkyBand: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var driver: HillsideDriver?
  let phase: SkyPhase
  let inView: Bool

  var body: some View {
    let height = theme.skyEnd
    GeometryReader { geometry in
      let width = geometry.size.width
      let canvas = HillsideStyle.liveSkyCanvas(width: Double(width))
      let onScreen = geometry.frame(in: .global).maxY > 0
      if let driver, width > 0 {
        let shows = driver.showsPicture
        HillsideCanvas(
          driver: driver, inView: inView && onScreen, sceneActive: scenePhase == .active,
          viewOffset: HillsideMatrix.ViewOffset(
            fullWidth: canvas.width, fullHeight: canvas.height, x: canvas.bleed, y: canvas.bleed, width: Double(width),
            height: Double(height)),
          band: Self.band(theme, height: height),
          fit: HillsideFit(width: canvas.width, height: canvas.height, crest: canvas.crest)
        )
        .opacity(shows ? 1 : 0)
        .animation(reduceMotion ? nil : HillsideCanvasLayer.ease(HillsideStyle.fadeIn), value: shows)
      }
    }
    .frame(height: height)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear { follow() }
    .onChange(of: reduceMotion) { _, _ in follow() }
    .onChange(of: phase) { _, next in driver?.setPhase(next) }
    .onDisappear {
      if let driver { LiveSkyDrivers.released(driver) }
    }
  }

  /// The app's live sky (made again with Reduce Motion turned on or off),
  /// in this page's sky.
  private func follow() {
    let shared = LiveSkyDrivers.driver(phase: phase, calm: reduceMotion)
    shared.setPhase(phase)
    if driver !== shared { driver = shared }
  }

  /// The band's wash (ThemeKit.skyWash's stops, as SkyWash draws them) and mask.
  static func band(_ theme: VirgaTheme, height: CGFloat) -> [Float] {
    let stops = ThemeKit.skyWash.stops
    let wash = stops.enumerated().map { index, stop in
      let color = theme.tokens.color(of: stop.color) ?? .transparent
      let at = stop.position.map { theme.points($0) } ?? height * CGFloat(index) / CGFloat(max(1, stops.count - 1))
      return HillsideBandUniforms.Stop(red: color.red, green: color.green, blue: color.blue, at: Double(at / max(1, height)))
    }
    return HillsideBandUniforms.pack(wash: wash, maskMidAt: Double(theme.skyMidAt / max(1, height)), night: theme.colorScheme == .dark)
  }
}

#Preview("The live sky by day") {
  VirgaPreviewHost {
    ZStack(alignment: .top) {
      SkyWash()
      LiveSky()
    }
    .ignoresSafeArea()
  }
}
#endif
