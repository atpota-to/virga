// Ports src/shell/Sidebar.jsx
// Ports src/shell/shell.css (.sidebar, .nav, .nav-sub, the folded rail)
//
// The sidebar, from 900 points: the mark, the account, New post, and the
// parts of Virga as words down the side, each with its icon. Only the part
// you are in is opened out into its pages, so the list stays short; the
// rest are one word each. The page you are on is ink, 600, with a dot in
// the accent on the part's hairline rail. It has no ground and no edge: it
// sits on the sky. Folded (Settings › Appearance, or its own button), it is
// a 72-point rail of icons, the part you are in on a tinted disc, the
// button that opens it again at the foot over the account.
//
// At its foot, the archive's lines (SyncCard): when it was synced and Sync
// now, or the sync under way; only the first line beside the first build's
// page, which shows the steps itself. Folded, the rail has the fold button
// and the account there instead, and Sync now is in the account's menu.
//
// Under New post, "Search or jump to…" with its shortcut opens the command
// palette (a search glyph on the rail).
//
// Not here yet: New dashboard (its dialog comes with the dashboards).

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

/// One page under a part: its words, where it goes, and whether it is the page.
struct NavSub: Identifiable {
  var id: String
  var label: String
  var to: String
  var current: Bool
}

public struct Sidebar: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  @Environment(ShellNavigator.self) private var navigator
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(PreferencesModel.self) private var preferences
  @Environment(AppModel.self) private var app
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  private let firstRun: Bool

  /// - Parameter firstRun: whether the page is the first build's.
  public init(firstRun: Bool = false) {
    self.firstRun = firstRun
  }

  private var collapsed: Bool { preferences.prefs.sidebar == .collapsed }

  public var body: some View {
    Group {
      if collapsed { rail } else { open }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(SkyWash().ignoresSafeArea())
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Main")
    .accessibilityIdentifier("sidebar")
  }

  // MARK: Open

  private var open: some View {
    VStack(alignment: .leading, spacing: Measure.Sidebar.gap) {
      HStack(spacing: Measure.Sidebar.doGap) {
        Brand()
        Spacer(minLength: 0)
        fold
      }
      .frame(minHeight: Measure.Sidebar.topHeight)
      AccountMenu(compact: false)
      Button {
        navigate("/posting/compose")
      } label: {
        Label("New post", systemImage: Glyph.newPost)
      }
      .buttonStyle(.virga(.primary))
      .environment(\.virgaFillsWidth, true)
      .accessibilityIdentifier("sidebar-new-post")
      SidebarSearch()
      ScrollView(.vertical, showsIndicators: false) {
        VStack(alignment: .leading, spacing: Measure.Sidebar.navGap) {
          ForEach(sections) { section in
            NavSectionView(section: section, collapsed: false)
          }
        }
        .padding(.vertical, Measure.Sidebar.navGap)
      }
      if let archive {
        SyncCard(archive: archive, brief: firstRun)
      }
    }
    .padding(.top, theme.pageTop)
    .padding(.leading, Measure.Sidebar.paddingLeading)
    .padding(.trailing, Measure.Sidebar.paddingTrailing)
    .padding(.bottom, Measure.Sidebar.paddingBottom)
  }

  // MARK: Folded

  private var rail: some View {
    VStack(spacing: Measure.Sidebar.gap) {
      Brand(showsName: false)
        .frame(minHeight: Measure.Sidebar.topHeight)
      Button {
        navigate("/posting/compose")
      } label: {
        Image(systemName: Glyph.newPost)
      }
      .buttonStyle(.virga(.primary, icon: true))
      .accessibilityLabel("New post")
      .accessibilityIdentifier("sidebar-new-post")
      PaletteButton()
      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: Measure.Sidebar.railNavGap) {
          ForEach(sections) { section in
            NavSectionView(section: section, collapsed: true)
          }
        }
        .padding(.vertical, Measure.Sidebar.navGap)
      }
      VStack(spacing: Measure.Sidebar.doGap) {
        fold
        AccountMenu(compact: true)
      }
    }
    .padding(.top, theme.pageTop)
    .padding(.bottom, Measure.Sidebar.railPaddingBottom)
    .frame(maxWidth: .infinity)
  }

  private var fold: some View {
    let label = collapsed ? "Open the sidebar" : "Fold the sidebar"
    return Button {
      preferences.setPref(\.sidebar, collapsed ? .expanded : .collapsed)
    } label: {
      Image(systemName: Glyph.foldSidebar)
    }
    .buttonStyle(.virga(.ghost, size: collapsed ? .medium : .small, icon: true))
    .accessibilityLabel(label)
    .accessibilityIdentifier("sidebar-fold")
  }

  // MARK: The parts

  struct Part: Identifiable {
    var id: String
    var label: String
    var systemImage: String
    var to: String
    var open: Bool
    var current: Bool
    var subs: [NavSub]
  }

  var sections: [Part] {
    let route = navigator.route
    let page = route.page
    var out: [Part] = []
    let shown = dashboards.dashboard(route.dashboard)?.id ?? route.dashboard
    out.append(
      Part(
        id: "dashboard", label: "Dashboards", systemImage: Glyph.dashboards, to: "/dashboard/\(shown ?? dashboards.homeId ?? "")",
        open: route.section == .dashboard, current: false,
        subs: dashboards.dashboards.map { d in
          NavSub(id: d.id, label: d.name, to: "/dashboard/\(d.id)", current: Optional(d.id).jsEquals(shown))
        }))
    out.append(
      Part(
        id: "reports", label: "Reports", systemImage: Glyph.reports, to: "/reports", open: route.section == .reports,
        current: route.section == .reports && page == nil,
        subs: ReportsRegistry.reports.map { r in
          NavSub(id: r.key, label: r.label, to: "/reports/\(r.key)", current: page.jsEquals(r.key))
        }))
    let postingLinks = PostingRoutes.postingPages.filter { $0.key == "hub" || $0.pinned }
    out.append(
      Part(
        id: "posting", label: "Posting", systemImage: Glyph.posting, to: "/posting", open: route.section == .posting, current: false,
        subs: postingLinks.map { p in
          NavSub(id: p.key, label: p.label, to: p.path, current: page.jsEquals(p.key))
        }))
    out.append(
      Part(
        id: "tools", label: "Tools", systemImage: Glyph.tools, to: "/tools", open: route.section == .tools,
        current: route.section == .tools && page == nil,
        subs: ToolsRegistry.tools.filter { $0.planned != true }.map { t in
          NavSub(id: t.key, label: t.name, to: "/tools/\(t.key)", current: page.jsEquals(t.key))
        }))
    if app.flags.defenseEnabled {
      out.append(
        Part(
          id: "defense", label: "Defense", systemImage: Glyph.defense, to: DefenseRoutes.defenseBase, open: route.section == .defense,
          current: false,
          subs: DefenseRoutes.defensePages.map { p in
            NavSub(id: p.key, label: p.label, to: p.path, current: (page ?? "scan").jsEquals(p.key))
          }))
    }
    out.append(
      Part(
        id: "settings", label: "Settings", systemImage: Glyph.settings, to: "/settings", open: route.section == .settings,
        current: false,
        subs: SettingsSections.sections.map { s in
          NavSub(id: s.key, label: s.label, to: "/settings/\(s.key)", current: (page ?? "account").jsEquals(s.key))
        }))
    return out
  }
}

struct NavSectionView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.navigate) private var navigate
  let section: Sidebar.Part
  let collapsed: Bool

  var body: some View {
    if collapsed {
      disc
    } else {
      VStack(alignment: .leading, spacing: 0) {
        word
        if section.open && !section.subs.isEmpty {
          subs
        }
      }
    }
  }

  private var word: some View {
    Button {
      navigate(section.to)
    } label: {
      HStack(spacing: Measure.Sidebar.navLinkGap) {
        Image(systemName: section.systemImage)
          .font(.system(size: Measure.Sidebar.navIcon))
          .frame(width: Measure.Sidebar.railNavIcon)
        Text(section.label)
          .virgaText(.textMd, weight: section.open ? VirgaWeight.semibold : VirgaWeight.medium)
          .lineLimit(1)
        Spacer(minLength: 0)
      }
      .foregroundStyle(section.open ? theme.ink : theme.ink2)
      .frame(minHeight: Measure.Sidebar.navLinkHeight)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
    .accessibilityAddTraits(section.current ? [.isSelected] : [])
    .accessibilityIdentifier("nav-\(section.id)")
  }

  private var subs: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(section.subs) { sub in
        Button {
          navigate(sub.to)
        } label: {
          Text(sub.label)
            .virgaText(.textBase, weight: sub.current ? VirgaWeight.semibold : VirgaWeight.regular)
            .lineLimit(1)
            .foregroundStyle(sub.current ? theme.ink : theme.muted)
            .frame(maxWidth: .infinity, minHeight: Measure.Sidebar.subLinkHeight, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(alignment: .leading) {
              if sub.current {
                // The page's dot, centred on the hairline rail.
                Circle()
                  .fill(theme.accent)
                  .frame(width: Measure.Sidebar.currentDot, height: Measure.Sidebar.currentDot)
                  .offset(x: -(Measure.Sidebar.subPadding + Measure.Sidebar.currentDot / 2))
              }
            }
        }
        .buttonStyle(.plain)
        .virgaFocusOutline(RoundedRectangle(cornerRadius: theme.radiusSm))
        .accessibilityAddTraits(sub.current ? [.isSelected] : [])
        .accessibilityIdentifier("nav-\(section.id)-\(sub.id)")
      }
    }
    .padding(.leading, Measure.Sidebar.subPadding)
    .overlay(alignment: .leading) {
      Rectangle().fill(theme.line).frame(width: 1)
    }
    .padding(.leading, Measure.Sidebar.subIndent)
    .padding(.bottom, Measure.Sidebar.subSpaceBelow)
  }

  private var disc: some View {
    Button {
      navigate(section.to)
    } label: {
      Image(systemName: section.systemImage)
        .font(.system(size: Measure.Sidebar.railNavIcon))
        .foregroundStyle(section.open ? theme.ink : theme.ink2)
        .frame(width: Measure.Sidebar.railDisc, height: Measure.Sidebar.railDisc)
        .background(Circle().fill(section.open ? theme.accentTint : Color.clear))
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .virgaFocusOutline(Circle())
    .accessibilityLabel(section.label)
    .accessibilityAddTraits(section.open ? [.isSelected] : [])
    .accessibilityIdentifier("nav-\(section.id)")
  }
}
#endif
