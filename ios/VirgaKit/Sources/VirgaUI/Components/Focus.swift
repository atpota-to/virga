// Ports src/styles/base.css (:focus-visible)
// Ports src/styles/theme.css (high contrast's focus outline)
//
// Keyboard focus (an iPad with a keyboard), as base.css draws it: an
// outline of 2 points of --focus-ring, 2 points outside the control
// (ThemeKit.focusOutline, focusOutlineOffset), 3 points in high contrast
// (ThemeKit.highContrastFocusOutlineWidth). A Segmented's key and anything in
// a row that scrolls sideways draws it 2 points inside instead, so the row's
// clipping can't cut it off. The system's own focus effect is turned off
// where this is drawn. A field draws its focus as a shadow ring instead
// (Field.swift).

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// Where the outline sits: outside the control, or inside it.
public enum FocusPlacement: Sendable {
  case outside, inside
}

struct FocusOutline<S: InsettableShape>: ViewModifier {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.isFocused) private var isFocused
  let shape: S
  let placement: FocusPlacement

  func body(content: Content) -> some View {
    let width = theme.isHighContrast ? theme.points(ThemeKit.highContrastFocusOutlineWidth) : theme.points(ThemeKit.focusOutline)
    let offset = theme.points(ThemeKit.focusOutlineOffset)
    let reach = placement == .outside ? offset + width : -offset
    content
      .focusEffectDisabled()
      .overlay {
        if isFocused {
          shape
            .inset(by: -reach)
            .strokeBorder(theme.color(ThemeKit.focusOutline), lineWidth: width)
            .allowsHitTesting(false)
        }
      }
  }
}

extension View {
  /// base.css's focus outline round `shape`, drawn when keyboard focus is here.
  public func virgaFocusOutline<S: InsettableShape>(_ shape: S, placement: FocusPlacement = .outside) -> some View {
    modifier(FocusOutline(shape: shape, placement: placement))
  }
}
#endif
