// Ports src/styles/controls.css (.table, .table-scroll)
//
// A table (every chart's Show as table): no sides, its first and last
// columns on the section's own edges; an ink rule under the head (muted,
// 500, small), hairlines between rows, numbers right-aligned; a chosen row
// tinted with --accent-tint, let out 10 points past the sides. A Grid, in a
// row that scrolls sideways when it is wider than the column.

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
        rule(theme.color(ThemeKit.tableHeadRule))
        ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
          GridRow {
            ForEach(Array(columns.indices), id: \.self) { c in
              cell(c < row.count ? row[c] : "", index: c, head: false, chosen: selected == r)
            }
          }
          rule(theme.color(ThemeKit.tableRowRule))
        }
      }
  }

  private func rule(_ color: Color) -> some View {
    Rectangle().fill(color).frame(height: 1).gridCellUnsizedAxes(.horizontal)
  }

  private func cell(_ text: String, index: Int, head: Bool, chosen: Bool) -> some View {
    let padding = theme.insets(ThemeKit.tableCellPadding)
    let numeric = columns[index].numeric
    let bleed = Measure.Section.selectedRowBleed
    let first = index == 0
    let last = index == columns.count - 1
    return Text(text)
      .virgaText(head ? .textSm : .textBase, weight: head ? ThemeKit.tableHeadWeight : VirgaWeight.regular)
      .foregroundStyle(head ? theme.muted : theme.ink)
      .lineLimit(head ? 1 : nil)
      .padding(.top, head ? 0 : padding.top)
      .padding(.bottom, head ? theme.points(ThemeKit.tableHeadSpaceBelow) : padding.bottom)
      .padding(.leading, first ? 0 : padding.leading)
      .padding(.trailing, last ? 0 : padding.trailing)
      .frame(maxWidth: .infinity, alignment: numeric ? .trailing : .leading)
      // A chosen row's tint, let out past the table's sides.
      .background {
        if chosen {
          theme.color(ThemeKit.selectedRowFill)
            .padding(.leading, first ? -bleed : 0)
            .padding(.trailing, last ? -bleed : 0)
        }
      }
      .gridColumnAlignment(numeric ? .trailing : .leading)
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
