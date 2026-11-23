// Ports src/components/InfoTip.jsx
// Ports src/styles/controls.css (.info-tip)
//
// A small (i) beside a number that explains it. A press shows the
// explanation in a popover in ink (--btn) with the page's colour written on
// it, up to 280 wide (min(280px, 100vw - 32px)), and another press or one
// anywhere else puts it away. The text is the button's hint as well, so
// VoiceOver reads it without opening it.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct InfoTip: View {
  @Environment(\.virgaTheme) private var theme
  @State private var open = false
  private let label: String
  private let text: String

  /// - Parameters:
  ///   - label: the button's name ("What this means").
  ///   - text: the explanation.
  public init(label: String = "What this means", _ text: String) {
    self.label = label
    self.text = text
  }

  public var body: some View {
    let side = theme.points(ThemeKit.touchInfoTipButtonSize)
    // Drawn and focused at 32, pressed through 44, and laid out as the
    // touch block's `margin: -8px -6px` leaves it (20 × 16), so the line it
    // sits in keeps its height and the (i) stays close to its number.
    Button {
      open.toggle()
    } label: {
      Image(systemName: Glyph.info)
        .virgaGlyph(Measure.Section.infoTipIcon)
        .foregroundStyle(open ? theme.ink : theme.muted)
        .frame(width: side, height: side)
        .contentShape(Circle().inset(by: -max(0, (Measure.Touch.target - side) / 2)))
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(Circle())
    .accessibilityLabel(label)
    .accessibilityHint(text)
    .popover(isPresented: $open, arrowEdge: .top) {
      Text(text)
        .virgaText(.textSm, lineHeight: Measure.Section.infoTipLineHeight)
        .foregroundStyle(theme.color(ThemeKit.infoTipInk))
        .fixedSize(horizontal: false, vertical: true)
        .padding(theme.insets(ThemeKit.infoTipPadding))
        .frame(width: theme.points(ThemeKit.infoTipWidth), alignment: .leading)
        .presentationCompactAdaptation(.popover)
        .presentationBackground(theme.color(ThemeKit.infoTipFill))
    }
    .padding(.horizontal, -Measure.Section.infoTipLetOut.width)
    .padding(.vertical, -Measure.Section.infoTipLetOut.height)
  }
}

/// `FollowerCountTip({ profileCount, listed })`: why the profile's follower
/// counter and the listable count differ.
public struct FollowerCountTip: View {
  private let profileCount: Double
  private let listed: Double

  public init(profileCount: Double, listed: Double) {
    self.profileCount = profileCount
    self.listed = listed
  }

  public var body: some View {
    InfoTip(
      label: "Why there are two follower counts",
      "\(AppLocale.formatNumber(profileCount)) is Bluesky’s own counter, the number on your profile. It still counts accounts that were deactivated, suspended or deleted, and it can lag. \(AppLocale.formatNumber(listed)) is everyone who can be listed right now, which is what the charts and reports count."
    )
  }
}

#Preview("Info tip") {
  VirgaPreviewHost {
    HStack {
      Text("4,810")
      InfoTip(label: "Why there are two follower counts", "Bluesky’s own counter still counts accounts that were deactivated.")
    }
    .padding()
  }
}
#endif
