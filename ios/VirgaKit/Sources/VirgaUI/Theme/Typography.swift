// Ports src/styles/base.css (the type: the face, tabular figures, the body's size and line)
//
// One typeface, Instrument Sans (SIL OFL; Resources/Fonts holds it and its
// licence), in three weights from its variable wght axis: 400 to read, 500
// for a label, 600 for a heading or a thing that is on
// (ThemeTokens.fontWeights). Numbers are in its tabular figures everywhere
// (ThemeKit.bodyNumerals), so the font is made with the tnum feature on.
// Monospace is for identifiers only, at 0.92em (ThemeKit.codeFontSize).
//
// The font is registered at launch from Bundle.module
// (CTFontManagerRegisterFontsForURL). If that fails the system font stands
// in, with the same sizes and weights.
//
// The sizes are the type scale's tokens (theme.textBase and the rest),
// scaled by Dynamic Type as a browser scales them by its text size:
// UIFontMetrics for the text style each size stands in for, which is what
// Font.custom(_:size:relativeTo:) does. The font is built from a CoreText
// descriptor rather than Font.custom, because only a descriptor's variation
// sets the wght axis exactly; SwiftUI's .weight() on a custom variable font
// isn't sure to reach it.

#if canImport(UIKit)
import CoreText
import SwiftUI
import UIKit
import VirgaCore

/// Instrument Sans: registered once, then made at any size and weight.
public enum VirgaTypeface {
  /// The variable font's PostScript name (its default instance, wght 400).
  public static let postScriptName = "InstrumentSans-Regular"
  /// The `wght` axis tag, as CoreText names axes.
  static let weightAxis = 0x7767_6874

  /// Whether the font is registered and can be drawn with. Registers it the
  /// first time it is asked.
  public static let isRegistered: Bool = register()

  /// Registers the bundled font for this process. Safe to call again.
  @discardableResult
  public static func registerIfNeeded() -> Bool { isRegistered }

  private static func register() -> Bool {
    guard let url = Bundle.module.url(forResource: "InstrumentSans", withExtension: "ttf", subdirectory: "Fonts") else {
      return false
    }
    var error: Unmanaged<CFError>?
    // False with "already registered" when another bundle did it first:
    // the font is there either way, which the probe below checks.
    _ = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
    _ = error?.takeRetainedValue()
    let probe = CTFontCreateWithName(postScriptName as CFString, 12, nil)
    return (CTFontCopyPostScriptName(probe) as String) == postScriptName
  }

  private static let lock = NSLock()
  private static var made: [String: CTFont] = [:]

  /// The face at `size` points and `weight` (400–600), with tabular figures.
  /// Nil when the font isn't registered.
  public static func face(size: CGFloat, weight: Double) -> CTFont? {
    guard isRegistered else { return nil }
    let key = "\(size)|\(weight)"
    lock.lock()
    defer { lock.unlock() }
    if let held = made[key] { return held }
    let features: [[String: Any]] = [
      [
        kCTFontFeatureTypeIdentifierKey as String: kNumberSpacingType,
        kCTFontFeatureSelectorIdentifierKey as String: kMonospacedNumbersSelector,
      ]
    ]
    let attributes: [String: Any] = [
      kCTFontNameAttribute as String: postScriptName,
      kCTFontVariationAttribute as String: [NSNumber(value: weightAxis): NSNumber(value: weight)],
      kCTFontFeatureSettingsAttribute as String: features,
    ]
    let descriptor = CTFontDescriptorCreateWithAttributes(attributes as CFDictionary)
    let font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
    made[key] = font
    return font
  }
}

/// The weights the type uses, by what they are for.
public enum VirgaWeight {
  /// 400: to read.
  public static let regular: Double = ThemeTokens.fontWeights[0]
  /// 500: a label.
  public static let medium: Double = ThemeTokens.fontWeights[1]
  /// 600: a heading, or a thing that is on.
  public static let semibold: Double = ThemeTokens.fontWeights[2]
}

extension VirgaTheme {
  /// The text style a size of the scale scales with under Dynamic Type.
  public static func textStyle(for size: CGFloat) -> UIFont.TextStyle {
    switch size {
    case ..<12.5: return .caption1
    case ..<13.5: return .footnote
    case ..<15.5: return .body
    case ..<19: return .title3
    case ..<25: return .title2
    case ..<32: return .title1
    default: return .largeTitle
    }
  }

  /// A size of the scale, scaled by Dynamic Type for its text style.
  @MainActor
  public func scaled(_ size: CGFloat, relativeTo style: UIFont.TextStyle? = nil) -> CGFloat {
    let traits = UITraitCollection(preferredContentSizeCategory: Self.sizeCategory(dynamicTypeSize))
    return UIFontMetrics(forTextStyle: style ?? Self.textStyle(for: size)).scaledValue(for: size, compatibleWith: traits)
  }

  /// The face at `size` (a token's points, before Dynamic Type) and
  /// `weight`, in tabular figures.
  @MainActor
  public func font(size: CGFloat, weight: Double = VirgaWeight.regular, relativeTo style: UIFont.TextStyle? = nil) -> Font {
    let points = scaled(size, relativeTo: style)
    if hasTypeface, let face = VirgaTypeface.face(size: points, weight: weight) {
      return Font(face)
    }
    return Font.system(size: points, weight: Self.systemWeight(weight)).monospacedDigit()
  }

  /// A type-scale token's face.
  @MainActor
  public func font(_ token: ThemeToken, weight: Double = VirgaWeight.regular) -> Font {
    font(size: points(token), weight: weight)
  }

  /// A kit font size (`var(--text-sm)` and the like) at `weight`.
  @MainActor
  public func font(_ value: ThemeValue, weight: Double = VirgaWeight.regular) -> Font {
    font(size: points(value), weight: weight)
  }

  /// Monospace, for identifiers (NSIDs, DIDs, record names): 0.92 of the
  /// text around it.
  @MainActor
  public func codeFont(around size: CGFloat) -> Font {
    let em = ThemeLengthContext(viewportWidth: Double(windowWidth), fontSize: Double(size))
    let points = CGFloat(ThemeKit.codeFontSize.points(in: em) ?? Double(size))
    return Font.system(size: scaled(points), design: .monospaced)
  }

  /// The space SwiftUI should add between lines for a CSS line-height
  /// (`1.45`), at a size of the scale.
  @MainActor
  public func lineSpacing(size: CGFloat, lineHeight: Double, weight: Double = VirgaWeight.regular) -> CGFloat {
    let points = scaled(size)
    return max(0, points * CGFloat(lineHeight) - naturalLine(points: points, weight: weight))
  }

  /// Half of what a CSS line-height adds to the face's own line (its
  /// half-leading), at a size of the scale: what goes above and below a
  /// line for its box to be as tall as a browser's (`line-height × size`).
  @MainActor
  public func halfLeading(size: CGFloat, lineHeight: Double, weight: Double = VirgaWeight.regular) -> CGFloat {
    lineSpacing(size: size, lineHeight: lineHeight, weight: weight) / 2
  }

  /// The face's own line at `points` (Instrument Sans: 1.22em).
  @MainActor
  func naturalLine(points: CGFloat, weight: Double) -> CGFloat {
    if hasTypeface, let face = VirgaTypeface.face(size: points, weight: weight) {
      return CTFontGetAscent(face) + CTFontGetDescent(face) + CTFontGetLeading(face)
    }
    return points * 1.2
  }

  /// Letter-spacing in em (ThemeKit's tracking), in points at a size.
  @MainActor
  public func tracking(_ em: ThemeLength, size: CGFloat) -> CGFloat {
    let context = ThemeLengthContext(viewportWidth: Double(windowWidth), fontSize: Double(scaled(size)))
    return CGFloat(em.points(in: context) ?? 0)
  }

  /// The width of "0" in the face at `size`: a CSS `ch`.
  @MainActor
  func zeroWidth(size: CGFloat) -> CGFloat {
    let points = scaled(size)
    if hasTypeface, let face = VirgaTypeface.face(size: points, weight: VirgaWeight.regular) {
      // The advance of "0" in the face itself.
      var glyph = CGGlyph(0)
      var zero = UniChar(0x30)
      if CTFontGetGlyphsForCharacters(face, &zero, &glyph, 1) {
        var advance = CGSize.zero
        CTFontGetAdvancesForGlyphs(face, .horizontal, &glyph, &advance, 1)
        return advance.width
      }
    }
    return ("0" as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: points)]).width
  }

  static func systemWeight(_ weight: Double) -> Font.Weight {
    if weight >= 600 { return .semibold }
    if weight >= 500 { return .medium }
    return .regular
  }

  static func sizeCategory(_ size: DynamicTypeSize) -> UIContentSizeCategory {
    switch size {
    case .xSmall: return .extraSmall
    case .small: return .small
    case .medium: return .medium
    case .large: return .large
    case .xLarge: return .extraLarge
    case .xxLarge: return .extraExtraLarge
    case .xxxLarge: return .extraExtraExtraLarge
    case .accessibility1: return .accessibilityMedium
    case .accessibility2: return .accessibilityLarge
    case .accessibility3: return .accessibilityExtraLarge
    case .accessibility4: return .accessibilityExtraExtraLarge
    case .accessibility5: return .accessibilityExtraExtraExtraLarge
    @unknown default: return .large
    }
  }
}

/// Text in the type scale: a size, a weight, a CSS line-height and tracking.
///
/// The line-height is the body's 1.45 (base.css) unless given: a heading
/// passes ThemeKit.headingLineHeight (1.25), a control whose words are one
/// line in a box of its own (a button, a segmented key, a figure's number)
/// passes 1. SwiftUI adds it between lines only, so a single line keeps the
/// face's own 1.22; `lineBox` adds the half-leading above and below as
/// well, for a line whose box's height is what lays it out (a link action,
/// a more link, a meta line, a table's cell), as a browser's line box is.
public struct VirgaTextStyle: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  var size: CGFloat?
  var token: ThemeToken?
  var weight: Double
  var lineHeight: Double?
  var tracking: ThemeLength?
  var lineBox: Bool = false

  public func body(content: Content) -> some View {
    let points = size ?? token.map { theme.points($0) } ?? theme.textBase
    let line = lineHeight ?? ThemeKit.bodyLineHeight
    content
      .font(theme.font(size: points, weight: weight))
      .lineSpacing(theme.lineSpacing(size: points, lineHeight: line, weight: weight))
      .tracking(tracking.map { theme.tracking($0, size: points) } ?? 0)
      .padding(.vertical, lineBox ? theme.halfLeading(size: points, lineHeight: line, weight: weight) : 0)
  }
}

/// A glyph (an SF Symbol) at `size` points, scaled by Dynamic Type as the
/// words beside it are (a browser grows an icon in rem or em with its text;
/// the web's lucide glyphs are px, but on iOS a 13-point eye beside words
/// of 30 reads as a speck).
public struct GlyphFont: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  var size: CGFloat
  var weight: Font.Weight
  var words: CGFloat?

  public func body(content: Content) -> some View {
    let style = VirgaTheme.textStyle(for: words ?? size)
    content.font(.system(size: theme.scaled(size, relativeTo: style), weight: weight))
  }
}

extension View {
  /// An SF Symbol at `size` points (and `weight`), grown with Dynamic Type
  /// as words of `words` points (the glyph's own size by default) are.
  public func virgaGlyph(_ size: CGFloat, weight: Font.Weight = .regular, beside words: CGFloat? = nil) -> some View {
    modifier(GlyphFont(size: size, weight: weight, words: words))
  }

  /// The type scale's `token` (theme.textBase by default) at `weight`, at a
  /// CSS line-height (the body's 1.45 unless given) and tracking when given;
  /// `lineBox` gives a single line the browser's box (its half-leading above
  /// and below).
  public func virgaText(
    _ token: ThemeToken = .textBase, weight: Double = VirgaWeight.regular, lineHeight: Double? = nil, tracking: ThemeLength? = nil,
    lineBox: Bool = false
  ) -> some View {
    modifier(
      VirgaTextStyle(size: nil, token: token, weight: weight, lineHeight: lineHeight, tracking: tracking, lineBox: lineBox))
  }

  /// A size in points (a kit measure already through the theme) at `weight`.
  public func virgaText(
    size: CGFloat, weight: Double = VirgaWeight.regular, lineHeight: Double? = nil, tracking: ThemeLength? = nil,
    lineBox: Bool = false
  ) -> some View {
    modifier(
      VirgaTextStyle(size: size, token: nil, weight: weight, lineHeight: lineHeight, tracking: tracking, lineBox: lineBox))
  }
}
#endif
