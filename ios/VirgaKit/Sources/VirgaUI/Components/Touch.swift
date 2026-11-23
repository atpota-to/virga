// Ports src/styles/controls.css (the touch block: "Fingers get more to press")
//
// Every iPhone and iPad is `pointer: coarse`, so the touch block's sizes are
// the sizes: a medium control 40 tall, a small one 32 that is pressed through
// 44, a ghost icon 44 square, a field's words 16, a Segmented's keys and a
// menu's items 44. The controls take those from ThemeKit (touch…); this is
// how a control is given more to press than it shows.

#if canImport(UIKit)
import SwiftUI

extension View {
  /// Pressed through `horizontal` and `vertical` points past its edges,
  /// without looking or laying out any bigger (the touch block's ::after).
  public func touchReach(horizontal: CGFloat, vertical: CGFloat) -> some View {
    self
      .padding(.horizontal, horizontal)
      .padding(.vertical, vertical)
      .contentShape(Rectangle())
      .padding(.horizontal, -horizontal)
      .padding(.vertical, -vertical)
  }

  /// At least 44 points to press each way, the control drawn at its own
  /// size in the middle.
  public func touchTarget(_ size: CGFloat = Measure.Touch.target) -> some View {
    frame(minWidth: size, minHeight: size)
      .contentShape(Rectangle())
  }
}
#endif
