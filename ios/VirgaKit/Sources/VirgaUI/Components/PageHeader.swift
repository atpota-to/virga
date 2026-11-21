// Ports src/shell/bits.jsx (PageHeader)
// Ports src/shell/shell.css (.page-header, .page-title, .page-sub, .page-actions, .crumbs, .page-body)
//
// The top of every page, on the sky, at the page's margin and --page-top
// down:
//   1. the title (--text-title, 600, tracking −0.025em, line 1.1), with at
//      most a tool or two for the thing it names just after it;
//   2. a line saying what the page is (--muted, --text-base, at most 68ch);
//   3. a quiet meta line of what the page can touch (AccessLine);
//   4. at most one row of controls: on a wide screen at the right of the
//      title's line, under the words when it doesn't fit; on a phone one row
//      under the words that never wraps.
// The crumbs show only beside the folded rail (the open sidebar says where
// the page is already, and a phone's back button does).
//
// VirgaPage is the page itself: a plain ScrollView with the sky behind its
// content, the header, then the page's bands, `--section-gap` apart, in a
// column at most --content-max wide plus its margins, centred.
//
//   VirgaPage(header: PageHeaderModel(title: "Reports", sub: "Every number Virga works out, one page each.")) {
//     VirgaSection(title: "Followers") { … }
//   }

#if canImport(UIKit)
import SwiftUI
import VirgaCore

/// Where a page is drawn: outside the shell, in a phone's stack, beside the
/// open sidebar, or beside the folded rail.
public enum ShellChrome: Sendable {
  case none, phone, sidebar, rail
}

private struct ShellChromeKey: EnvironmentKey {
  static let defaultValue = ShellChrome.none
}

extension EnvironmentValues {
  /// The shell around the page (Shell sets it).
  public var shellChrome: ShellChrome {
    get { self[ShellChromeKey.self] }
    set { self[ShellChromeKey.self] = newValue }
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
  private let model: PageHeaderModel
  private let titleTools: AnyView?
  private let actions: AnyView?
  private let extra: AnyView?

  public init(_ model: PageHeaderModel, titleTools: AnyView? = nil, actions: AnyView? = nil, extra: AnyView? = nil) {
    self.model = model
    self.titleTools = titleTools
    self.actions = actions
    self.extra = extra
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: Measure.PageHeader.gap) {
      if chrome == .rail && !model.crumbs.isEmpty {
        crumbs
      }
      row
      if let extra {
        extra.padding(.top, Measure.PageHeader.extraSpaceAbove)
      }
    }
    .padding(.top, theme.pageTop)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private var row: some View {
    if let actions {
      if theme.isPhone {
        VStack(alignment: .leading, spacing: Measure.PageHeader.rowGap) {
          words
          actions
        }
      } else {
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .top, spacing: Measure.PageHeader.columnGap) {
            words
            Spacer(minLength: 0)
            actions.frame(minHeight: titleLineHeight)
          }
          VStack(alignment: .leading, spacing: Measure.PageHeader.rowGap) {
            words
            actions
          }
        }
      }
    } else {
      words
    }
  }

  private var titleLineHeight: CGFloat {
    theme.textTitle * CGFloat(Measure.PageHeader.titleLineHeight)
  }

  private var words: some View {
    VStack(alignment: .leading, spacing: Measure.PageHeader.textGap) {
      HStack(alignment: .center, spacing: Measure.PageHeader.gap) {
        Text(model.title)
          .virgaText(
            .textTitle, weight: VirgaWeight.semibold, lineHeight: Measure.PageHeader.titleLineHeight,
            tracking: Measure.PageHeader.titleTracking)
          .foregroundStyle(theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("page-title")
        if let titleTools {
          titleTools
        }
      }
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
  }

  private var crumbs: some View {
    HStack(spacing: Measure.PageHeader.gap) {
      ForEach(Array(model.crumbs.enumerated()), id: \.offset) { index, crumb in
        if let to = crumb.to {
          Button(crumb.label) { navigate(to) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
        } else {
          Text(crumb.label)
        }
        if index < model.crumbs.count - 1 {
          Text("/").accessibilityHidden(true)
        }
      }
    }
    .virgaText(.textSm)
    .foregroundStyle(theme.muted)
    .accessibilityElement(children: .contain)
  }
}

/// A page: the sky behind its scroll content, its header, and its bands in
/// the page's column.
public struct VirgaPage<Content: View>: View {
  @Environment(\.virgaTheme) private var theme
  private let header: PageHeader?
  private let content: Content

  public init(header: PageHeader?, @ViewBuilder content: () -> Content) {
    self.header = header
    self.content = content()
  }

  public init(_ model: PageHeaderModel, @ViewBuilder content: () -> Content) {
    self.header = PageHeader(model)
    self.content = content()
  }

  public var body: some View {
    ScrollView {
      PageColumn {
        VStack(alignment: .leading, spacing: 0) {
          if let header { header }
          VStack(alignment: .leading, spacing: theme.sectionGap) {
            content
          }
          .padding(.top, theme.sectionGap)
          .padding(.bottom, theme.hasSidebar ? Measure.Page.bodySpaceBelow : Measure.Page.phoneBodySpaceBelow)
        }
      }
      .skyBackground()
    }
    .scrollDismissesKeyboard(.interactively)
    // Behind the content: sky above the middle, ground below, so a short
    // page, or one pulled past its ends, shows no other colour.
    .background(PageGround().ignoresSafeArea())
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
