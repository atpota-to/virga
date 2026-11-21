// Ports src/styles/base.css (body's background: the sky)
//
// The sky behind every page: `--sky-top` at the top, `--sky-mid` by
// `--sky-mid-at`, faded into `--bg` by `--sky-end` (ThemeKit.skyWash), with
// the ground carrying on below. It belongs to the page's content, so it
// scrolls away as you read: `.skyBackground()` draws it as the background
// of a scroll view's content, reaching up under the status bar so the
// system's chrome runs into it. The phone's sky is shorter (the tokens say
// so at that width), and high contrast has none: its tokens make the wash
// the flat ground.
//
// The navigation bar is clear over the sky and takes `--sky-top`
// (Sky.skyColor) once the page scrolls under it: `.skyNavigationBar()`.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// ThemeKit.skyWash, drawn: the gradient from the top of the page to
/// `--sky-end`, then the ground.
public struct SkyWash: View {
  @Environment(\.virgaTheme) private var theme

  public init() {}

  public var body: some View {
    let wash = theme.skyWash
    VStack(spacing: 0) {
      LinearGradient(stops: wash.stops, startPoint: .top, endPoint: .bottom)
        .frame(height: wash.height)
      theme.bg
    }
  }
}

extension VirgaTheme {
  /// The sky's gradient as SwiftUI stops over its height (the last stop's
  /// position, `--sky-end`).
  public var skyWash: (stops: [Gradient.Stop], height: CGFloat) {
    let stops = ThemeKit.skyWash.stops
    let positions = stops.map { stop in stop.position.map { points($0) } }
    let height = max(1, positions.compactMap { $0 }.max() ?? skyEnd)
    var out: [Gradient.Stop] = []
    for (index, stop) in stops.enumerated() {
      // A stop with no position is spread evenly, as CSS does; the sky's
      // stops all have one.
      let at = positions[index] ?? height * CGFloat(index) / CGFloat(max(1, stops.count - 1))
      out.append(Gradient.Stop(color: color(stop.color), location: min(1, max(0, at / height))))
    }
    return (out, height)
  }
}

extension View {
  /// The sky as the background of a page's scroll content: it scrolls with
  /// the page, and reaches under the status bar at the top.
  public func skyBackground() -> some View {
    background(alignment: .top) {
      SkyWash().ignoresSafeArea(edges: .top)
    }
  }

  /// The navigation bar over the sky: clear at the top of the page, and the
  /// top of the sky once the page scrolls under it.
  public func skyNavigationBar() -> some View {
    modifier(SkyNavigationBar())
  }
}

struct SkyNavigationBar: ViewModifier {
  @Environment(\.virgaTheme) private var theme

  func body(content: Content) -> some View {
    content
      .toolbarBackground(theme.skyTop, for: .navigationBar)
      .toolbarBackground(.automatic, for: .navigationBar)
  }
}
#endif
