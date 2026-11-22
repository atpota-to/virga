// Ports src/styles/controls.css (.table, .table-scroll)
// Ports src/charts/charts.css (.an-tableview .table, .an-tableview-scroll)
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
// the column's start. Given the table's head apart, it holds the head over
// the rows as they scroll (`thead th { position: sticky }`), the head and
// the rows each a DataTable `part:` that keeps the other's cells at no
// height, both laid out at the one width TableScroll gives them, so the two
// grids' columns come out the same. A chart's table (`.an-tableview
// .table`, `chart:`) has its head 8 from the top and each row's first cell
// is the row's head (`<th scope="row">`: --ink-2, 400, one line); none of
// its cells wraps or is cut short, so each column is at least as wide as
// its words, sharing out any room the table has beyond them.

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

/// Which of a table's parts a DataTable draws: all of it, or its head or
/// its rows alone (TableScroll's held head), the other's cells kept at no
/// height so the columns are as wide as the whole table's.
public enum DataTablePart: Sendable {
  case whole, head, rows
}

public struct DataTable: View {
  @Environment(\.virgaTheme) private var theme
  private let columns: [DataTableColumn]
  private let rows: [[String]]
  private let selected: Int?
  private let part: DataTablePart
  private let chart: Bool

  /// - Parameters:
  ///   - part: the whole table, or its head or rows for TableScroll's held head.
  ///   - chart: a chart's table (`.an-tableview .table`): the head 8 from
  ///     the top, each row's first cell its head in --ink-2 on one line.
  public init(columns: [DataTableColumn], rows: [[String]], selected: Int? = nil, part: DataTablePart = .whole, chart: Bool = false) {
    self.columns = columns
    self.rows = rows
    self.selected = selected
    self.part = part
    self.chart = chart
  }

  public var body: some View {
    if part == .whole {
      // The column's width when it fits; otherwise it scrolls in its own row.
      ViewThatFits(in: .horizontal) {
        grid
        ScrollView(.horizontal, showsIndicators: false) {
          grid.fixedSize(horizontal: true, vertical: false)
        }
      }
    } else {
      // TableScroll's held head and its rows: each at the one width
      // TableScroll gives them both, inside its one sideways scroll, so
      // the two grids share their columns out alike (`thead` and `tbody`
      // of one table). A scroll of their own would set them apart.
      TableGridWidth { grid }
    }
  }

  private var grid: some View {
      Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
            cell(column.title, index: index, head: true, chosen: false)
          }
        }
        if part != .rows {
          rule(ThemeKit.tableHeadRule)
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
          GridRow {
            ForEach(Array(columns.indices), id: \.self) { c in
              cell(c < row.count ? row[c] : "", index: c, head: false, chosen: selected == r, row: row)
            }
          }
          if part != .head {
            rule(ThemeKit.tableRowRule)
          }
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
    // A chart's table: the row's head (`tbody th`), in --ink-2 on one line.
    let rowHead = chart && first && !head
    let shown = part == .whole || (part == .head) == head
    return Text(text)
      .virgaText(head ? .textSm : .textBase, weight: head ? ThemeKit.tableHeadWeight : VirgaWeight.regular, lineBox: true)
      .foregroundStyle(head ? theme.muted : rowHead ? theme.ink2 : theme.ink)
      .lineLimit(head || rowHead ? 1 : nil)
      // A chart's table keeps every cell at its words' width
      // (`.an-tableview .table th { white-space: nowrap }`; its values are
      // single numbers, which don't break): no column is narrower than its
      // words, and the table scrolls sideways when they need more room.
      .fixedSize(horizontal: chart, vertical: false)
      .padding(.top, head ? (chart ? Measure.Chart.tableHeadSpaceAbove : 0) : padding.top)
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
      .modifier(TableCellReading(label: first ? row.map { rowLabel($0) } : nil, hidden: head || !first, chosen: chosen))
      .modifier(TablePartCell(shown: shown))
      .gridColumnAlignment(numeric ? .trailing : .leading)
  }
}

/// A held head's grid, or its rows', at the width TableScroll gives it: the
/// columns share out whatever the table has beyond their words. When it has
/// no more than that (a table as wide as its columns, scrolling sideways),
/// each column is laid out at its own width, as a share would have to leave
/// it anyway; and so it is too, at the start of the width, if a share would
/// leave a later column narrower than its words. The head and the rows hold
/// the same cells, so they come to the same columns.
struct TableGridWidth: Layout {
  /// A width this close to the columns' own is theirs (rounding).
  private static let slack: CGFloat = 0.5

  private func fitted(_ proposal: ProposedViewSize, _ grid: LayoutSubview) -> ProposedViewSize {
    let own = ProposedViewSize(width: nil, height: proposal.height)
    guard let width = proposal.width,
      width > grid.sizeThatFits(.unspecified).width + Self.slack,
      grid.sizeThatFits(proposal).width <= width + Self.slack
    else { return own }
    return proposal
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let grid = subviews.first else { return .zero }
    let size = grid.sizeThatFits(fitted(proposal, grid))
    return CGSize(width: max(proposal.width ?? 0, size.width), height: size.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let grid = subviews.first else { return }
    grid.place(at: bounds.origin, anchor: .topLeading, proposal: fitted(proposal, grid))
  }
}

/// A cell of the part a DataTable isn't drawing: as wide as it would be,
/// at no height, unseen and unread.
struct TablePartCell: ViewModifier {
  let shown: Bool

  func body(content: Content) -> some View {
    if shown {
      content
    } else {
      content
        .frame(height: 0)
        .clipped()
        .hidden()
        .accessibilityHidden(true)
    }
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
/// and at the column's start when it is narrower than the column. Given a
/// `head`, the head stays put over the rows as they scroll up and down, and
/// goes sideways with them.
public struct TableScroll<Head: View, Content: View>: View {
  @State private var viewport: CGFloat = 0
  private let maxHeight: CGFloat?
  private let head: Head?
  private let content: Content

  /// A table with its head held: `head` is the table's head part
  /// (`DataTable(part: .head)`), `content` its rows (`part: .rows`).
  public init(maxHeight: CGFloat? = nil, @ViewBuilder head: () -> Head, @ViewBuilder content: () -> Content) {
    self.maxHeight = maxHeight
    self.head = head()
    self.content = content()
  }

  public var body: some View {
    let least = min(viewport, Measure.Chart.tableMinWidth)
    Group {
      if let head {
        ScrollView(.horizontal, showsIndicators: false) {
          TableWidthLayout(minWidth: least, fill: viewport) {
            VStack(alignment: .leading, spacing: 0) {
              head
              TableRowsHeight(limit: maxHeight) {
                ScrollView(.vertical) {
                  content
                }
                .scrollBounceBehavior(.basedOnSize)
              }
            }
          }
        }
      } else {
        ScrollView([.vertical, .horizontal]) {
          TableWidthLayout(minWidth: least, fill: viewport) {
            content
          }
        }
        .frame(maxHeight: maxHeight)
      }
    }
    .background {
      GeometryReader { geometry in
        Color.clear
          .onAppear { viewport = geometry.size.width }
          .onChange(of: geometry.size.width) { _, width in viewport = width }
      }
    }
  }
}

extension TableScroll where Head == EmptyView {
  /// A table that scrolls as one, its head with its rows.
  public init(maxHeight: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.maxHeight = maxHeight
    self.head = nil
    self.content = content()
  }
}

/// `max-height: 20rem` under a held head: the rows at their own height, up
/// to `limit`, scrolling inside past it.
struct TableRowsHeight: Layout {
  var limit: CGFloat?

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let rows = subviews.first else { return .zero }
    let ideal = rows.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    let height = limit.map { min(ideal.height, $0) } ?? ideal.height
    return CGSize(width: proposal.width ?? ideal.width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for rows in subviews {
      rows.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
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
