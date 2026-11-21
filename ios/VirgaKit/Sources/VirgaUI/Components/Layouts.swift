// Ports src/styles/controls.css (.scroll-row, and the flex-wrap rows: .meta, .tokens)
// Ports src/components/Segmented.jsx (useOverflowEdge)
//
// Two layouts the kit leans on. FlowLayout is CSS's `display: flex;
// flex-wrap: wrap`: a row that wraps onto more lines (a meta line, a row of
// tokens, the links under a sign-in step). ScrollRow is `.scroll-row`: a row
// that never wraps, scrolling sideways without a scroll bar when it doesn't
// fit, its edges faded where there is more behind them (useOverflowEdge,
// ThemeKit.scrollFadeWidth), and bringing a chosen item into view.
//
// Also the shell's navigation as an environment action (`navigate`), so a
// component that goes somewhere (a more link, a link in a document) needs
// nothing but the address.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// A wrapping row: items left to right, onto the next line when the line is
/// full, `spacing` between items and `lineSpacing` between lines.
public struct FlowLayout: Layout {
  public var spacing: CGFloat
  public var lineSpacing: CGFloat
  public var alignment: VerticalAlignment

  public init(spacing: CGFloat = 8, lineSpacing: CGFloat = 8, alignment: VerticalAlignment = .center) {
    self.spacing = spacing
    self.lineSpacing = lineSpacing
    self.alignment = alignment
  }

  struct Line {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  func lines(_ sizes: [CGSize], maxWidth: CGFloat) -> [Line] {
    var out: [Line] = []
    var line = Line()
    for (index, size) in sizes.enumerated() {
      let extra = line.indices.isEmpty ? size.width : spacing + size.width
      if !line.indices.isEmpty && line.width + extra > maxWidth {
        out.append(line)
        line = Line()
        line.indices = [index]
        line.width = size.width
        line.height = size.height
      } else {
        line.indices.append(index)
        line.width += extra
        line.height = max(line.height, size.height)
      }
    }
    if !line.indices.isEmpty { out.append(line) }
    return out
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let maxWidth = proposal.width ?? .infinity
    let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil)) }
    let rows = lines(sizes, maxWidth: maxWidth)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, rows.count - 1))
    return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
  }

  public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)) }
    var y = bounds.minY
    for line in lines(sizes, maxWidth: bounds.width) {
      var x = bounds.minX
      for index in line.indices {
        let size = sizes[index]
        let dy: CGFloat
        switch alignment {
        case .top: dy = 0
        case .bottom: dy = line.height - size.height
        default: dy = (line.height - size.height) / 2
        }
        subviews[index].place(at: CGPoint(x: x, y: y + dy), proposal: ProposedViewSize(width: size.width, height: size.height))
        x += size.width + spacing
      }
      y += line.height + lineSpacing
    }
  }
}

/// Which edges of a sideways row have more behind them.
struct OverflowEdges: Equatable {
  var start = false
  var end = false
}

private struct RowFrameKey: PreferenceKey {
  static let defaultValue: CGRect = .zero
  static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
    value = nextValue()
  }
}

/// `.scroll-row`: one line that scrolls sideways when it doesn't fit,
/// without a scroll bar, fading the edges with more behind them. `focus`
/// (an item's id, given with `.id(_:)` inside) is brought into view, clear
/// of the fade, when the row appears.
public struct ScrollRow<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  @State private var viewport: CGFloat = 0
  @State private var edges = OverflowEdges()
  private let focus: AnyHashable?
  private let content: Content
  private let space = "scroll-row"

  public init(focus: AnyHashable? = nil, @ViewBuilder content: () -> Content) {
    self.focus = focus
    self.content = content()
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal, showsIndicators: false) {
        content
          .background(
            GeometryReader { geometry in
              Color.clear.preference(key: RowFrameKey.self, value: geometry.frame(in: .named(space)))
            }
          )
      }
      .coordinateSpace(name: space)
      .background(
        GeometryReader { geometry in
          Color.clear
            .onAppear { viewport = geometry.size.width }
            .onChange(of: geometry.size.width) { _, width in viewport = width }
        }
      )
      .onPreferenceChange(RowFrameKey.self) { frame in
        let next = OverflowEdges(start: frame.minX < -1, end: frame.maxX > viewport + 1)
        if next != edges { edges = next }
      }
      .mask(fade)
      .onAppear {
        if let focus { proxy.scrollTo(focus, anchor: .center) }
      }
    }
  }

  /// ThemeKit.scrollFadeWidth: black from 24 points in, at the edges with more.
  private var fade: some View {
    let width = theme.points(ThemeKit.scrollFadeWidth.stops[1].position ?? .px(0))
    return HStack(spacing: 0) {
      LinearGradient(colors: [Color.black.opacity(edges.start ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing)
        .frame(width: width)
      Color.black
      LinearGradient(colors: [.black, Color.black.opacity(edges.end ? 0 : 1)], startPoint: .leading, endPoint: .trailing)
        .frame(width: width)
    }
  }
}

/// The shell's navigation: go to an address (`/reports/followers`).
public struct NavigateAction {
  let go: @MainActor (String) -> Void

  public init(_ go: @escaping @MainActor (String) -> Void) {
    self.go = go
  }

  @MainActor
  public func callAsFunction(_ address: String) {
    go(address)
  }
}

private struct NavigateKey: EnvironmentKey {
  static let defaultValue = NavigateAction { _ in }
}

extension EnvironmentValues {
  /// Goes to an address in the shell (ShellNavigator sets it).
  public var navigate: NavigateAction {
    get { self[NavigateKey.self] }
    set { self[NavigateKey.self] = newValue }
  }
}
#endif
