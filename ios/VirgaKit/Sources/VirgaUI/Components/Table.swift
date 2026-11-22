// Ports src/styles/controls.css (.table, .table-scroll)
//
// A table (every chart's Show as table): no sides, its first and last
// columns on the section's own edges; an ink rule under the head (muted,
// 500, small), hairlines between rows, numbers right-aligned; a chosen row
// tinted with --accent-tint, let out 10 points past the sides. A Grid, in a
// row that scrolls sideways when it is wider than the column. VoiceOver
// reads a row as one element, each value with its column's head ("Day: Nov
// 18, Followers: 4,802"), as a screen reader reads a <table>'s cells.
//
// TableScroll is `.an-tableview-scroll` round a chart's table: it scrolls
// both ways inside its own height, the table at least as wide as the
// column or 28rem, whichever is less (`min-width: min(100%, 28rem)`), at
// the column's start.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct DataTableColumn: Identifiable {
  public var id: String { title }
  public var title: String
  /// `.is-num`: right-aligned.
  public var numeric: Bool

  public init(_ title: String, numeric: Bool = false) {
    self.title = title
    self.numeric = numeric
  }
}

public struct DataTable: View {
  @Environment(\.virgaTheme) private var theme
  private let columns: [DataTableColumn]
  private let rows: [[String]]
  private let selected: Int?

  public init(columns: [DataTableColumn], rows: [[String]], selected: Int? = nil) {
    self.columns = columns
    self.rows = rows
    self.selected = selected
  }

  public var body: some View {
    // The column's width when it fits; otherwise it scrolls in its own row.
    ViewThatFits(in: .horizontal) {
      grid
      ScrollView(.horizontal, showsIndicators: false) {
        grid.fixedSize(horizontal: true, vertical: false)
      }
    }
  }

  private var grid: some View {
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
            cell(column.title, index: index, head: true, chosen: false)
          }
        }
        rule(ThemeKit.tableHeadRule)
        ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
          GridRow {
            ForEach(Array(columns.indices), id: \.self) { c in
              cell(c < row.count ? row[c] : "", index: c, head: false, chosen: selected == r, row: row)
            }
          }
          rule(ThemeKit.tableRowRule)
        }
      }
  }

  private func rule(_ border: ThemeBorder) -> some View {
    Rectangle().fill(theme.color(border)).frame(height: theme.points(border)).gridCellUnsizedAxes(.horizontal)
  }

  /// A body row as VoiceOver reads it: each value after its column's head.
  private func rowLabel(_ row: [String]) -> String {
    columns.indices
      .map { c in "\(columns[c].title): \(c < row.count ? row[c] : "")" }
      .joined(separator: ", ")
  }

  private func cell(_ text: String, index: Int, head: Bool, chosen: Bool, row: [String]? = nil) -> some View {
    let padding = theme.insets(ThemeKit.tableCellPadding)
    let numeric = columns[index].numeric
    let bleed = Measure.Section.selectedRowBleed
    let first = index == 0
    let last = index == columns.count - 1
    return Text(text)
      .virgaText(head ? .textSm : .textBase, weight: head ? ThemeKit.tableHeadWeight : VirgaWeight.regular, lineBox: true)
      .foregroundStyle(head ? theme.muted : theme.ink)
      .lineLimit(head ? 1 : nil)
      .padding(.top, head ? 0 : padding.top)
      .padding(.bottom, head ? theme.points(ThemeKit.tableHeadSpaceBelow) : padding.bottom)
      .padding(.leading, first ? 0 : padding.leading)
      .padding(.trailing, last ? 0 : padding.trailing)
      // `vertical-align: middle`, every cell the row's height, so a chosen
      // row's tint has no gaps where one cell wraps.
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: numeric ? .trailing : .leading)
      // A chosen row's tint, let out past the table's sides.
      .background {
        if chosen {
          theme.color(ThemeKit.selectedRowFill)
            .padding(.leading, first ? -bleed : 0)
            .padding(.trailing, last ? -bleed : 0)
        }
      }
      .gridColumnAlignment(numeric ? .trailing : .leading)
      .modifier(TableCellReading(label: first ? row.map(rowLabel) : nil, hidden: head || !first, chosen: chosen))
  }
}

/// How VoiceOver meets a cell: a row's first cell reads the whole row, the
/// others and the head (whose words each row repeats) are passed over.
struct TableCellReading: ViewModifier {
  let label: String?
  let hidden: Bool
  let chosen: Bool

  func body(content: Content) -> some View {
    if let label {
      content
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(chosen ? [.isSelected] : [])
    } else {
      content.accessibilityHidden(hidden)
    }
  }
}

/// `.an-tableview-scroll`: a table that scrolls both ways inside at most
/// `maxHeight`, at least as wide as the column or 28rem, whichever is less,
/// and at the column's start when it is narrower than the column.
public struct TableScroll<Content: View>: View {
  @State private var viewport: CGFloat = 0
  private let maxHeight: CGFloat?
  private let content: Content

  public init(maxHeight: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.maxHeight = maxHeight
    self.content = content()
  }

  public var body: some View {
    ScrollView([.vertical, .horizontal]) {
      TableWidthLayout(minWidth: min(viewport, Measure.Chart.tableMinWidth), fill: viewport) {
        content
      }
    }
    .frame(maxHeight: maxHeight)
    .background {
      GeometryReader { geometry in
        Color.clear
          .onAppear { viewport = geometry.size.width }
          .onChange(of: geometry.size.width) { _, width in viewport = width }
      }
    }
  }
}

/// Lays a table out at its own width or `minWidth`, whichever is more (its
/// columns spread to fill it), at the start of a row at least `fill` wide.
struct TableWidthLayout: Layout {
  var minWidth: CGFloat
  var fill: CGFloat

  private func width(_ table: LayoutSubview) -> CGFloat {
    max(table.sizeThatFits(.unspecified).width, minWidth)
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let table = subviews.first else { return .zero }
    let w = width(table)
    let height = table.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
    return CGSize(width: max(w, fill), height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let table = subviews.first else { return }
    let w = width(table)
    let height = table.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
    table.place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: w, height: height))
  }
}

#Preview("Table") {
  VirgaPreviewHost {
    DataTable(
      columns: [DataTableColumn("Day"), DataTableColumn("Followers", numeric: true), DataTableColumn("Change", numeric: true)],
      rows: [["Nov 18", "4,802", "+3"], ["Nov 19", "4,807", "+5"], ["Nov 20", "4,810", "+3"]],
      selected: 1)
    .padding()
  }
}
#endif
