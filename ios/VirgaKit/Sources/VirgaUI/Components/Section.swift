// Ports src/styles/controls.css (.card, .card-head, .card-title, .card-sub, .card--flush, .card-caption, .card-foot, .row-actions)
//
// A section (`.card`, though it has no box) is a heading and what is under
// it. The heading is a title (--text-md, 600) with an optional line under it
// (--muted, small, held to --measure), and at the right at most one thing (a
// more link, one or two link actions, a small Segmented, a few icon tools),
// 16 points to what follows; the title and its line share a column, the
// thing at the right going under them only when that column would be
// narrower than 16rem. On a phone the thing at the right stays on the
// title's line at its own width, the title wrapping in what it leaves, and
// the line under the title runs the full width beneath both; a small
// Segmented goes on a row of its own under that line, and so do tools that
// would leave the title less room than its longest word. A section that is
// a list or a table (`flush`) has a rule in ink under its heading, which is
// the top of its first row. A caption sits 12 under it; under a list, its
// foot ("Show 10 more" first, "12 of 64" at the right).
//
// A row (VirgaRow) of posts or data: --row-pad above and below (the roomier
// --row-pad-lg for a setting, an account or a link elsewhere), a hairline
// under it; a time in its --time-col column for lists led by a time, then
// the words, then the row's actions at the end, centred on its first line.

#if canImport(UIKit)
import SwiftUI
import VirgaCore

public struct SectionHead: View {
  @Environment(\.virgaTheme) private var theme
  /// Whether `trailing` is a small Segmented (it says so), which the
  /// stylesheet places apart from the other tools.
  @State private var segmented = false
  private let title: String
  private let sub: String?
  private let trailing: AnyView?

  public init(_ title: String, sub: String? = nil, trailing: AnyView? = nil) {
    self.title = title
    self.sub = sub
    self.trailing = trailing
  }

  public var body: some View {
    Group {
      if theme.isPhone {
        phone
      } else {
        wide
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// From 561 up: the title and its line in one column, taking what the
  /// tools leave beside them on the title's baseline; the tools go under
  /// the words only when that column would be narrower than 16rem. A
  /// Segmented's 44-point keys reach out 13 above and below, so the title's
  /// line keeps its height.
  private var wide: some View {
    let gap = theme.gap(ThemeKit.cardHeadGap)
    return BesideOrUnder(minLead: Measure.Section.titleMinWidth, columnGap: gap.column, rowGap: gap.row, baseline: true) {
      VStack(alignment: .leading, spacing: theme.points(ThemeKit.cardSubSpaceAbove)) {
        titleText
        subText
      }
      if let trailing {
        tools(trailing)
          .padding(.vertical, segmented ? -Measure.Segmented.headLift : 0)
      }
    }
  }

  /// At 560 and under: the title with what is at its right centred beside
  /// it, the tools at their own width and the title taking what they leave
  /// (`minmax(0, 1fr) auto`, 16 apart), the line under the title across the
  /// whole width beneath both, and a small Segmented on a row of its own
  /// under that, 8 down. Read in the web's order: the title, its line, then
  /// the tools.
  private var phone: some View {
    PhoneHeadLayout(
      columnGap: Measure.Section.phoneHeadGap, subSpaceAbove: theme.points(ThemeKit.cardSubSpaceAbove),
      underSpaceAbove: Measure.Segmented.headSpaceAbove, toolsUnder: segmented
    ) {
      titleText
        .layoutValue(key: PhoneHeadLayout.Role.self, value: .title)
      if let sub {
        subLine(sub)
          .layoutValue(key: PhoneHeadLayout.Role.self, value: .sub)
      }
      if let trailing {
        tools(trailing)
          .layoutValue(key: PhoneHeadLayout.Role.self, value: .tools)
        // The title's words one to a line, in its face, never drawn or
        // read: as wide as its longest word, the least it can wrap in.
        titleFace(Text(PhoneHeadLayout.wordsApart(title)))
          .hidden()
          .accessibilityHidden(true)
          .layoutValue(key: PhoneHeadLayout.Role.self, value: .words)
      }
    }
  }

  private func tools(_ trailing: AnyView) -> some View {
    trailing
      .onPreferenceChange(HoldsSegmentedKey.self) { holds in
        if segmented != holds { segmented = holds }
      }
  }

  private var titleText: some View {
    titleFace(Text(title))
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }

  /// `.card-title`: --text-md at 600, -0.005em, its lines 1.25 apart.
  private func titleFace(_ text: Text) -> some View {
    text.virgaText(
      size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, lineHeight: ThemeKit.headingLineHeight,
      tracking: ThemeKit.cardTitleTracking)
  }

  @ViewBuilder private var subText: some View {
    if let sub {
      subLine(sub)
    }
  }

  private func subLine(_ sub: String) -> some View {
    Text(sub)
      .virgaText(size: theme.points(ThemeKit.cardSubFontSize))
      .foregroundStyle(theme.color(ThemeKit.cardSubInk))
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: theme.measure, alignment: .leading)
  }
}

/// A phone's section heading (`.card-head:has(> :nth-child(2))` at 560 and
/// under): a row of the title and the tools, both centred on it, the tools
/// at their own width and the title wrapping in what they leave; the line
/// under the title across the whole width beneath that row; and the tools
/// on a row of their own under the line instead when they are a small
/// Segmented (`toolsUnder`), or when beside them the title would have less
/// room than its longest word (`words`, the title's words one to a line).
/// Short of that the title wraps by words beside the tools, as the web's
/// does. The web's grid gives the title no least (`minmax(0, 1fr)`, and
/// `.card-title` never breaks a word), so there a word longer than the
/// room runs out of its column and over the tools: Who engaged in a
/// 320-point window, or at the larger Dynamic Type sizes on a 375-point
/// iPhone. Over a Segmented the title keeps the grid's 16 at its right,
/// beside the tools' empty column, and in every case its lines are
/// balanced (`balanced`).
struct PhoneHeadLayout: Layout {
  enum Part {
    case title, sub, tools, words
  }

  /// Which part of the heading a subview is.
  struct Role: LayoutValueKey {
    static let defaultValue = Part.title
  }

  var columnGap: CGFloat
  var subSpaceAbove: CGFloat
  var underSpaceAbove: CGFloat
  var toolsUnder: Bool

  /// A title's words one to a line, broken where a browser may wrap it: at
  /// a space, but not at a no-break space.
  static func wordsApart(_ title: String) -> String {
    title.split { $0.isWhitespace && !"\u{00A0}\u{2007}\u{202F}".contains($0) }.joined(separator: "\n")
  }

  /// The title in `width`, its lines balanced as base.css's `h2 {
  /// text-wrap: balance }` balances them: as many as `width` needs, broken
  /// at the narrowest width (to half a point) that needs no more, so "What
  /// a typical post earns, / by when it was posted" rather than its last
  /// word on a line of its own.
  static func balanced(_ title: LayoutSubview, in width: CGFloat?) -> CGSize {
    let size = title.sizeThatFits(ProposedViewSize(width: width, height: nil))
    guard let width, width.isFinite, size.height > title.sizeThatFits(.unspecified).height + 0.5 else { return size }
    var narrow: CGFloat = 0
    var wide = width
    while wide - narrow > 0.5 {
      let middle = (narrow + wide) / 2
      if title.sizeThatFits(ProposedViewSize(width: middle, height: nil)).height > size.height + 0.5 {
        narrow = middle
      } else {
        wide = middle
      }
    }
    return title.sizeThatFits(ProposedViewSize(width: wide, height: nil))
  }

  /// Each subview's frame, in its order, and the heading's size.
  func plan(width: CGFloat?, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
    var frames = Array(repeating: CGRect.zero, count: subviews.count)
    let find = { (part: Part) in subviews.firstIndex { $0[Role.self] == part } }
    guard let title = find(.title) else { return (frames, .zero) }
    let sub = find(.sub)
    let tools = find(.tools)
    var y: CGFloat = 0
    var widest: CGFloat = 0
    var toolsSize = CGSize.zero
    var beside = false
    if let tools, !toolsUnder {
      toolsSize = subviews[tools].sizeThatFits(.unspecified)
      if let width {
        // Given no words, the title's one line stands in for its longest.
        let longestWord = subviews[find(.words) ?? title].sizeThatFits(.unspecified).width
        beside = width - columnGap - toolsSize.width >= longestWord
      } else {
        beside = true
      }
    }
    if let tools, beside {
      let room = width.map { $0 - columnGap - toolsSize.width }
      let titleSize = Self.balanced(subviews[title], in: room)
      let row = max(titleSize.height, toolsSize.height)
      let whole = width ?? titleSize.width + columnGap + toolsSize.width
      frames[title] = CGRect(x: 0, y: (row - titleSize.height) / 2, width: titleSize.width, height: titleSize.height)
      frames[tools] = CGRect(
        x: whole - toolsSize.width, y: (row - toolsSize.height) / 2, width: toolsSize.width, height: toolsSize.height)
      y = row
      widest = titleSize.width + columnGap + toolsSize.width
    } else {
      // Over a Segmented the grid's second column is empty, but its gap
      // stays; tools put under by the port alone leave the whole row.
      let room = tools != nil && toolsUnder ? width.map { max(0, $0 - columnGap) } : width
      let titleSize = Self.balanced(subviews[title], in: room)
      frames[title] = CGRect(origin: .zero, size: titleSize)
      y = titleSize.height
      widest = titleSize.width
    }
    if let sub {
      let size = subviews[sub].sizeThatFits(ProposedViewSize(width: width, height: nil))
      y += subSpaceAbove
      frames[sub] = CGRect(x: 0, y: y, width: size.width, height: size.height)
      y += size.height
      widest = max(widest, size.width)
    }
    if let tools, !beside {
      let size = subviews[tools].sizeThatFits(ProposedViewSize(width: width, height: nil))
      y += underSpaceAbove
      frames[tools] = CGRect(x: 0, y: y, width: size.width, height: size.height)
      y += size.height
      widest = max(widest, size.width)
    }
    return (frames, CGSize(width: width ?? widest, height: y))
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    plan(width: proposal.width, subviews: subviews).size
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let frames = plan(width: bounds.width, subviews: subviews).frames
    for (subview, frame) in zip(subviews, frames) {
      subview.place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(width: frame.width, height: frame.height))
    }
  }
}

/// A section: its heading, and what is under it.
public struct VirgaSection<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let title: String?
  private let sub: String?
  private let trailing: AnyView?
  private let flush: Bool
  private let captions: [String]
  private let content: Content

  /// - Parameters:
  ///   - flush: a list or a table: a rule in ink under the heading, the rows
  ///     the section's full width.
  ///   - caption: what the list needs said about it, 12 under it.
  ///   - captions: more of them, each 12 under the one before.
  public init(
    title: String? = nil, sub: String? = nil, trailing: AnyView? = nil, flush: Bool = false, caption: String? = nil,
    captions: [String] = [], @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.sub = sub
    self.trailing = trailing
    self.flush = flush
    self.captions = (caption.map { [$0] } ?? []) + captions
    self.content = content()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let title {
        SectionHead(title, sub: sub, trailing: trailing)
          .padding(.bottom, flush ? theme.points(ThemeKit.flushHeadSpaceBelow) : theme.points(ThemeKit.cardHeadSpaceBelow))
        if flush {
          Rectangle().fill(theme.color(ThemeKit.flushHeadRule)).frame(height: theme.points(ThemeKit.flushHeadRule))
        }
      }
      content
        .environment(\.virgaUnderRuledHead, flush && title != nil)
      ForEach(Array(captions.enumerated()), id: \.offset) { _, caption in
        Text(caption)
          .virgaText(.textSm)
          .foregroundStyle(theme.muted)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: theme.measure, alignment: .leading)
          .padding(.top, theme.points(ThemeKit.cardCaptionSpaceAbove))
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// `.card-foot`: under a list, a quiet action first and a count at the right.
/// A ghost button first ("Show 30 more") is let out by its own padding and
/// edge (`letOut`: its size), so its words sit on the section's edge.
public struct SectionFoot<Leading: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let leading: Leading
  private let count: String?
  private let letOut: KitSize?

  /// - Parameter letOut: the size of the ghost button `leading` starts with
  ///   (`.card-foot > .btn--ghost:first-child`), nil for anything else.
  public init(count: String? = nil, letOut: KitSize? = nil, @ViewBuilder leading: () -> Leading) {
    self.count = count
    self.letOut = letOut
    self.leading = leading()
  }

  /// `margin-left: -17px` (medium), `-13px` (small): the button's padding
  /// and its 1-point edge.
  private var lead: CGFloat {
    guard let letOut else { return 0 }
    let padding = letOut == .small ? ThemeKit.smallButtonPadding.left : ThemeKit.buttonPadding.left
    return theme.points(padding) + theme.points(ThemeKit.buttonBorder)
  }

  public var body: some View {
    HStack(spacing: theme.space3) {
      leading
        .padding(.leading, -lead)
      Spacer(minLength: 0)
      if let count {
        Text(count).virgaText(.textSm).foregroundStyle(theme.muted)
      }
    }
    .padding(.top, theme.points(ThemeKit.cardFootSpaceAbove))
  }
}

/// A row of a list: its padding, its hairline, its words and its actions.
public struct VirgaRow<Words: View, Actions: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let roomy: Bool
  private let time: String?
  private let words: Words
  private let actions: Actions

  /// - Parameters:
  ///   - roomy: a setting, an account or a link elsewhere (--row-pad-lg).
  ///   - time: for a list led by a time, kept in its --time-col column.
  public init(
    roomy: Bool = false, time: String? = nil, @ViewBuilder words: () -> Words, @ViewBuilder actions: () -> Actions
  ) {
    self.roomy = roomy
    self.time = time
    self.words = words()
    self.actions = actions()
  }

  public var body: some View {
    let pad = roomy ? theme.rowPadLg : theme.rowPad
    HStack(alignment: .top, spacing: theme.space4) {
      if let time {
        Text(time)
          .virgaText(.textBase)
          .foregroundStyle(theme.ink2)
          .frame(width: theme.timeCol, alignment: .leading)
      }
      words
        .frame(maxWidth: .infinity, alignment: .leading)
      HStack(spacing: theme.points(ThemeKit.rowActionsGap)) {
        actions
      }
      .padding(.top, -Measure.Section.rowActionsLift)
    }
    .padding(.vertical, pad)
    .overlay(alignment: .bottom) {
      Rectangle().fill(theme.line).frame(height: Measure.Section.hairline)
    }
  }
}

extension VirgaRow where Actions == EmptyView {
  public init(roomy: Bool = false, time: String? = nil, @ViewBuilder words: () -> Words) {
    self.init(roomy: roomy, time: time, words: words, actions: { EmptyView() })
  }
}

/// A row's title and the meta line under it.
public struct RowWords: View {
  @Environment(\.virgaTheme) private var theme
  private let title: String
  private let meta: [MetaItem]

  public init(_ title: String, meta: [MetaItem] = []) {
    self.title = title
    self.meta = meta
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: theme.points(ThemeKit.cardSubSpaceAbove)) {
      Text(title)
        .virgaText(.textBase, weight: VirgaWeight.medium)
        .foregroundStyle(theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      if !meta.isEmpty {
        MetaLine(meta)
      }
    }
  }
}

#Preview("Section and rows") {
  VirgaPreviewHost {
    VirgaSection(title: "Your dashboards", sub: "Each is a set of reports, arranged your way.", flush: true) {
      VirgaRow(roomy: true) {
        RowWords("Overview", meta: [MetaItem("6 reports")])
      } actions: {
        MoreMenu(label: "More for Overview", entries: [.item(MenuItem("Rename…", systemImage: "pencil") {})])
      }
      VirgaRow(roomy: true) {
        RowWords("Growth", meta: [MetaItem("4 reports")])
      }
    }
    .padding()
  }
}
#endif
