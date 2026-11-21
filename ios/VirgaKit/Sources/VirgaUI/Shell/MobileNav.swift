// Ports src/shell/MobileNav.jsx
// Ports src/shell/shell.css (.appbar, .tabbar)
// Ports src/styles/theme.css
//
// On a phone (and a window under 900 wide): the mark (or the way back up to
// the page above, the system's back button: "‹ Reports") and the account
// across the top, in the navigation bar, clear over the sky; and the parts
// of Virga along the bottom edge where a thumb reaches them. The bottom bar
// is icons; the part you are in also says its name on an --accent-tint pill
// (a tinted disc on a phone under 430, its name read out but not shown; in
// high contrast under 375, the disc has an ink ring), and New post is the
// round ink button at its end. Settings is behind the account, in its menu.
//
// Search (the command palette, which has no shortcut on a phone) and the
// menu's Sync now come with the palette and the archive.

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

/// The app bar's parts, in the navigation bar: the mark on a part's front
/// page (the system's back button takes its place on a page inside one),
/// and the account.
struct AppBarToolbar: ToolbarContent {
  let showsBrand: Bool

  @ToolbarContentBuilder var body: some ToolbarContent {
    if showsBrand {
      ToolbarItem(placement: .topBarLeading) {
        Brand()
      }
    }
    // The page's own header has the title; the bar keeps it for the back
    // button and VoiceOver, without drawing it.
    ToolbarItem(placement: .principal) {
      Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
    }
    ToolbarItem(placement: .topBarTrailing) {
      AccountMenu(compact: true)
    }
  }
}
#endif
