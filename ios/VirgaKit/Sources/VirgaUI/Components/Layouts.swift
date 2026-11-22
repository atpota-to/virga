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

/// What a sideways row has measured: its width, its content's, and where
/// its chosen item is.
struct RowMeasures: Equatable {
  var viewport: CGFloat
  var whole: CGFloat
  var focus: CGRect?
}

private struct RowFrameKey: PreferenceKey {
  static let defaultValue: CGRect = .zero
  static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
    value = nextValue()
  }
}

/// Where a sideways row's chosen item is, in the row's own space.
private struct RowFocusFrameKey: PreferenceKey {
  static let defaultValue: CGRect? = nil
  static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) {
    value = nextValue() ?? value
  }
}

/// The name of a ScrollRow's own space, in which its items say where they are.
let scrollRowSpace = "scroll-row"

extension View {
  /// Marks this item of a ScrollRow as the one to bring into view (the
  /// pressed key, `[aria-pressed='true']`) when `isChosen`.
  public func scrollRowFocus(_ isChosen: Bool) -> some View {
    background {
      if isChosen {
        GeometryReader { geometry in
          Color.clear.preference(key: RowFocusFrameKey.self, value: geometry.frame(in: .named(scrollRowSpace)))
        }
      }
    }
  }
}

/// `.scroll-row`: one line that scrolls sideways when it doesn't fit,
/// without a scroll bar, fading the edges with more behind them. `focus`
/// (an item's id, given with `.id(_:)` inside, and marked with
/// `.scrollRowFocus(true)`) is brought into view when the row appears, as
/// useOverflowEdge does: only when it is under the fade, and only far
/// enough to clear it by 24 points.
public struct ScrollRow<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  @State private var viewport: CGFloat = 0
  @State private var whole: CGFloat = 0
  @State private var focusFrame: CGRect?
  @State private var brought = false
  @State private var edges = OverflowEdges()
  private let focus: AnyHashable?
  private let content: Content
  private let space = scrollRowSpace

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
        if whole != frame.width { whole = frame.width }
      }
      .onPreferenceChange(RowFocusFrameKey.self) { frame in
        if focusFrame != frame { focusFrame = frame }
      }
      .onChange(of: RowMeasures(viewport: viewport, whole: whole, focus: focusFrame), initial: true) { _, _ in
        bring(proxy)
      }
      .mask(fade)
    }
  }

  /// useOverflowEdge on mount: with the row at its start, a chosen item
  /// whose end is under the far fade is scrolled to end 24 points short of
  /// the row's edge; one already clear of it stays where it is.
  private func bring(_ proxy: ScrollViewProxy) {
    guard !brought, let focus, let frame = focusFrame, viewport > 0, whole > 0 else { return }
    brought = true
    let spare = Measure.Segmented.spare
    guard whole > viewport, frame.maxX > viewport - spare else { return }
    let room = viewport - frame.width
    guard room > 0 else {
      proxy.scrollTo(focus, anchor: .leading)
      return
    }
    // scrollTo lines the item's point at `x` of its width up with the same
    // point of the row's: its end lands `spare` short of the row's end.
    let x = min(1, max(0, (viewport - spare - frame.width) / room))
    proxy.scrollTo(focus, anchor: UnitPoint(x: x, y: 0.5))
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
