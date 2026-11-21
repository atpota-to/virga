// Ports src/shell/MobileNav.jsx
// Ports src/shell/shell.css (.appbar, .tabbar)
// Ports src/styles/theme.css
//
// On a phone (and a window under 900 wide): the mark and the account across
// the top, and the parts of Virga along the bottom edge where a thumb
// reaches them.
//
// On a part's front page the top row is part of the page, as the web's is:
// the mark at the page's margin, Search and the account at the right, 56
// tall, in
// the page's scroll content over the sky, so it scrolls away with it
// (AppBarRow; VirgaPage draws it, and the navigation bar is hidden). The top
// of the sky is held still under the status bar, so the page scrolls under
// it and not under the clock. On a page inside a part the mark gives way to
// the way back up, and that is the system's back button ("‹ Reports", with
// its swipe back), in the navigation bar, clear over the sky, with the
// account at its right. Where an item in the bar is Virga's own drawing (the
// account's avatar) it goes without iOS 26's glass capsule.
//
// The bottom bar is icons; the part you are in also says its name on an
// --accent-tint pill (a tinted disc on a phone under 430, its name read out
// but not shown; in high contrast under 375, the disc has an ink ring), and
// New post is the round ink button at its end. Settings is behind the
// account, in its menu.
//
// Search opens the command palette (CommandPalette.swift), which has no
// shortcut to be found by here. The account's menu holds Sync now, once
// there is an archive (there is no sync card beside it).

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

/// One of the parts in the tab bar: `{ key, label, icon, to }`.
struct TabItem: Identifiable {
  var key: AppRoute.Section
  var label: String
  var systemImage: String
  var to: String
  var id: String { key.rawValue }
}

public struct TabBar: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellNavigator.self) private var navigator
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(AppModel.self) private var app

  public init() {}

  var tabs: [TabItem] {
    var out = [
      TabItem(key: .dashboard, label: "Dashboards", systemImage: Glyph.dashboards, to: "/dashboard/\(dashboards.homeId ?? "")"),
      TabItem(key: .reports, label: "Reports", systemImage: Glyph.reports, to: "/reports"),
      TabItem(key: .posting, label: "Posting", systemImage: Glyph.posting, to: "/posting"),
      TabItem(key: .tools, label: "Tools", systemImage: Glyph.tools, to: "/tools"),
    ]
    if app.flags.defenseEnabled {
      out.append(TabItem(key: .defense, label: "Defense", systemImage: Glyph.defense, to: DefenseRoutes.defenseBase))
    }
    return out
  }

  public var body: some View {
    let section = navigator.route.section
    HStack(spacing: Measure.TabBar.gap) {
      HStack(spacing: Measure.TabBar.tabsGap) {
        ForEach(tabs) { tab in
          TabButton(tab: tab, current: section == tab.key) { navigate(tab.to) }
          if tab.id != tabs.last?.id { Spacer(minLength: 0) }
        }
      }
      .frame(maxWidth: Measure.TabBar.tabsMaxWidth)
      Button {
        navigate("/posting/compose")
      } label: {
        Image(systemName: Glyph.newPost)
          .font(.system(size: Measure.TabBar.icon, weight: .medium))
          .foregroundStyle(theme.onBtn)
          .frame(width: Measure.TabBar.newPostSize, height: Measure.TabBar.newPostSize)
          .background(Circle().fill(theme.btn))
      }
      .buttonStyle(.plain)
      .virgaFocusOutline(Circle())
      .accessibilityLabel("New post")
      .accessibilityIdentifier("tab-new-post")
    }
    .padding(.top, Measure.TabBar.paddingTop)
    .padding(.bottom, Measure.TabBar.paddingBottom)
    .padding(.horizontal, Measure.TabBar.paddingSides)
    .frame(maxWidth: .infinity)
    .frame(minHeight: theme.tabbarH)
    .background(alignment: .top) {
      ZStack(alignment: .top) {
        theme.bg.ignoresSafeArea(edges: .bottom)
        Rectangle().fill(theme.line).frame(height: 1)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Main")
    .accessibilityIdentifier("tab-bar")
  }
}

struct TabButton: View {
  @Environment(\.virgaTheme) private var theme
  let tab: TabItem
  let current: Bool
  let action: () -> Void

  var body: some View {
    let named = current && theme.showsTabName
    let ring = current && !theme.showsTabName && theme.isHighContrast && theme.windowWidth <= Breakpoint.tabRing
    Button(action: action) {
      HStack(spacing: Measure.TabBar.itemGap) {
        Image(systemName: tab.systemImage)
          .font(.system(size: Measure.TabBar.icon))
        if named {
          Text(tab.label)
            .virgaText(.textSm, weight: VirgaWeight.semibold)
            .lineLimit(1)
        }
      }
      .foregroundStyle(current ? theme.ink : theme.muted)
      .padding(.leading, named ? Measure.TabBar.currentPaddingLeading : 0)
      .padding(.trailing, named ? Measure.TabBar.currentPaddingTrailing : 0)
      .frame(minWidth: Measure.TabBar.itemSize, minHeight: Measure.TabBar.itemSize)
      .background(Capsule().fill(current ? theme.accentTint : Color.clear))
      .overlay {
        if ring, let layer = ThemeKit.highContrastCurrentTabRing.first {
          Capsule().strokeBorder(theme.color(layer.color ?? .color(.transparent)), lineWidth: theme.points(layer.spread ?? .px(0)))
        }
      }
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(Capsule())
    .accessibilityLabel(tab.label)
    .accessibilityAddTraits(current ? [.isSelected] : [])
    .accessibilityIdentifier("tab-\(tab.key.rawValue)")
  }
}

/// `.appbar`, on a part's front page: the mark at the page's margin, Search
/// and the account at the right, 56 tall, in the page's content (VirgaPage draws it
/// when `showsAppBar` is set), so it scrolls away with the sky.
struct AppBarRow: View {
  @Environment(\.virgaTheme) private var theme

  var body: some View {
    HStack(spacing: Measure.AppBar.gap) {
      Brand()
        .frame(minHeight: Measure.AppBar.iconButton)
      Spacer(minLength: 0)
      HStack(spacing: 0) {
        PaletteButton()
        AccountMenu(compact: true)
      }
    }
    .padding(.leading, theme.pagePad)
    .padding(.trailing, Measure.AppBar.paddingTrailing)
    .frame(maxWidth: .infinity, minHeight: theme.appbarH)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("app-bar")
  }
}

/// The top of the sky, held still over the status bar of a page with no
/// navigation bar: at rest it is the page's own sky there, and the page
/// scrolls under it rather than under the clock. Laid out with no height at
/// the top of the safe area, it reaches up over the status bar alone.
struct StatusBarSky: View {
  var body: some View {
    Color.clear
      .overlay(alignment: .top) { SkyWash() }
      .clipped()
      .ignoresSafeArea(edges: .top)
      .frame(height: 0)
      .allowsHitTesting(false)
      .accessibilityHidden(true)
  }
}

/// The navigation bar's parts on a page inside a part: the system's back
/// button is the way back up; the bar draws no title (the page's header has
/// it, and the bar keeps it for the back button and VoiceOver), and Search
/// and the account are at the right.
struct AppBarToolbar: ToolbarContent {
  @ToolbarContentBuilder var body: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
    }
    .withoutSharedGlass()
    ToolbarItem(placement: .topBarTrailing) {
      HStack(spacing: 0) {
        PaletteButton()
        AccountMenu(compact: true)
      }
    }
    .withoutSharedGlass()
  }
}

extension ToolbarContent {
  /// iOS 26 sets each item in a bar on a shared Liquid Glass capsule; an
  /// item that is Virga's own drawing (the account's 30-point avatar, the
  /// empty title) goes without one. Earlier systems have no capsule.
  func withoutSharedGlass() -> some ToolbarContent {
    if #available(iOS 26.0, *) {
      return sharedBackgroundVisibility(.hidden)
    } else {
      return self
    }
  }
}
#endif
