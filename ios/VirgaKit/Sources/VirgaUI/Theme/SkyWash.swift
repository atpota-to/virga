// Ports src/styles/base.css (body's background: the sky)
// Ports src/hillside/LiveSky.jsx (where the live sky's band is drawn: over the wash)
//
// The sky behind every page: `--sky-top` at the top, `--sky-mid` by
// `--sky-mid-at`, faded into `--bg` by `--sky-end` (ThemeKit.skyWash), with
// the ground carrying on below. It belongs to the page, so it scrolls away
// as you read: PageSky draws it behind the page's scroll view from the very
// top of the window (under the status bar, so the system's chrome runs into
// it), moved up by as far as the page has scrolled (SkyScroll), and held at
// the top when the page is pulled down past it. Beside the sidebar it is
// drawn once, behind the sidebar and the page together, moved by the page
// (Shell.swift). The phone's sky is shorter (the tokens say so at that
// width), and high contrast has none: its tokens make the wash the flat
// ground.
//
// The navigation bar is clear over the sky and takes `--sky-top`
// (Sky.skyColor) once the page scrolls under it: `.skyNavigationBar()`.
//
// With the live sky on (Settings › Appearance, or five taps on the mark),
// its band is drawn over the top of the wash and moved with it
// (Sky/LiveSky.swift), on every page of the shell and on the front page.

#if canImport(UIKit)
import Observation
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

/// How far the page's sky has gone up: the page's scroll.
@MainActor
@Observable
public final class SkyScroll {
  /// Points the page has scrolled, as a negative offset (0 at rest and
  /// when pulled down past the top).
  public var offset: CGFloat = 0

  public init() {}

  /// The content's top in the scroll view's own space, as it scrolls: 0 at
  /// rest. Held at 0 above that, so the sky never leaves the window's top
  /// (and is the status bar's strip exactly) while the page is at rest.
  func report(_ y: CGFloat) {
    let next = min(0, y)
    if next != offset { offset = next }
  }
}

/// The page's sky, behind its scroll view, from the top of the window:
/// moved up by the page's scroll, the ground under it.
public struct PageSky: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(PreferencesModel.self) private var preferences: PreferencesModel?
  private let scroll: SkyScroll

  public init(scroll: SkyScroll) {
    self.scroll = scroll
  }

  public var body: some View {
    ZStack(alignment: .top) {
      theme.bg
      SkyWash().offset(y: scroll.offset)
      if preferences?.prefs.liveSky == true {
        LiveSky(inView: scroll.offset > -theme.skyEnd).offset(y: scroll.offset)
      }
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

extension View {
  /// The sky as the background of a page's scroll content: it scrolls with
  /// the page, and reaches under the status bar at the top. (Pages draw
  /// PageSky instead, so the sky's top is the window's top.) `live`: the
  /// live sky over its top, where the page has it (the front page).
  public func skyBackground(live: Bool = false) -> some View {
    background(alignment: .top) {
      ZStack(alignment: .top) {
        SkyWash().ignoresSafeArea(edges: .top)
        if live { LiveSky().ignoresSafeArea(edges: .top) }
      }
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
