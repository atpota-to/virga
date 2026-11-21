// Ports src/styles/controls.css (its transitions)
// Ports src/styles/base.css (prefers-reduced-motion)
//
// The motion table (DESIGN.md, Motion), each from the kit's own transition
// or animation in ThemeKit, so a duration changed in the stylesheet changes
// here:
//
//   a control's colour and edge         0.12 s, ease
//   a switch's knob; a chevron          0.15 s, the knob on --ease
//   a menu's scrim                      0.16 s, --ease
//   a phone's menu sheet rising         0.2 s, --ease
//   a progress bar filling              0.3 s, ease
//   an indeterminate progress bar       1.2 s for ever, ease-in-out
//   the first "restoring" message       0.4 s after 0.5 s, ease
//
// With Reduce Motion none of it moves: every one is nil (the web cuts every
// transition to 0.01 ms), so `.animation(theme.motion.control, value:)`
// changes at once.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct VirgaMotion: Sendable {
  /// Reduce Motion: nothing moves.
  public var reduced: Bool
  /// `--ease`: cubic-bezier(0.2, 0.8, 0.2, 1).
  public var ease: ThemeCubicBezier

  public init(reduced: Bool, ease: ThemeCubicBezier) {
    self.reduced = reduced
    self.ease = ease
  }

  /// The curve a kit easing names: a CSS keyword, `var(--ease)` or a
  /// cubic-bezier().
  public func curve(_ easing: ThemeValue) -> ThemeCubicBezier {
    switch easing {
    case .cubicBezier(let curve): return curve
    case .variable(.ease): return ease
    case .keyword(let name): return ThemeCubicBezier.keyword(name) ?? ThemeCubicBezier(0.25, 0.1, 0.25, 1)
    default: return ThemeCubicBezier(0.25, 0.1, 0.25, 1)
    }
  }

  func timing(_ easing: ThemeValue, duration: Double) -> Animation {
    let c = curve(easing)
    return Animation.timingCurve(c.x1, c.y1, c.x2, c.y2, duration: duration)
  }

  /// A CSS transition (the first of a list, which share one duration).
  public func animation(_ transitions: [ThemeTransition]) -> Animation? {
    guard !reduced, let first = transitions.first else { return nil }
    return timing(first.easing, duration: first.duration).delay(first.delay)
  }

  /// A CSS animation, repeated for ever when it says `infinite`.
  public func animation(_ animation: ThemeAnimation) -> Animation? {
    guard !reduced else { return nil }
    let base = timing(animation.easing, duration: animation.duration).delay(animation.delay)
    return animation.infinite ? base.repeatForever(autoreverses: false) : base
  }

  /// A control's colour and edge: a button, a chip, a field, a key.
  public var control: Animation? { animation(ThemeKit.buttonTransition) }
  /// A switch's ground.
  public var switchFill: Animation? { animation(ThemeKit.switchTransition) }
  /// A switch's knob, on --ease.
  public var knob: Animation? { animation(ThemeKit.switchKnobTransition) }
  /// A disclosure's chevron.
  public var chevron: Animation? { animation(ThemeKit.disclosureTransition) }
  /// A menu's scrim.
  public var scrim: Animation? { animation(ThemeKit.menuScrimAnimation) }
  /// A phone's menu sheet rising.
  public var sheet: Animation? { animation(ThemeKit.menuSheetAnimation) }
  /// A progress bar filling.
  public var progressFill: Animation? { animation(ThemeKit.progressTransition) }
  /// An indeterminate progress bar's slide, for ever.
  public var indeterminate: Animation? { animation(ThemeKit.progressIndeterminateAnimation) }
  /// The first "restoring" message fading in, after its delay.
  public var status: Animation? { animation(ThemeKit.appStatusAnimation) }
}
#endif
