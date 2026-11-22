// Ports src/styles/controls.css (.card, .card-head, .card-title, .card-sub, .card--flush, .card-caption, .card-foot, .row-actions)
//
// A section (`.card`, though it has no box) is a heading and what is under
// it. The heading is a title (--text-md, 600) with an optional line under it
// (--muted, small, held to --measure), and at the right at most one thing (a
// more link, one or two link actions, a small Segmented, a few icon tools),
// 16 points to what follows; the title and its line share a column, the
// thing at the right going under them only when that column would be
// narrower than 16rem. On a phone the thing at the right stays on the
// title's line and the line under the title runs the full width beneath
// both; a small Segmented goes on a row of its own under that line. A
// section that is a list or a table (`flush`) has a rule in ink
// under its heading, which is the top of its first row. A caption sits 12
// under it; under a list, its foot ("Show 10 more" first, "12 of 64" at the
// right).
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
  /// it, the line under the title across the whole width beneath both, and
  /// a small Segmented on a row of its own under that, 8 down.
  private var phone: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let trailing, !segmented {
        // `minmax(0, 1fr) auto` 16 apart: the title takes what the tools
        // leave (a Spacer here would take the gap twice).
        HStack(alignment: .center, spacing: Measure.Section.phoneHeadGap) {
          titleText
            .frame(maxWidth: .infinity, alignment: .leading)
          tools(trailing)
        }
      } else {
        titleText
      }
      if let sub {
        subLine(sub)
          .padding(.top, theme.points(ThemeKit.cardSubSpaceAbove))
      }
      if let trailing, segmented {
        tools(trailing)
          .padding(.top, Measure.Segmented.headSpaceAbove)
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
    Text(title)
      .virgaText(
        size: theme.points(ThemeKit.cardTitleFontSize), weight: ThemeKit.cardTitleWeight, lineHeight: ThemeKit.headingLineHeight,
        tracking: ThemeKit.cardTitleTracking)
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
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

/// A section: its heading, and what is under it.
public struct VirgaSection<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let title: String?
  private let sub: String?
  private let trailing: AnyView?
  private let flush: Bool
  private let caption: String?
  private let content: Content

  /// - Parameters:
  ///   - flush: a list or a table: a rule in ink under the heading, the rows
  ///     the section's full width.
  ///   - caption: what the list needs said about it, 12 under it.
  public init(
    title: String? = nil, sub: String? = nil, trailing: AnyView? = nil, flush: Bool = false, caption: String? = nil,
    @ViewBuilder content: () -> Content
  ) {
    self.title = title
    self.sub = sub
    self.trailing = trailing
    self.flush = flush
    self.caption = caption
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
      if let caption {
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
