// Ports src/charts/Heatmap.jsx
// Ports src/charts/charts.css (.heatmap)
//
// A grid of cells shaded on one ramp (--heat-0 for nothing to --heat-6),
// weekdays down the side, hours across. A cell with too little to say is an
// outline, not a zero; the best is ringed in ink. The steps are
// ChartFormat.heatSteps (each value's rank among those above zero). Every
// cell's number is in its title (a pointer's tooltip, and the cell's name to
// VoiceOver when it is reached); `summary`, one sentence on where it peaks,
// is what VoiceOver hears for the whole grid.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore

public struct HeatmapCell: Hashable {
  public var value: Double?
  public var title: String
  public var best: Bool

  public init(value: Double?, title: String, best: Bool = false) {
    self.value = value
    self.title = title
    self.best = best
  }
}

public struct HeatmapRow: Hashable {
  public var label: String
  public var cells: [HeatmapCell]

  public init(label: String, cells: [HeatmapCell]) {
    self.label = label
    self.cells = cells
  }
}

/// An hour's label over `span` columns.
public struct HeatmapColumn: Hashable {
  public var label: String
  public var span: Int

  public init(label: String, span: Int = 1) {
    self.label = label
    self.span = span
  }
}

public struct Heatmap: View {
  @Environment(\.virgaTheme) private var theme
  private let rows: [HeatmapRow]
  private let columns: [HeatmapColumn]
  private let summary: String
  private let cellHeight: CGFloat
  private let legend: Bool

  public init(rows: [HeatmapRow], columns: [HeatmapColumn], summary: String, cellHeight: CGFloat = Measure.Chart.heatCell, legend: Bool = true) {
    self.rows = rows
    self.columns = columns
    self.summary = summary
    self.cellHeight = cellHeight
    self.legend = legend
  }

  private func fill(_ step: Int) -> Color {
    [theme.heat0, theme.heat1, theme.heat2, theme.heat3, theme.heat4, theme.heat5, theme.heat6][Swift.min(6, Swift.max(0, step))]
  }

  public var body: some View {
    if !rows.isEmpty {
      let steps = ChartFormat.heatSteps(rows.flatMap { $0.cells.map(\.value) })
      VStack(alignment: .leading, spacing: Measure.Chart.heatLegendSpace) {
        Grid(horizontalSpacing: Measure.Chart.heatGap, verticalSpacing: Measure.Chart.heatGap) {
          ForEach(rows, id: \.label) { row in
            GridRow {
              Text(row.label)
                .virgaText(size: Measure.Chart.labelSize)
                .foregroundStyle(theme.muted)
                .frame(width: Measure.Chart.heatDay, alignment: .leading)
              ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                cellView(cell, step: steps[cell.value])
              }
            }
          }
          GridRow {
            Color.clear.frame(width: Measure.Chart.heatDay, height: 1)
            ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
              Text(column.label)
                .virgaText(size: Measure.Chart.labelSize)
                .foregroundStyle(theme.muted)
                .lineLimit(1)
                .fixedSize()
                .frame(maxWidth: .infinity, alignment: .leading)
                .gridCellColumns(Swift.max(1, column.span))
            }
          }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
        if legend {
          HStack(spacing: Measure.Chart.heatLegendGap) {
            Text("Less")
            ForEach(0..<7, id: \.self) { step in
              RoundedRectangle(cornerRadius: Measure.Chart.heatLegendRadius)
                .fill(fill(step))
                .frame(width: Measure.Chart.heatLegendCell.width, height: Measure.Chart.heatLegendCell.height)
            }
            Text("More")
          }
          .virgaText(size: Measure.Chart.labelSize)
          .foregroundStyle(theme.muted)
          .accessibilityHidden(true)
        }
      }
    }
  }

  private func cellView(_ cell: HeatmapCell, step: Int?) -> some View {
    let shape = RoundedRectangle(cornerRadius: Measure.Chart.heatRadius)
    return shape
      .fill(step.map(fill) ?? Color.clear)
      .overlay {
        if step == nil {
          shape.strokeBorder(theme.line, lineWidth: 1)
        } else if cell.best {
          shape.strokeBorder(theme.ink, lineWidth: 2)
        }
      }
      .frame(maxWidth: .infinity)
      .frame(height: cellHeight)
      .help(cell.title)
  }
}
#endif
