// Ports src/styles/base.css (h1 { text-wrap: balance })
//
// A heading whose line-height is under the face's own 1.22em and that can
// wrap: a page's `.page-title` and the first build's `.first-run-title`
// (1.1), the return and terms screens' `.return-title` (1.1), a legal
// page's `.legal-h1` (1.05). All of them are h1s, so their lines balance.
//
// On one line it is a Text whose box is the browser's line, the glyphs
// reaching past it above and below (overflowingLeading). Once it no longer
// fits, its words are set by TitleLines, a line every line-height and
// balanced as the web's h1 is, and it takes the whole row, as the web's
// block does (and a page title's flex item, once it wraps), so whatever
// follows it on the row sits at the row's end. A title with letters
// written right to left stays a Text when it wraps, since TitleLines
// places words left to right: its lines are then the face's own 1.22
// apart and greedy, but it takes the row all the same. Either way
// VoiceOver reads it as one heading.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

struct WrappingTitle: View {
  @Environment(\.virgaTheme) private var theme
  private let words: String
  private let size: CGFloat
  private let weight: Double
  private let lineHeight: Double
  private let tracking: ThemeLength
  private let identifier: String

  /// - Parameters:
  ///   - size: the title's size in points before Dynamic Type (a token's,
  ///     or a kit measure through the theme).
  ///   - lineHeight: its CSS line-height, under the face's 1.22.
  ///   - identifier: the heading's accessibility identifier.
  init(
    _ words: String, size: CGFloat, weight: Double = VirgaWeight.semibold, lineHeight: Double, tracking: ThemeLength,
    identifier: String
  ) {
    self.words = words
    self.size = size
    self.weight = weight
    self.lineHeight = lineHeight
    self.tracking = tracking
    self.identifier = identifier
  }

  var body: some View {
    if TitleLines.canSet(words) {
      ViewThatFits(in: .horizontal) {
        text
        lines
      }
    } else {
      ViewThatFits(in: .horizontal) {
        text
        text.frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var text: some View {
    Text(words)
      .virgaText(size: size, weight: weight, lineHeight: lineHeight, tracking: tracking)
      // The line is shorter than the face's own: its box is the
      // browser's, the glyphs reaching past it as a browser's do.
      .padding(.vertical, theme.overflowingLeading(size: size, lineHeight: lineHeight, weight: weight))
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier(identifier)
  }

  private var lines: some View {
    TitleLines(
      pitch: theme.scaled(size) * CGFloat(lineHeight),
      // A space at the title's weight, and the letter-spacing a browser
      // puts after it too.
      space: theme.spaceWidth(size: size, weight: weight) + theme.tracking(tracking, size: size)
    ) {
      ForEach(Array(words.split(separator: " ").enumerated()), id: \.offset) { _, word in
        Text(String(word))
          .virgaText(size: size, weight: weight, lineHeight: lineHeight, tracking: tracking)
      }
    }
    .foregroundStyle(theme.ink)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(words)
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier(identifier)
    // The row's width, the lines at its start; VoiceOver's heading stays
    // the size of the words.
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
#endif
