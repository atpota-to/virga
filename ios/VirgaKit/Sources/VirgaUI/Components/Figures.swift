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

/// `.figures`: the grid of cells, columns worked out from its width.
struct FiguresLayout: Layout {
  var columnGap: CGFloat
  var rowGap: CGFloat
  var minWidth: CGFloat
  var phone: Bool

  func columns(_ width: CGFloat, count: Int) -> Int {
    if phone { return min(2, max(1, count)) }
    let fit = Int((width + columnGap) / (minWidth + columnGap))
    return max(1, min(count, fit))
  }

  func frames(_ width: CGFloat, subviews: Subviews) -> [CGRect] {
    let count = subviews.count
    let cols = columns(width, count: count)
    let cellWidth = (width - columnGap * CGFloat(cols - 1)) / CGFloat(cols)
    var out: [CGRect] = []
    var y: CGFloat = 0
    var index = 0
    while index < count {
      let rowCount = min(cols, count - index)
      // An odd one out at the end of a phone's rows takes the whole row.
      let span = phone && rowCount == 1 && cols == 2
      var heights: [CGFloat] = []
      for i in 0..<rowCount {
        let w = span ? width : cellWidth
        heights.append(subviews[index + i].sizeThatFits(ProposedViewSize(width: w, height: nil)).height)
      }
      let rowHeight = heights.max() ?? 0
      for i in 0..<rowCount {
        let x = CGFloat(i) * (cellWidth + columnGap)
        out.append(CGRect(x: x, y: y, width: span ? width : cellWidth, height: rowHeight))
      }
      y += rowHeight + rowGap
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
      columnGap: phone ? theme.points(ThemeKit.phoneFiguresColumnGap) : gap.column, rowGap: gap.row, minWidth: minWidth, phone: phone
    ) {
      ForEach(shown) { item in
        FigureCell(item: item, phone: phone)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label ?? "")
  }
}

struct FigureCell: View {
  @Environment(\.virgaTheme) private var theme
  let item: FigureItem
  let phone: Bool

  var body: some View {
    let rule = ThemeKit.figureCellRule
    let padding = phone ? ThemeKit.phoneFigureCellPadding : ThemeKit.figureCellPadding
    let valueSize = theme.points(ThemeKit.figureValueFontSize)
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.figureCellGap)) {
      Text(item.label)
        .virgaText(size: theme.points(ThemeKit.figureLabelFontSize), weight: ThemeKit.figureLabelWeight)
        .foregroundStyle(theme.color(ThemeKit.figureLabelInk))
      Text(item.shown ?? "")
        .virgaText(size: valueSize, weight: ThemeKit.figureValueWeight, tracking: ThemeKit.figureValueTracking)
        .foregroundStyle(theme.ink)
        .minimumScaleFactor(0.5)
        .lineLimit(1)
      if let note = item.note {
        note
          .virgaText(size: theme.points(ThemeKit.figureNoteFontSize), lineHeight: ThemeKit.figureNoteLineHeight)
          .foregroundStyle(theme.muted)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(.top, theme.points(padding.top))
    .overlay(alignment: .top) {
      Rectangle().fill(theme.color(rule)).frame(height: theme.points(rule))
    }
    .accessibilityElement(children: .combine)
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
