// Ports src/styles/base.css (h1 { text-wrap: balance })
//
// A title whose CSS line-height is shorter than the face's own 1.22em (the
// front page's `.landing-title` at 1.02; a page's `.page-title` and the
// others WrappingTitle draws, at 1.1 or 1.05), set on more than one line. A Text can't set its lines closer than the
// face's own (`.lineSpacing` stops at 0), so the title's words are set
// here, one view each: every line's box is the browser's, the word's own
// line centred on it (its half-leading), the glyphs reaching past it above
// and below as they do there.

#if canImport(UIKit)
import SwiftUI

/// The title's words, wrapped where a browser wraps them, a line every
/// `pitch`. A heading's lines are balanced (base.css's `h1 { text-wrap:
/// balance }`): as many as the width needs, broken at the narrowest width
/// that still needs no more, so "Your account, / in figures." rather than
/// "Your account, in / figures.". A word wider than the line by itself is
/// offered the line's width, so one that can wrap does so there (its own
/// lines at the face's spacing) rather than run past the edge.
struct TitleLines: Layout {
  /// From one line's top to the next's: the line-height, in points.
  var pitch: CGFloat
  /// Between two words on a line.
  var space: CGFloat

  private struct Line {
    var indices: [Int] = []
    var width: CGFloat = 0
  }

  /// Whether a title's words can be set here. They go left to right, so a
  /// title with letters written right to left (Hebrew, Arabic and the
  /// scripts near them, as a dashboard's name may be) stays a Text, which
  /// orders its words itself.
  static func canSet(_ words: String) -> Bool {
    !words.unicodeScalars.contains { scalar in
      switch scalar.value {
      case 0x0590...0x08FF, 0xFB1D...0xFDFF, 0xFE70...0xFEFF, 0x10800...0x10FFF, 0x1E800...0x1EFFF: return true
      default: return false
      }
    }
  }

  /// A word as it is set at a width: what it is offered, its size, and the
  /// height of its one line (of its first, when it wraps).
  private struct Word {
    var proposal: ProposedViewSize
    var size: CGSize
    var line: CGFloat
  }

  private func words(_ subviews: Subviews, maxWidth: CGFloat) -> [Word] {
    subviews.map { subview -> Word in
      let one = subview.sizeThatFits(.unspecified)
      guard one.width > maxWidth else { return Word(proposal: .unspecified, size: one, line: one.height) }
      let proposal = ProposedViewSize(width: maxWidth, height: nil)
      return Word(proposal: proposal, size: subview.sizeThatFits(proposal), line: one.height)
    }
  }

  private func lines(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    var out: [Line] = []
    var line = Line()
    for (index, size) in sizes.enumerated() {
      let extra = line.indices.isEmpty ? size.width : space + size.width
      if !line.indices.isEmpty && line.width + extra > maxWidth {
        out.append(line)
        line = Line(indices: [index], width: size.width)
      } else {
        line.indices.append(index)
        line.width += extra
      }
    }
    if !line.indices.isEmpty { out.append(line) }
    return out
  }

  /// The lines at `maxWidth`, balanced: wrapped at the narrowest width a
  /// line of the words can have (a run of them, as wide as it is set) that
  /// takes no more lines than `maxWidth` does.
  private func balanced(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    let greedy = lines(sizes, maxWidth: maxWidth)
    guard greedy.count > 1 else { return greedy }
    var widths: [CGFloat] = []
    for start in sizes.indices {
      var width: CGFloat = 0
      for end in start..<sizes.count {
        width += end == start ? sizes[end].width : space + sizes[end].width
        if width <= maxWidth { widths.append(width) }
      }
    }
    for width in widths.sorted() where lines(sizes, maxWidth: width).count <= greedy.count {
      return lines(sizes, maxWidth: width)
    }
    return greedy
  }

  /// A line's height: the pitch, and what a word that wrapped adds under it.
  private func height(of line: Line, _ set: [Word]) -> CGFloat {
    let below = line.indices.map { set[$0].size.height - set[$0].line }.max() ?? 0
    return pitch + max(0, below)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    let set = words(subviews, maxWidth: maxWidth)
    let rows = balanced(set.map(\.size), maxWidth: maxWidth)
    var height: CGFloat = 0
    for row in rows {
      height += self.height(of: row, set)
    }
    return CGSize(width: rows.map(\.width).max() ?? 0, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let maxWidth = max(bounds.width, proposal.width ?? 0)
    let set = words(subviews, maxWidth: maxWidth)
    var top = bounds.minY
    for row in balanced(set.map(\.size), maxWidth: maxWidth) {
      var x = bounds.minX
      for index in row.indices {
        let word = set[index]
        subviews[index].place(at: CGPoint(x: x, y: top + (pitch - word.line) / 2), proposal: word.proposal)
        x += word.size.width + space
      }
      top += height(of: row, set)
    }
  }
}
#endif
