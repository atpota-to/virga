// Ports src/hillside/Hillside.jsx
// Ports src/hillside/hillside.css (.hillside and its four flat pictures, .hillside-crest, .hillside-canvas)
//
// The hillside behind a page: a 3D green hill under a blue sky (the scene,
// drawn in Metal), filling whatever it's put in. Until its first picture is
// up, or where Metal isn't there, a flat picture of the same sky and field
// stands in for it (hillside.css's gradient for the sky it shows, its stops
// placed about the crest). The canvas fades in over it, then, if `soft`, the
// focus moves to the page a moment later and the hill goes out of focus by
// `blur`, the canvas running 2.5 blurs past each edge so the blur has no
// soft edges; with Reduce Motion neither moves.
//
// `crest` is where the hill's crest goes, in points from the top (half way
// down when nil). `phase` is the sky; `day` is the older way to ask, under a
// half dawn, the rest day. While `active` is false it keeps its last
// picture and stops drawing, for when the page has it covered. `intro`
// brings the view down from the sky onto the hill when it first appears.
// `depth` is how deep a blue the sky gets at the top: 1 the full deep blue,
// less paler, for a page with a lot of words on its sky. Decorative, so
// hidden from VoiceOver, as the web's aria-hidden is.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct HillsideView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var driver: HillsideDriver?
  private let sky: SkyPhase
  private let active: Bool
  private let intro: Bool
  private let depth: Double
  private let soft: Bool
  private let crest: CGFloat?
  private let blur: CGFloat

  public init(
    phase: SkyPhase? = nil, day: Double = 1, active: Bool = true, intro: Bool = false, depth: Double = 1, soft: Bool = true,
    crest: CGFloat? = nil, blur: CGFloat = CGFloat(HillsideStyle.hillBlur)
  ) {
    sky = phase ?? (day < 0.5 ? .dawn : .day)
    self.active = active
    self.intro = intro
    self.depth = depth
    self.soft = soft
    self.crest = crest
    self.blur = blur
  }

  public var body: some View {
    GeometryReader { geometry in
      let size = geometry.size
      let crestPoints = crest ?? size.height * CGFloat(HillsideStyle.defaultCrest)
      let canvas = HillsideStyle.canvas(width: Double(size.width), height: Double(size.height), crest: Double(crestPoints), blur: Double(blur))
      let frame = geometry.frame(in: .global)
      let inView = frame.maxY > 0 && frame.minY < theme.windowHeight
      ZStack(alignment: .topLeading) {
        HillsideFlatPicture(phase: sky, crest: size.height > 0 ? crestPoints / size.height : CGFloat(HillsideStyle.defaultCrest))
        if let driver {
          HillsideCanvasLayer(
            driver: driver, canvas: canvas, inView: inView, sceneActive: scenePhase == .active, soft: soft && active, blur: blur)
        }
      }
      .frame(width: size.width, height: size.height, alignment: .topLeading)
      .clipped()
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear {
      if driver == nil {
        driver = HillsideDriver(phase: sky, calm: reduceMotion, depth: depth, soft: soft, drawsLand: true, intro: intro)
      }
      driver?.setActive(active)
    }
    .onChange(of: sky) { _, next in driver?.setPhase(next) }
    .onChange(of: active) { _, on in driver?.setActive(on) }
    .onDisappear {
      driver?.dispose()
      driver = nil
    }
  }
}

/// The canvas over the flat picture: faded in once its picture is up, and
/// then, if soft, out of focus.
struct HillsideCanvasLayer: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  let driver: HillsideDriver
  let canvas: HillsideStyle.Canvas
  let inView: Bool
  let sceneActive: Bool
  let soft: Bool
  let blur: CGFloat

  /// CSS's `ease`.
  static func ease(_ seconds: Double) -> Animation { .timingCurve(0.25, 0.1, 0.25, 1, duration: seconds) }

  var body: some View {
    let shows = driver.showsPicture
    let focused = soft && shows
    HillsideCanvas(
      driver: driver, inView: inView, sceneActive: sceneActive,
      fit: HillsideFit(width: canvas.width, height: canvas.height, crest: canvas.crest)
    )
    .frame(width: CGFloat(canvas.width), height: CGFloat(canvas.height))
    .offset(x: -CGFloat(canvas.bleed), y: -CGFloat(canvas.bleed))
    .opacity(shows ? 1 : 0)
    .animation(reduceMotion ? nil : Self.ease(HillsideStyle.fadeIn), value: shows)
    .blur(radius: focused ? blur : 0)
    .animation(reduceMotion ? nil : Self.ease(HillsideStyle.focusDuration).delay(HillsideStyle.focusDelay), value: focused)
  }
}

/// `.hillside`'s background: the flat picture of the sky and field, its
/// stops about the crest (a share of the height).
public struct HillsideFlatPicture: View {
  private let phase: SkyPhase
  private let crest: CGFloat

  public init(phase: SkyPhase, crest: CGFloat = CGFloat(HillsideStyle.defaultCrest)) {
    self.phase = phase
    self.crest = crest
  }

  public var body: some View {
    let stops = HillsideStyle.flatGradient(phase, crest: Double(crest)).map { stop in
      Gradient.Stop(color: Color(.sRGB, red: stop.color.r, green: stop.color.g, blue: stop.color.b, opacity: 1), location: CGFloat(stop.at))
    }
    LinearGradient(stops: stops, startPoint: .top, endPoint: .bottom)
      .accessibilityHidden(true)
  }
}

#Preview("The hillside") {
  VirgaPreviewHost {
    HillsideView(phase: .day, intro: true, crest: 420)
      .ignoresSafeArea()
  }
}

#Preview("The flat picture, at dusk") {
  HillsideFlatPicture(phase: .dusk, crest: 0.6)
    .frame(height: 500)
}
#endif
