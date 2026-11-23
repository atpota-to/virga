// Ports src/shell/bits.jsx (PageHeader)
// Ports src/shell/shell.css (.page-header, .page-title, .page-sub, .page-actions, .crumbs, .page-body)
//
// The top of every page, on the sky, at the page's margin and --page-top
// down:
//   1. the title (--text-title, 600, tracking −0.025em, line 1.1, its lines
//      balanced when it wraps), with at most a tool or two for the thing it
//      names just after it;
//   2. a line saying what the page is (--muted, --text-base, at most 68ch);
//   3. a quiet meta line of what the page can touch (AccessLine);
//   4. at most one row of controls: on a wide screen at the right of the
//      title's line, under the words when it doesn't fit; on a phone one row
//      under the words that never wraps.
// The crumbs show only beside the folded rail (the open sidebar says where
// the page is already, and a phone's back button does).
//
// VirgaPage is the page itself: a plain ScrollView with the sky behind it
// (PageSky, moved by the scroll), the header, then the page's bands, `--section-gap` apart, in a
// column at most --content-max wide plus its margins, centred. On a phone's
// front page of a part the app bar (the mark and the account) comes first,
// in the content (Shell/MobileNav.swift); then, where there is no sidebar
// to say it, the sync's strip (Shell/SyncStatus.swift). A tap on the page
// itself, off its controls and fields, ends editing, as a click there
// takes the focus from a field on the web; a drag down puts the keyboard
// away as it goes, as iOS pages do.
//
//   VirgaPage(header: PageHeaderModel(title: "Reports", sub: "Every number Virga works out, one page each.")) {
//     VirgaSection(title: "Followers") { … }
//   }

#if canImport(UIKit)
import SwiftUI
import UIKit
import VirgaArchive
import VirgaCore

/// Where a page is drawn: outside the shell, in a phone's stack, beside the
/// open sidebar, or beside the folded rail.
public enum ShellChrome: Sendable {
  case none, phone, sidebar, rail
}

private struct ShellChromeKey: EnvironmentKey {
  static let defaultValue = ShellChrome.none
}

private struct ShowsAppBarKey: EnvironmentKey {
  static let defaultValue = false
}

private struct ShowsSyncBannerKey: EnvironmentKey {
  static let defaultValue = false
}

extension EnvironmentValues {
  /// The shell around the page (Shell sets it).
  public var shellChrome: ShellChrome {
    get { self[ShellChromeKey.self] }
    set { self[ShellChromeKey.self] = newValue }
  }

  /// Whether the page draws the phone's app bar at the top of its content
  /// (a part's front page, where the navigation bar is hidden; Shell sets it).
  public var showsAppBar: Bool {
    get { self[ShowsAppBarKey.self] }
    set { self[ShowsAppBarKey.self] = newValue }
  }

  /// Whether the page draws the sync's strip at its top (on a phone and
  /// beside the folded rail, where no sidebar says it; Shell sets it).
  public var showsSyncBanner: Bool {
    get { self[ShowsSyncBannerKey.self] }
    set { self[ShowsSyncBannerKey.self] = newValue }
  }
}

/// A crumb: its words, and where it goes (nil for none).
public struct Crumb: Hashable {
  public var label: String
  public var to: String?

  public init(_ label: String, to: String? = nil) {
    self.label = label
    self.to = to
  }
}

/// What a page's header says.
public struct PageHeaderModel {
  public var title: String
  public var sub: String?
  public var access: [String]
  public var crumbs: [Crumb]

  public init(title: String, sub: String? = nil, access: [String] = [], crumbs: [Crumb] = []) {
    self.title = title
    self.sub = sub
    self.access = access
    self.crumbs = crumbs
  }
}

public struct PageHeader: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.shellChrome) private var chrome
  @Environment(\.navigate) private var navigate
  /// What the controls say they hold: a Segmented (the period), a primary
  /// button (Customize's Done).
  @State private var holdsSegmented = false
  @State private var holdsPrimary = false
  private let model: PageHeaderModel
  private let titleTools: AnyView?
  private let period: AnyView?
  private let actions: AnyView?
  private let extra: AnyView?

  /// - Parameters:
  ///   - period: the period picker (`.period-picker`), which a phone puts
  ///     first in the row of controls, taking what room the rest leave.
  ///   - actions: the other controls (Customize, Add to dashboard), which a
  ///     phone puts at the row's far end; a page with only a picker may
  ///     pass it here.
  public init(
    _ model: PageHeaderModel, titleTools: AnyView? = nil, period: AnyView? = nil, actions: AnyView? = nil, extra: AnyView? = nil
  ) {
    self.model = model
    self.titleTools = titleTools
    self.period = period
    self.actions = actions
    self.extra = extra
  }

  public var body: some View {
    let showsCrumbs = chrome == .rail && !model.crumbs.isEmpty
    VStack(alignment: .leading, spacing: Measure.PageHeader.gap) {
      if showsCrumbs {
        crumbs
      }
      row
      if let extra {
        extra.padding(.top, Measure.PageHeader.extraSpaceAbove)
      }
    }
    // Beside the rail the crumbs take the room over the title rather than
    // push it down, so the title (and the rail's mark, centred on it) is
    // on the same line on every page.
    .padding(.top, showsCrumbs ? max(0, theme.pageTop - crumbLine - Measure.PageHeader.gap) : theme.pageTop)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var hasControls: Bool { period != nil || actions != nil }

  @ViewBuilder private var row: some View {
    Group {
      if !hasControls {
        words
      } else if theme.isPhone {
        if holdsPrimary && !holdsSegmented && period == nil {
          phoneDone
        } else {
          phoneRow
        }
      } else {
        BesideOrUnder(
          minLead: Measure.PageHeader.wordsBasis, columnGap: Measure.PageHeader.columnGap, rowGap: Measure.PageHeader.rowGap,
          baseline: false
        ) {
          words
          wideControls
        }
      }
    }
    .onPreferenceChange(HoldsSegmentedKey.self) { holds in
      if holdsSegmented != holds { holdsSegmented = holds }
    }
    .onPreferenceChange(HoldsPrimaryButtonKey.self) { holds in
      if holdsPrimary != holds { holdsPrimary = holds }
    }
  }

  /// A phone: the words, then one row of controls 12 under them that never
  /// wraps: the period first, taking the room the rest leave (scrolling
  /// sideways in it if it must), anything else at the row's far end.
  private var phoneRow: some View {
    VStack(alignment: .leading, spacing: Measure.PageHeader.phoneRowGap) {
      words
      HStack(spacing: Measure.PageHeader.phoneActionsGap) {
        if let period {
          period
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
          if let actions {
            // `flex: none`: the rest keep their words.
            actions.fixedSize()
          }
        } else if let actions {
          if holdsSegmented {
            // A page that passes its picker alone (or a picker and the rest
            // together) as its controls: the row is the picker's.
            actions
              .frame(maxWidth: .infinity, alignment: .leading)
              .layoutPriority(1)
          } else {
            Spacer(minLength: 0)
            actions
          }
        }
      }
    }
  }

  /// A phone's header whose only control is a primary button (Customize's
  /// Done): it stays beside the title, centred on the title's line, the way
  /// a sheet's Done sits; the lines under the title take the whole width.
  private var phoneDone: some View {
    VStack(alignment: .leading, spacing: Measure.PageHeader.textGap) {
      // `minmax(0, 1fr) auto`, 16 apart: the title takes what Done leaves
      // (a Spacer here would take the gap twice).
      HStack(alignment: .top, spacing: Measure.PageHeader.phoneActionsGap) {
        titleRow
          .frame(maxWidth: .infinity, alignment: .leading)
        if let actions {
          actions
            .fixedSize()
            .padding(.vertical, (titleLine - theme.points(ThemeKit.touchButtonHeight)) / 2)
        }
      }
      subAndAccess
    }
  }

  /// From 561 up: the controls at the right of the title's line, at least
  /// as tall as it and centred on it (44-point keys, or 40-point buttons
  /// where there is no picker, drawn up by half the difference); under the
  /// words, at their start, when the words would have less than 320.
  private var wideControls: some View {
    let tallest = holdsSegmented || period != nil
      ? theme.points(ThemeKit.touchSegmentedKeyHeight) : theme.points(ThemeKit.touchButtonHeight)
    // In the page's own order: the rest (Customize), then the period.
    return HStack(alignment: .center, spacing: Measure.PageHeader.actionsGap) {
      if let actions { actions }
      if let period { period }
    }
    .frame(minHeight: titleLine)
    .padding(.top, min(0, (titleLine - tallest) / 2))
  }

  /// The title's line: `--text-title × 1.1`.
  private var titleLine: CGFloat {
    theme.scaled(theme.textTitle) * CGFloat(Measure.PageHeader.titleLineHeight)
  }

  /// The crumbs' line: `--text-sm × 1.45`.
  private var crumbLine: CGFloat {
    theme.scaled(theme.textSm) * CGFloat(ThemeKit.bodyLineHeight)
  }

  private var words: some View {
    VStack(alignment: .leading, spacing: Measure.PageHeader.textGap) {
      titleRow
      subAndAccess
    }
  }

  /// The title, and a tool or two just after it, centred on its first line
  /// and reaching out above and below it without making it taller.
  private var titleRow: some View {
    HStack(alignment: .top, spacing: Measure.PageHeader.gap) {
      title
      if let titleTools {
        titleTools
          .padding(.vertical, (titleLine - Measure.Touch.target) / 2)
      }
    }
  }

  /// `.page-title`: on one line, the title as a Text; when it wraps, its
  /// words a line every 1.1 of it (TitleLines), where a Text's lines would
  /// be the face's own 1.22 apart, and balanced as the web's heading is.
  /// Either way VoiceOver reads it as one heading. A title written right to
  /// left stays a Text (TitleLines.canSet). A title that wraps takes the
  /// whole row, as the web's h1 shrinks to the row once it no longer fits
  /// on one line, so the tools after it sit at the row's end, not just past
  /// its balanced lines.
  @ViewBuilder private var title: some View {
    if TitleLines.canSet(model.title) {
      ViewThatFits(in: .horizontal) {
        titleText
        titleLines
      }
    } else {
      titleText
    }
  }

  private var titleText: some View {
    Text(model.title)
      .virgaText(
        .textTitle, weight: VirgaWeight.semibold, lineHeight: Measure.PageHeader.titleLineHeight,
        tracking: Measure.PageHeader.titleTracking)
      // The line is 1.1 of the title, shorter than the face's own: its
      // box is that, the glyphs reaching past it as a browser's do.
      .padding(.vertical, theme.overflowingLeading(size: theme.textTitle, lineHeight: Measure.PageHeader.titleLineHeight, weight: VirgaWeight.semibold))
      .foregroundStyle(theme.ink)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier("page-title")
  }

  private var titleLines: some View {
    TitleLines(
      pitch: titleLine,
      // A space at the title's weight, and the letter-spacing a browser
      // puts after it too.
      space: theme.spaceWidth(size: theme.textTitle, weight: VirgaWeight.semibold)
        + theme.tracking(Measure.PageHeader.titleTracking, size: theme.textTitle)
    ) {
      ForEach(Array(model.title.split(separator: " ").enumerated()), id: \.offset) { _, word in
        Text(String(word))
          .virgaText(
            .textTitle, weight: VirgaWeight.semibold, lineHeight: Measure.PageHeader.titleLineHeight,
            tracking: Measure.PageHeader.titleTracking)
      }
    }
    .foregroundStyle(theme.ink)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(model.title)
    .accessibilityAddTraits(.isHeader)
    .accessibilityIdentifier("page-title")
    // The row's width, the lines at its start; VoiceOver's heading stays
    // the size of the words.
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var subAndAccess: some View {
    if let sub = model.sub {
      Text(sub)
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: theme.characters(Measure.PageHeader.subMeasure, size: theme.textBase), alignment: .leading)
        .accessibilityIdentifier("page-sub")
    }
    if !model.access.isEmpty {
      AccessLine(model.access)
        .frame(maxWidth: theme.characters(Measure.PageHeader.subMeasure, size: theme.textBase), alignment: .leading)
    }
  }

  private var crumbs: some View {
    HStack(spacing: Measure.PageHeader.gap) {
      ForEach(Array(model.crumbs.enumerated()), id: \.offset) { index, crumb in
        if let to = crumb.to {
          // CrumbStyle presses it through 44 points (DESIGN.md's Touch).
          Button(crumb.label) { navigate(to) }
            .buttonStyle(CrumbStyle())
            .accessibilityAddTraits(.isLink)
        } else {
          Text(crumb.label)
        }
        if index < model.crumbs.count - 1 {
          Text("/").accessibilityHidden(true)
        }
      }
    }
    .virgaText(.textSm, lineBox: true)
    .foregroundStyle(theme.muted)
    .accessibilityElement(children: .contain)
  }
}

/// A crumb that goes somewhere: muted words, ink and underlined while
/// pressed (`.crumbs a:hover`), pressed through 44 points.
struct CrumbStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    CrumbBody(label: configuration.label, isPressed: configuration.isPressed)
  }
}

struct CrumbBody<Label: View>: View {
  @Environment(\.virgaTheme) private var theme
  let label: Label
  let isPressed: Bool

  var body: some View {
    let line = theme.scaled(theme.textSm) * CGFloat(ThemeKit.bodyLineHeight)
    label
      .modifier(LinkUnderline(drawn: isPressed))
      .foregroundStyle(isPressed ? theme.ink : theme.muted)
      .touchReach(horizontal: Measure.LinkAction.reachSides, vertical: max(0, (Measure.Touch.target - line) / 2))
      .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
  }
}

/// A page: the sky behind its scroll content, its header, and its bands in
/// the page's column.
public struct VirgaPage<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.showsAppBar) private var showsAppBar
  @Environment(\.showsSyncBanner) private var showsSyncBanner
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  /// Beside the sidebar: the shell's sky, which this page moves.
  @Environment(SkyScroll.self) private var deskSky: SkyScroll?
  @State private var ownSky = SkyScroll()
  private let header: PageHeader?
  private let contentTop: CGFloat?
  private let content: Content

  public init(header: PageHeader?, @ViewBuilder content: () -> Content) {
    self.header = header
    self.contentTop = nil
    self.content = content()
  }

  public init(_ model: PageHeaderModel, @ViewBuilder content: () -> Content) {
    self.header = PageHeader(model)
    self.contentTop = nil
    self.content = content()
  }

  /// A page with no header whose content starts `contentTop` down (the
  /// first build's, a loading line).
  init(header: PageHeader?, contentTop: CGFloat, @ViewBuilder content: () -> Content) {
    self.header = header
    self.contentTop = contentTop
    self.content = content()
  }

  public var body: some View {
    let sky = deskSky ?? ownSky
    ScrollView {
      VStack(spacing: 0) {
        if showsAppBar { AppBarRow() }
        if showsSyncBanner, let archive { SyncBanner(archive: archive) }
        PageColumn {
          VStack(alignment: .leading, spacing: 0) {
            if let header { header }
            VStack(alignment: .leading, spacing: theme.sectionGap) {
              content
            }
            .padding(.top, contentTop ?? theme.sectionGap)
            .padding(.bottom, theme.hasSidebar ? Measure.Page.bodySpaceBelow : Measure.Page.phoneBodySpaceBelow)
          }
        }
      }
      .background {
        // Where the content's top is as it scrolls, for the sky to follow.
        GeometryReader { geometry in
          Color.clear.onChange(of: geometry.frame(in: .named(Self.space)).minY, initial: true) { _, y in
            ownSky.report(y)
            if let deskSky { deskSky.offset = ownSky.offset }
          }
        }
      }
      // Behind everything on the page, so a press on a control or a field
      // is theirs: a tap on the page itself ends editing (a field's blur).
      .background {
        Color.clear
          .contentShape(Rectangle())
          .onTapGesture { Self.endEditing() }
          .accessibilityHidden(true)
      }
    }
    .coordinateSpace(name: Self.space)
    .scrollDismissesKeyboard(.interactively)
    .overlay(alignment: .top) {
      if showsAppBar { StatusBarSky(scroll: sky) }
    }
    // The sky from the window's top, moved by the scroll; beside the
    // sidebar the shell draws it once behind both.
    .background {
      if deskSky == nil { PageSky(scroll: sky) }
    }
  }

  /// The page's scroll view's own space.
  static var space: String { "virga-page" }

  /// Whatever field has the focus gives it up, and the keyboard goes.
  static func endEditing() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
  }
}

/// `.page-header-in, .page-body`: the page's column, at most --content-max
/// plus its margins wide, centred, the margins inside it.
public struct PageColumn<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let maxWidth: CGFloat?
  private let content: Content

  public init(maxWidth: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.maxWidth = maxWidth
    self.content = content()
  }

  public var body: some View {
    content
      .padding(.horizontal, theme.pagePad)
      .frame(maxWidth: (maxWidth ?? theme.contentMax) + theme.pagePad * 2, alignment: .leading)
      .frame(maxWidth: .infinity)
  }
}

#Preview("Page header") {
  VirgaPreviewHost {
    VirgaPage(
      header: PageHeader(
        PageHeaderModel(title: "Scheduled posts", sub: "Posts waiting to go out, and when.", access: ["post", "server"]),
        actions: AnyView(Button("Customize") {}.buttonStyle(.linkAction)))
    ) {
      EmptyState("Nothing is scheduled.")
    }
  }
}
#endif
