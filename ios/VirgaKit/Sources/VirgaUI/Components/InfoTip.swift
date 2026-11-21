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
    Button {
      open.toggle()
    } label: {
      Image(systemName: Glyph.info)
        .font(.system(size: Measure.Section.infoTipIcon))
        .foregroundStyle(open ? theme.ink : theme.muted)
        .frame(width: side, height: side)
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(Circle())
    .accessibilityLabel(label)
    .accessibilityHint(text)
    .popover(isPresented: $open, arrowEdge: .top) {
      Text(text)
        .virgaText(.textSm, lineHeight: ThemeKit.metaLineHeight)
        .foregroundStyle(theme.color(ThemeKit.infoTipInk))
        .fixedSize(horizontal: false, vertical: true)
        .padding(theme.insets(ThemeKit.infoTipPadding))
        .frame(width: theme.points(ThemeKit.infoTipWidth), alignment: .leading)
        .presentationCompactAdaptation(.popover)
        .presentationBackground(theme.color(ThemeKit.infoTipFill))
    }
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
