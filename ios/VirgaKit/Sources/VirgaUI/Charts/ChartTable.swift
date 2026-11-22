// Ports src/charts/ChartTable.jsx
// Ports src/charts/charts.css (.an-tableview)
// Ports src/styles/controls.css (.chart-foot)
//
// Every chart's plain twin: the same buckets as a table, opened from the
// line under the chart ("Show as table", a link action), so no value is
// reachable only by a press on the chart. The line also carries the
// chart's other actions after it, each a finger's 44 points tall with its
// words in the middle and no gap between wrapped lines (controls.css's
// touch rules), which is already the room the table wants under the line.
// Newest first; the trend's column takes the name the chart's legend gives
// it ("7-day average"). The table sits at the column's leading edge, as wide
// as its columns need and at least min(100%, 28rem); it keeps to 320 points
// and scrolls inside, under its head, which stays put; it scrolls sideways
// in its own box when its columns need more room than the page.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

/// `.chart-foot` with "Show as table", then `actions`; the table under it.
public struct ShowAsTable<Actions: View, Table: View>: View {
  @Environment(\.virgaTheme) private var theme
  @State private var open = false
  private let actions: Actions
  private let trailing: AnyView?
  private let table: Table

  /// - Parameter trailing: a ⋯ at the line's end (a phone's, holding what
  ///   `actions` would say in words), its dots on the column's edge.
  public init(@ViewBuilder actions: () -> Actions, trailing: AnyView? = nil, @ViewBuilder table: () -> Table) {
    self.actions = actions()
    self.trailing = trailing
    self.table = table()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: theme.gap(ThemeKit.chartFootGap).column) {
        FlowLayout(spacing: theme.gap(ThemeKit.chartFootGap).column, lineSpacing: 0) {
          Button {
            open.toggle()
          } label: {
            Label("Show as table", systemImage: Glyph.table)
          }
          .buttonStyle(.linkAction(isOpen: open))
          .modifier(ChartFootAction())
          .accessibilityValue(open ? "Open" : "Closed")
          .accessibilityIdentifier("show-as-table")
          Group { actions }
            .modifier(ChartFootAction())
        }
        if let trailing {
          Spacer(minLength: 0)
          trailing.padding(.trailing, -Measure.Chart.footMenuBleed)
        }
      }
      .padding(.top, theme.points(ThemeKit.chartFootSpaceAbove))
      if open {
        // On touch the line's 44 points already leave the room under it.
        table
      }
    }
  }
}

/// `.chart-foot .link-action` on touch: 44 points tall, its words in the
/// middle, pressed anywhere in that height.
struct ChartFootAction: ViewModifier {
  func body(content: Content) -> some View {
    content
      .frame(minHeight: Measure.Touch.target)
      .contentShape(Rectangle())
  }
}

extension ShowAsTable where Actions == EmptyView {
  public init(trailing: AnyView? = nil, @ViewBuilder table: () -> Table) {
    self.init(actions: { EmptyView() }, trailing: trailing, table: table)
  }
}

public struct ChartTable<Actions: View>: View {
  private let series: [ChartPoint]
  private let secondary: [ChartPoint]?
  private let trend: [ChartPoint]?
  private let unit: AnalyticsUnit
  private let valueHead: String
  private let secondaryHead: String?
  private let format: (Double?) -> String
  private let trendFormat: (Double?) -> String
  private let actions: Actions
  private let trailing: AnyView?

  /// - Parameters:
  ///   - format: nil is `fmtCount` (and the trend's averages keep their
  ///     decimal, as in the chart's readout).
  ///   - trailing: a ⋯ at the end of the line under the chart.
  public init(
    series: [ChartPoint], secondary: [ChartPoint]? = nil, trend: [ChartPoint]? = nil, unit: AnalyticsUnit, valueHead: String,
    secondaryHead: String? = nil, format: ((Double?) -> String)? = nil, trailing: AnyView? = nil, @ViewBuilder actions: () -> Actions
  ) {
    self.trailing = trailing
    self.series = series
    self.secondary = secondary
    self.trend = trend
    self.unit = unit
    self.valueHead = valueHead
    self.secondaryHead = secondaryHead
    self.format = format ?? { ChartFormat.fmtCount($0) }
    self.trendFormat = format ?? { ChartFormat.fmtAverage($0) }
    self.actions = actions()
  }

  public var body: some View {
    if !series.isEmpty {
      ShowAsTable(actions: { actions }, trailing: trailing) {
        ChartTableView(columns: columns, rows: rows)
      }
    }
  }

  private var columns: [DataTableColumn] {
    var out = [DataTableColumn(unit == .month ? "Month" : unit == .week ? "Week" : "Day"), DataTableColumn(valueHead, numeric: true)]
    if secondary != nil { out.append(DataTableColumn(secondaryHead ?? "Compared series", numeric: true)) }
    if let trend {
      out.append(
        DataTableColumn(
          ChartFormat.trendName(series.map(\.seriesPoint), trend.map { TrendPoint(t: $0.t, v: $0.v) }, unit), numeric: true))
    }
    return out
  }

  private var rows: [[String]] {
    series.indices.reversed().map { i in
      var row = [Analytics.bucketLabel(series[i].t, unit), format(series[i].v)]
      if let secondary { row.append(ChartFormat.fmtCount(secondary.indices.contains(i) ? secondary[i].v ?? 0 : 0)) }
      if let trend {
        let v = trend.indices.contains(i) ? trend[i].v : nil
        row.append(v == nil ? "—" : trendFormat(v))
      }
      return row
    }
  }
}

extension ChartTable where Actions == EmptyView {
  public init(
    series: [ChartPoint], secondary: [ChartPoint]? = nil, trend: [ChartPoint]? = nil, unit: AnalyticsUnit, valueHead: String,
    secondaryHead: String? = nil, format: ((Double?) -> String)? = nil, trailing: AnyView? = nil
  ) {
    self.init(
      series: series, secondary: secondary, trend: trend, unit: unit, valueHead: valueHead, secondaryHead: secondaryHead,
      format: format, trailing: trailing, actions: { EmptyView() })
  }
}

/// `.an-tableview .table`: the kit's table (no sides, an ink rule under the
/// head, hairlines between rows, numbers right-aligned, a row's head in
/// --ink-2), its head held over the rows as they scroll. The head and the
/// rows are two grids that each hold every row, the other's drawn at no
/// height, so their columns come out the same.
struct ChartTableView: View {
  @Environment(\.virgaTheme) private var theme
  let columns: [DataTableColumn]
  let rows: [[String]]
  @State private var available: CGFloat = 0

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      TableWidth(least: min(available, Measure.Chart.tableFullMinWidth)) {
        VStack(alignment: .leading, spacing: 0) {
          grid(head: true)
          MaxHeight(limit: Measure.Chart.tableMaxHeight) {
            ScrollView(.vertical) {
              grid(head: false)
            }
            .scrollBounceBehavior(.basedOnSize)
          }
        }
      }
      .frame(minWidth: available, alignment: .leading)
    }
    .background(
      GeometryReader { geometry in
        Color.clear
          .onAppear { available = geometry.size.width }
          .onChange(of: geometry.size.width) { _, width in available = width }
      }
    )
    .accessibilityIdentifier("chart-table")
  }

  private func grid(head: Bool) -> some View {
    Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
      GridRow {
        ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
          shown(cell(column.title, index: index, head: true), head)
        }
      }
      if head {
        rule(theme.color(ThemeKit.tableHeadRule))
      }
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        GridRow {
          ForEach(Array(columns.indices), id: \.self) { c in
            shown(cell(c < row.count ? row[c] : "", index: c, head: false), !head)
          }
        }
        if !head {
          rule(theme.color(ThemeKit.tableRowRule))
        }
      }
    }
  }

  /// A cell drawn, or kept at no height for its width alone.
  @ViewBuilder
  private func shown(_ cell: some View, _ visible: Bool) -> some View {
    if visible {
      cell
    } else {
      cell.frame(height: 0).clipped().hidden().accessibilityHidden(true)
    }
  }

  private func rule(_ color: Color) -> some View {
    Rectangle().fill(color).frame(height: 1).gridCellUnsizedAxes(.horizontal)
  }

  private func cell(_ text: String, index: Int, head: Bool) -> some View {
    let padding = theme.insets(ThemeKit.tableCellPadding)
    let numeric = columns[index].numeric
    let first = index == 0
    let last = index == columns.count - 1
    return Text(text)
      .virgaText(head ? .textSm : .textBase, weight: head ? ThemeKit.tableHeadWeight : VirgaWeight.regular)
      .foregroundStyle(head ? theme.muted : first ? theme.ink2 : theme.ink)
      .lineLimit(1)
      .fixedSize(horizontal: true, vertical: false)
      .padding(.top, head ? Measure.Chart.tableHeadSpaceAbove : padding.top)
      .padding(.bottom, head ? theme.points(ThemeKit.tableHeadSpaceBelow) : padding.bottom)
      .padding(.leading, first ? 0 : padding.leading)
      .padding(.trailing, last ? 0 : padding.trailing)
      .frame(maxWidth: .infinity, alignment: numeric ? .trailing : .leading)
      .gridColumnAlignment(numeric ? .trailing : .leading)
  }
}

/// `width: auto; min-width: min(100%, 28rem)`: the table at its columns'
/// own width, and at least `least`.
struct TableWidth: Layout {
  var least: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let child = subviews.first else { return .zero }
    let ideal = child.sizeThatFits(ProposedViewSize(width: nil, height: proposal.height))
    let width = max(ideal.width, least)
    let size = child.sizeThatFits(ProposedViewSize(width: width, height: proposal.height))
    return CGSize(width: width, height: size.height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for child in subviews {
      child.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
  }
}

/// `max-height: 20rem`: the rows at their own height, up to `limit`, and
/// scrolling inside past it.
struct MaxHeight: Layout {
  var limit: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let child = subviews.first else { return .zero }
    let ideal = child.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
    return CGSize(width: proposal.width ?? ideal.width, height: min(ideal.height, limit))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    for child in subviews {
      child.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
  }
}
#endif
