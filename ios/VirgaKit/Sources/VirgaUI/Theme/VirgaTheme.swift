// Ports src/styles/theme.css
// Ports src/styles/base.css
// Ports src/lib/preferences.jsx (the DOM stamping and the matchMedia queries)
//
// The theme as the views read it: `@Environment(\.virgaTheme) var theme`.
// It is VirgaCore's ResolvedTheme (every token for the attributes the web
// stamps on <html>, at this window's width), with the window's width, Reduce
// Motion and the Dynamic Type size beside it, and the helpers a view needs to
// draw with it: colours as Color, lengths as CGFloat, a kit measure through
// the theme, the type scale as fonts (Typography.swift), the motion table
// (Motion.swift), the sky (Sky.swift).
//
// VirgaThemeRoot puts it in the environment at the root of the window. It
// re-resolves when the preferences' root attributes or the window's width
// change (ThemeCache keeps what it worked out by both), and it feeds the
// device's dark mode and Increase Contrast to PreferencesModel as the web's
// matchMedia('(prefers-color-scheme: dark)') and '(prefers-contrast: more)'
// do. Reduce Motion is the web's prefers-reduced-motion, which is CSS-only
// there; here VirgaMotion reads it.
//
// Never write a colour, size or duration into a view: name the token, a
// ThemeKit constant, or (for a stylesheet ThemeKit doesn't carry yet) a
// Measure (Measures.swift).

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaCore

/// The widths the stylesheets decide the components' layout at (their media
/// queries). The token-level ones (899, 760) are ThemeTokens.resolve's; these
/// are the components' own, applied from the same width (DESIGN.md, Phone and
/// desk).
public enum Breakpoint {
  /// shell.css `(min-width: 900px)`: the sidebar instead of the phone's bars.
  public static let sidebar: CGFloat = 900
  /// controls.css, shell.css `(max-width: 760px)`: a settings row's control
  /// under its words.
  public static let tablet: CGFloat = 760
  /// composer.css `(max-width: 640px)`: the composer fills the screen.
  public static let composer: CGFloat = 640
  /// controls.css `(max-width: 560px)`: figures two to a row, a heading keeps
  /// one thing beside its title, a page's controls go under its words, a
  /// row's ⋯ moves to its top corner.
  public static let phone: CGFloat = 560
  /// shell.css `(max-width: 429px)`: the current tab is a disc, its name read
  /// out but not shown.
  public static let narrowTabBar: CGFloat = 429
  /// theme.css `(max-width: 374px)` in high contrast: the disc gets an ink ring.
  public static let tabRing: CGFloat = 374
}

/// The theme, as every view reads it.
public struct VirgaTheme: Sendable {
  /// Every token, resolved for `attributes` at `windowWidth`.
  public var tokens: ResolvedTheme
  /// What the web stamps on <html>: the sky, theme, accent, contrast, density.
  public var attributes: RootAttributes
  /// The window's width in points: the web's viewport.
  public var windowWidth: CGFloat
  /// The device's Reduce Motion: nothing moves (Motion.swift).
  public var reduceMotion: Bool
  /// The Dynamic Type size the type scale is scaled by (Typography.swift).
  public var dynamicTypeSize: DynamicTypeSize
  /// Whether Instrument Sans was registered (else the system font stands in).
  public var hasTypeface: Bool

  public init(
    tokens: ResolvedTheme,
    attributes: RootAttributes,
    windowWidth: CGFloat,
    reduceMotion: Bool = false,
    dynamicTypeSize: DynamicTypeSize = .large,
    hasTypeface: Bool = VirgaTypeface.isRegistered
  ) {
    self.tokens = tokens
    self.attributes = attributes
    self.windowWidth = windowWidth
    self.reduceMotion = reduceMotion
    self.dynamicTypeSize = dynamicTypeSize
    self.hasTypeface = hasTypeface
  }

  /// A theme for previews and the environment's default: the day sky (or
  /// another), blue, at a phone's width.
  public static func preview(
    sky: SkyPhase = .day,
    accent: Preferences.Accent = .blue,
    contrast: Contrast = .normal,
    density: Preferences.Density = .comfortable,
    width: CGFloat = 390
  ) -> VirgaTheme {
    let attributes = RootAttributes(sky: sky, theme: Sky.themeOf(sky), accent: accent, contrast: contrast, density: density)
    return VirgaTheme(
      tokens: ThemeTokens.resolve(attributes, viewportWidth: Double(width)), attributes: attributes, windowWidth: width,
      hasTypeface: false)
  }

  /// What a view gets outside VirgaThemeRoot.
  public static let fallback = VirgaTheme.preview()

  // MARK: What the page is

  /// Night, the dark theme: the page's color-scheme.
  public var colorScheme: ColorScheme { tokens.colorScheme == .dark ? .dark : .light }
  public var isHighContrast: Bool { attributes.contrast == .high }
  public var isCompact: Bool { attributes.density == .compact }

  /// From 900 points the sidebar; narrower, the app bar and the tab bar.
  public var hasSidebar: Bool { windowWidth >= Breakpoint.sidebar }
  /// 760 and narrower.
  public var isTablet: Bool { windowWidth <= Breakpoint.tablet }
  /// 560 and narrower: the phone's component layouts.
  public var isPhone: Bool { windowWidth <= Breakpoint.phone }
  /// Wide enough for the current tab's name beside its icon (430 and wider).
  public var showsTabName: Bool { windowWidth > Breakpoint.narrowTabBar }

  // MARK: Colours

  /// A colour token, as Color.
  public func color(_ token: ThemeToken) -> Color {
    (tokens.color(token) ?? .transparent).color
  }

  /// A kit colour (var(), color-mix() or a literal) through this theme.
  public func color(_ value: ThemeValue) -> Color {
    (tokens.color(of: value) ?? .transparent).color
  }

  /// A border's colour through this theme.
  public func color(_ border: ThemeBorder) -> Color {
    guard let value = border.color else { return .clear }
    return color(value)
  }

  // MARK: Lengths

  /// A length token in points.
  public func points(_ token: ThemeToken) -> CGFloat {
    CGFloat(tokens.points(token) ?? 0)
  }

  /// A kit length (with var() followed in this theme) in points.
  public func points(_ length: ThemeLength) -> CGFloat {
    CGFloat(tokens.points(of: length) ?? 0)
  }

  /// A kit value that holds a length (`var(--text-sm)`, `var(--figure-size)`)
  /// in points.
  public func points(_ value: ThemeValue) -> CGFloat {
    guard case .length(let length)? = tokens.resolve(value) else { return 0 }
    return CGFloat(length.points(in: tokens.lengthContext) ?? 0)
  }

  /// A border's width in points.
  public func points(_ border: ThemeBorder) -> CGFloat {
    border.width.map { points($0) } ?? 0
  }

  /// `--measure` (54ch). A ch is the width of "0" at the size of the text
  /// held to it, which is `--text-sm` for every line that is (a section's
  /// sub-line, a caption, a note, a callout).
  @MainActor
  public var measure: CGFloat {
    let zero = zeroWidth(size: textSm)
    let context = ThemeLengthContext(viewportWidth: Double(windowWidth), chWidth: Double(zero))
    return CGFloat(tokens.points(.measure, in: context) ?? Double(zero) * 54)
  }

  /// A length in `ch` of the body's font: `68ch`, say, for a page's line.
  @MainActor
  public func characters(_ count: CGFloat, size: CGFloat? = nil) -> CGFloat {
    count * zeroWidth(size: size ?? textBase)
  }

  /// A box (padding) as edge insets, through this theme.
  public func insets(_ box: ThemeBox) -> EdgeInsets {
    EdgeInsets(top: points(box.top), leading: points(box.left), bottom: points(box.bottom), trailing: points(box.right))
  }

  /// A gap's row and column spacing.
  public func gap(_ gap: ThemeGap) -> (row: CGFloat, column: CGFloat) {
    (points(gap.row), points(gap.column))
  }

  // MARK: Shadows

  /// The first layer of a shadow token, for `.shadow(color:radius:x:y:)`.
  public func shadow(_ layers: [ThemeShadowLayer]) -> VirgaShadow {
    guard let layer = layers.first(where: { !$0.inset }) else { return VirgaShadow(color: .clear, radius: 0, x: 0, y: 0) }
    return VirgaShadow(
      color: layer.color.map { color($0) } ?? .clear,
      radius: points(layer.blur ?? .px(0)) / 2,
      x: points(layer.x),
      y: points(layer.y))
  }

  /// The motion table, stopped by Reduce Motion.
  public var motion: VirgaMotion { VirgaMotion(reduced: reduceMotion, ease: tokens.ease) }
}

/// One layer of a CSS box-shadow, as SwiftUI's `.shadow` takes it (a CSS
/// blur is about twice SwiftUI's radius).
public struct VirgaShadow: Sendable {
  public var color: Color
  public var radius: CGFloat
  public var x: CGFloat
  public var y: CGFloat
}

extension View {
  /// A shadow token's outer layer.
  public func virgaShadow(_ shadow: VirgaShadow) -> some View {
    self.shadow(color: shadow.color, radius: shadow.radius, x: shadow.x, y: shadow.y)
  }
}

extension ThemeColor {
  /// The colour in SwiftUI: sRGB, with its alpha.
  public var color: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha) }
}

// MARK: - The environment

private struct VirgaThemeKey: EnvironmentKey {
  static let defaultValue: VirgaTheme = VirgaTheme.fallback
}

extension EnvironmentValues {
  /// The theme in force: VirgaThemeRoot sets it at the root of the window.
  public var virgaTheme: VirgaTheme {
    get { self[VirgaThemeKey.self] }
    set { self[VirgaThemeKey.self] = newValue }
  }
}

/// What ThemeTokens.resolve worked out, by the attributes and the width it
/// was asked for. Resolving is cheap, but it runs on every draw of the root.
final class ThemeCache {
  private struct Key: Hashable {
    var attributes: RootAttributes
    var width: Double
  }

  private var entries: [Key: ResolvedTheme] = [:]
  private var order: [Key] = []
  private let limit = 12

  func resolve(_ attributes: RootAttributes, width: Double) -> ResolvedTheme {
    let key = Key(attributes: attributes, width: width)
    if let held = entries[key] { return held }
    let theme = ThemeTokens.resolve(attributes, viewportWidth: width)
    entries[key] = theme
    order.append(key)
    if order.count > limit {
      let gone = order.removeFirst()
      entries[gone] = nil
    }
    return theme
  }
}

/// The device's own appearance, whatever the window has been told to show.
/// `preferredColorScheme` overrides the window's trait collection, and so
/// SwiftUI's colorScheme, so the system's choice is read from the screen.
@MainActor
enum SystemAppearance {
  static func isDark() -> Bool {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    if let screen = scenes.first?.screen {
      return screen.traitCollection.userInterfaceStyle == .dark
    }
    return UITraitCollection.current.userInterfaceStyle == .dark
  }
}

/// The root of a window: resolves the theme for the preferences in force at
/// this window's width, puts it in the environment, and keeps the
/// preferences told what the device asks for (dark, more contrast) and what
/// time it is (the clock's sky). Also sets the system's colour scheme, so
/// the status bar, the keyboard and the system's controls match the page,
/// and the tint, so a system control picks up the accent.
public struct VirgaThemeRoot<Content: View>: View {
  @Environment(PreferencesModel.self) private var preferences
  @Environment(\.colorScheme) private var shownScheme
  @Environment(\.colorSchemeContrast) private var contrast
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.scenePhase) private var scenePhase
  @State private var cache = ThemeCache()
  private let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    GeometryReader { proxy in
      themed(width: proxy.size.width + proxy.safeAreaInsets.leading + proxy.safeAreaInsets.trailing)
    }
    .onAppear { lookAtDevice() }
    .onChange(of: shownScheme) { _, _ in lookAtDevice() }
    .onChange(of: contrast, initial: true) { _, value in
      let more = value == .increased
      if preferences.systemMoreContrast != more { preferences.systemMoreContrast = more }
    }
    .onChange(of: scenePhase) { _, phase in
      guard phase == .active else { return }
      lookAtDevice()
      preferences.lookAtClock()
    }
    .task { await everyMinute() }
  }

  private func themed(width: CGFloat) -> some View {
    let attributes = preferences.rootAttributes
    let measured = width > 0 ? width : 390
    let tokens = cache.resolve(attributes, width: Double(measured))
    let theme = VirgaTheme(
      tokens: tokens, attributes: attributes, windowWidth: measured, reduceMotion: reduceMotion, dynamicTypeSize: dynamicTypeSize)
    let system: ColorScheme = preferences.systemDark ? .dark : .light
    // Only override the window when the page's scheme isn't the device's:
    // otherwise SwiftUI's colorScheme stays the device's, and a change to it
    // reaches lookAtDevice() at once.
    let override: ColorScheme? = theme.colorScheme == system ? nil : theme.colorScheme
    return content
      .environment(\.virgaTheme, theme)
      .tint(theme.accent)
      .background(PageGround().ignoresSafeArea())
      .preferredColorScheme(override)
  }

  /// `matchMedia('(prefers-color-scheme: dark)')`, read again.
  private func lookAtDevice() {
    let dark = SystemAppearance.isDark()
    if preferences.systemDark != dark { preferences.systemDark = dark }
  }

  /// The web's useSkyHour: a look at the clock each minute (and at the
  /// device's appearance, which can change at sunset without the app
  /// leaving the screen).
  private func everyMinute() async {
    while !Task.isCancelled {
      try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
      if Task.isCancelled { return }
      lookAtDevice()
      if preferences.watchesClock { preferences.lookAtClock() }
    }
  }
}

/// The window's own ground, under every page: the top of the sky above the
/// middle (so a page pulled down past its top shows sky, not ground) and the
/// page's ground below it.
struct PageGround: View {
  @Environment(\.virgaTheme) private var theme

  var body: some View {
    VStack(spacing: 0) {
      theme.skyTop
      theme.bg
    }
  }
}
#endif
