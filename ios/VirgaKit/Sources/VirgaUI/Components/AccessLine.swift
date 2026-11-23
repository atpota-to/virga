// Ports src/components/AccessBadge.jsx
// Ports src/styles/controls.css (.access-item)
//
// The access line: what a page or a tool can touch, as muted words with an
// icon each, one after another ("✎ Can post and delete posts · ⛁ Uses
// Virga’s server"), on a meta line. Writing is said a little louder than
// reading (post, follow: --ink-2, 500); asking for a new permission is a
// warning. `kinds` are keys of AccessBadge.access (VirgaInsights, the web's
// ACCESS); one it doesn't know is skipped. `prefix` goes before the first
// item's words ("Not built yet.").

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

public struct AccessLine: View {
  @Environment(\.virgaTheme) private var theme
  private let kinds: [String]
  private let prefix: String?

  public init(_ kinds: [String], prefix: String? = nil) {
    self.kinds = kinds
    self.prefix = prefix
  }

  public var body: some View {
    let shown = kinds.filter { AccessBadge.access[$0] != nil }
    let size = theme.points(ThemeKit.metaFontSize)
    FlowLayout(spacing: 0, lineSpacing: 0) {
      ForEach(Array(shown.enumerated()), id: \.element) { index, kind in
        AccessItemView(
          kind: kind, entry: AccessBadge.access[kind]!, prefix: index == 0 ? prefix : nil, size: size, isLast: index == shown.count - 1)
      }
    }
  }
}

struct AccessItemView: View {
  @Environment(\.virgaTheme) private var theme
  let kind: String
  let entry: AccessKind
  let prefix: String?
  let size: CGFloat
  let isLast: Bool

  var body: some View {
    let louder = kind == "post" || kind == "follow"
    let ink: Color = entry.tone == "warn" ? theme.warn : (louder ? theme.ink2 : theme.muted)
    let words = prefix.map { "\($0) \(entry.label)" } ?? entry.label
    // As a meta line's item: inline-flex, 5 apart, the dot one of its flex
    // items with 1 more before it (6 from the words) and 6 after.
    HStack(spacing: theme.points(ThemeKit.metaItemGap)) {
      Image(systemName: entry.sfSymbol)
        .virgaGlyph(theme.points(ThemeKit.metaIconSize), beside: size)
        .accessibilityHidden(true)
      Text(words)
        .virgaText(
          size: size, weight: louder ? VirgaWeight.medium : VirgaWeight.regular, lineHeight: ThemeKit.metaLineHeight, lineBox: true)
      if !isLast {
        Text("·")
          .virgaText(size: size, lineHeight: ThemeKit.metaLineHeight, lineBox: true)
          .foregroundStyle(theme.color(ThemeKit.metaInk))
          .padding(.leading, theme.points(ThemeKit.metaDotMargin.left))
          .padding(.trailing, theme.points(ThemeKit.metaDotMargin.right))
          .accessibilityHidden(true)
      }
    }
    .foregroundStyle(ink)
  }
}

#Preview("Access line") {
  VirgaPreviewHost {
    AccessLine(["post", "server", "ask"])
      .padding()
  }
}
#endif
