// Ports src/components/Figures.jsx
// Ports src/components/Delta.jsx
// Ports src/styles/controls.css (.figures, .delta)
//
// A row of figures, each under a 2-point rule in --line: its label (--ink-2,
// 500, small), the number (--figure-size, 500, tracking −0.04em, line 1),
// and a note (muted, small). Four or five to a row on a wide screen (each
// at least 168 wide, 128 when there are exactly five), two on a phone, an
// odd last one taking the whole row. Numbers get the active locale's
// separators (AppLocale.formatNumber, the web's toLocaleString(activeLocale())),
// anything else prints as given, and a missing value is skipped.
//
// DeltaView is a change against the window before: the figure in ink, 600,
// with its sign, no colour (which way it went, not whether that is good:
// more blocks is "up" too). Its words are VirgaArchive's ChartFormat.deltaText
// (charts/format.js): "+8.6%", "−12%", "0%", or "new" with nothing to
// compare against. A caller with no comparison at all draws none.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

/// One figure: `{ key, value, label, note? }`.
public struct FigureItem: Identifiable {
  public enum Value {
    case number(Double)
    case text(String)
  }

  public var key: String
  public var label: String
  public var value: Value?
  public var note: AnyView?

  public var id: String { key }

  public init(key: String? = nil, label: String, value: Value?, note: AnyView? = nil) {
    self.key = key ?? label
    self.label = label
    self.value = value
    self.note = note
  }

  var shown: String? {
    switch value {
    case .number(let n)?: return AppLocale.formatNumber(n)
    case .text(let t)?: return t.isEmpty ? nil : t
    case nil: return nil
    }
  }
}

/// `.figures`: the grid of cells, columns worked out from its width. Its
/// subviews come in threes, a cell's label (under its rule), number and
/// note, and each line of cells shares those three rows (the stylesheet's
/// subgrid): a label that takes two lines in one cell doesn't leave its
/// number lower than its neighbour's.
struct FiguresLayout: Layout {
  var columnGap: CGFloat
  var rowGap: CGFloat
  /// Between a cell's label, number and note (`row-gap: 8px`).
  var partGap: CGFloat
  var minWidth: CGFloat
  var phone: Bool

  func columns(_ width: CGFloat, count: Int) -> Int {
    if phone { return min(2, max(1, count)) }
    let fit = Int((width + columnGap) / (minWidth + columnGap))
    return max(1, min(count, fit))
  }

  func frames(_ width: CGFloat, subviews: Subviews) -> [CGRect] {
    let count = subviews.count / 3
    guard count > 0 else { return [] }
    let cols = columns(width, count: count)
    let cellWidth = (width - columnGap * CGFloat(cols - 1)) / CGFloat(cols)
    var out: [CGRect] = []
    var y: CGFloat = 0
    var index = 0
    while index < count {
      let rowCount = min(cols, count - index)
      // An odd one out at the end of a phone's rows takes the whole row.
      let span = phone && rowCount == 1 && cols == 2
      let w = span ? width : cellWidth
      // The line's three rows, each as tall as its tallest part.
      var rows: [CGFloat] = [0, 0, 0]
      for i in 0..<rowCount {
        for part in 0..<3 {
          let height = subviews[(index + i) * 3 + part].sizeThatFits(ProposedViewSize(width: w, height: nil)).height
          rows[part] = max(rows[part], height)
        }
      }
      for i in 0..<rowCount {
        let x = CGFloat(i) * (cellWidth + columnGap)
        var top = y
        for part in 0..<3 {
          out.append(CGRect(x: x, y: top, width: w, height: rows[part]))
          top += rows[part] + partGap
        }
      }
      y += rows[0] + rows[1] + rows[2] + partGap * 2 + rowGap
      index += rowCount
    }
    return out
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 600
    let frames = frames(width, subviews: subviews)
    return CGSize(width: width, height: frames.map(\.maxY).max() ?? 0)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for (index, frame) in frames(bounds.width, subviews: subviews).enumerated() {
      subviews[index].place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(width: frame.width, height: frame.height))
    }
  }
}

public struct FiguresView: View {
  @Environment(\.virgaTheme) private var theme
  private let items: [FigureItem]
  private let label: String?

  /// - Parameter label: the row's name, for VoiceOver.
  public init(_ items: [FigureItem], label: String? = nil) {
    self.items = items
    self.label = label
  }

  public var body: some View {
    let shown = items.filter { $0.shown != nil }
    let phone = theme.isPhone
    let gap = theme.gap(ThemeKit.figuresGap)
    let minWidth: CGFloat = shown.count == 5 ? Measure.Figures.fiveMinWidth : Measure.Figures.minWidth
    FiguresLayout(
      columnGap: phone ? theme.points(ThemeKit.phoneFiguresColumnGap) : gap.column, rowGap: gap.row,
      partGap: theme.points(ThemeKit.figureCellGap), minWidth: minWidth, phone: phone
    ) {
      ForEach(shown) { item in
        FigureLabelPart(item: item, phone: phone)
        FigureValuePart(item: item)
        FigureNotePart(item: item)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label ?? "")
  }
}

/// A cell's top: its 2-point rule, the padding under it, and its label.
struct FigureLabelPart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem
  let phone: Bool

  var body: some View {
    let rule = ThemeKit.figureCellRule
    let padding = phone ? ThemeKit.phoneFigureCellPadding : ThemeKit.figureCellPadding
    Text(item.label)
      .virgaText(size: theme.points(ThemeKit.figureLabelFontSize), weight: ThemeKit.figureLabelWeight)
      .foregroundStyle(theme.color(ThemeKit.figureLabelInk))
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, theme.points(padding.top))
      .overlay(alignment: .top) {
        Rectangle().fill(theme.color(rule)).frame(height: theme.points(rule))
      }
      // Read with its number (FigureValuePart).
      .accessibilityHidden(true)
  }
}

/// The number: --figure-size at line height 1, wrapping anywhere rather
/// than shrinking (`overflow-wrap: anywhere`).
struct FigureValuePart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem

  var body: some View {
    let size = theme.points(ThemeKit.figureValueFontSize)
    let weight = ThemeKit.figureValueWeight
    Text(item.shown ?? "")
      .virgaText(size: size, weight: weight, lineHeight: ThemeKit.figureValueLineHeight, tracking: ThemeKit.figureValueTracking)
      // Line height 1: the box is the figure's size, its glyphs reaching
      // past it as a browser's do.
      .padding(.vertical, theme.overflowingLeading(size: size, lineHeight: ThemeKit.figureValueLineHeight, weight: weight))
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(item.label)
      .accessibilityValue(item.shown ?? "")
  }
}

/// The note, muted and small at 1.35, or nothing.
struct FigureNotePart: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem

  var body: some View {
    if let note = item.note {
      note
        .virgaText(size: theme.points(ThemeKit.figureNoteFontSize), lineHeight: ThemeKit.figureNoteLineHeight)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      Color.clear.frame(height: 0)
    }
  }
}

/// A figure's note: a change, a faint dot, and the words about it, as one
/// line of text ("+8.6% · 583 the 30 days before"), so in a narrow cell its
/// words wrap one at a time after the change. The dot belongs to the change
/// (4 after it, 6 before the words), so a wrapped note never starts with it.
/// `delta`: nil for no change shown, `.some(nil)` for "new".
public struct FigureNote: View {
  @Environment(\.virgaTheme) private var theme
  private let delta: Double??
  private let deltaTitle: String?
  private let words: String?

  /// - Parameters:
  ///   - deltaTitle: what the change is against, read by VoiceOver as a hint.
  public init(delta: Double??, deltaTitle: String? = nil, words: String? = nil) {
    self.delta = delta
    self.deltaTitle = deltaTitle
    self.words = words
  }

  public var body: some View {
    line
      .accessibilityHint(deltaTitle ?? "")
  }

  private var line: Text {
    let size = theme.points(ThemeKit.figureNoteFontSize)
    var out = Text("")
    if let delta {
      out = Text(ChartFormat.deltaText(delta))
        .font(theme.font(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight))
        .foregroundStyle(theme.ink)
      if words != nil {
        // `.delta:not(:last-child)::after { content: '·'; margin: 0 6px 0 4px;
        // color: var(--faint); font-weight: 400 }`
        let dot = Text("·").font(theme.font(size: theme.points(ThemeKit.deltaFontSize))).foregroundStyle(theme.faint)
        out = out + space(Measure.Figures.noteDotBefore, size: size)
        out = out + dot
        out = out + space(Measure.Figures.noteDotAfter, size: size)
      }
    }
    if let words {
      out = out + Text(words).foregroundStyle(theme.muted)
    }
    return out
  }

  /// A space whose advance is `points`: the face's own space, kerned. It is
  /// a no-break space, as the web's margins are no break at all: the change,
  /// its dot and the first word stay on one line, and the words after wrap.
  private func space(_ points: CGFloat, size: CGFloat) -> Text {
    Text("\u{00A0}")
      .font(theme.font(size: size))
      .kerning(points - theme.spaceWidth(size: size))
  }
}

/// `.delta`: the change in ink, 600, with its sign. `plain` takes the size
/// of the words around it.
public struct DeltaView: View {
  @Environment(\.virgaTheme) private var theme
  private let pct: Double?
  private let title: String?
  private let plain: Bool

  /// - Parameters:
  ///   - pct: the change in percent, or nil for "new" (nothing before).
  ///   - title: what it was compared with, read by VoiceOver as a hint.
  public init(pct: Double?, title: String? = nil, plain: Bool = false) {
    self.pct = pct
    self.title = title
    self.plain = plain
  }

  public var body: some View {
    let label = Text(ChartFormat.deltaText(pct)).foregroundStyle(theme.ink).lineLimit(1)
    if plain {
      label.fontWeight(.semibold)
        .accessibilityHint(title ?? "")
    } else {
      label
        .virgaText(size: theme.points(ThemeKit.deltaFontSize), weight: ThemeKit.deltaWeight)
        .accessibilityHint(title ?? "")
    }
  }
}

#Preview("Figures") {
  VirgaPreviewHost {
    FiguresView(
      [
        FigureItem(label: "Followers", value: .number(4810), note: AnyView(DeltaView(pct: 8.6))),
        FigureItem(label: "Posts", value: .number(1031)),
        FigureItem(label: "Engagement rate", value: .text("3.2%")),
      ], label: "This period")
    .padding()
  }
}
#endif
