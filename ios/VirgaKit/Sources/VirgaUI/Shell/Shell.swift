// Ports src/shell/Shell.jsx
// Ports src/shell/shell.css (.shell, its --figure-size)
//
// The signed-in app: from 900 points wide a NavigationSplitView with Virga's
// own sidebar; narrower, a NavigationStack with the app bar in its
// navigation bar and Virga's own tab bar along the bottom. Decided by the
// window's width, not the device: an iPad held upright, or in a narrow
// split, gets the phone's shell.
//
// The address (ShellNavigator) is the state; RoutedPage draws the page it
// names. A dashboard address that names nothing goes to the last one looked
// at, or the first. The figure size is the shell's own, worked out from the
// page's column (shell.css), so the same number is the same size on every
// page.
//
// The first build's own page shows every step of the sync, so while it is
// up the sidebar's card keeps to its first line and the strip at the top
// of the page (a phone's, and beside the folded rail) isn't drawn.
//
// The command palette opens from Search (the sidebar's, the app bar's) and
// from ⌘K on a hardware keyboard; toasts show at the foot of the window.
//
// Not here yet: New dashboard, the composer (New post goes to its address,
// whose page says it isn't here yet), and the live sky.

#if canImport(UIKit)
import SwiftUI
import VirgaArchive
import VirgaCore
import VirgaInsights

public struct ShellView: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.horizontalSizeClass) private var sizeClass
  @Environment(ShellNavigator.self) private var navigator
  @Environment(PreferencesModel.self) private var preferences
  @Environment(ArchiveModel.self) private var archive: ArchiveModel?
  @State private var dashboards: ShellDashboards
  @State private var accountDialogs = AccountDialogs()
  @State private var palette = PaletteState()
  @State private var toasts = ToastCenter()

  /// - Parameters:
  ///   - store: where the account's dashboards are kept.
  ///   - did: the open account; the shell is made again for another.
  public init(store: (any KeyValueStore)?, did: String) {
    _dashboards = State(initialValue: ShellDashboards(store: store, did: did))
  }

  /// A split view needs a regular width to show both columns; a compact
  /// one (an iPhone on its side) keeps the phone's shell whatever its width.
  private var desk: Bool { theme.hasSidebar && sizeClass != .compact }

  private var collapsed: Bool { preferences.prefs.sidebar == .collapsed }

  /// Whether the page is the first build's (`archive.loaded && needsArchive && !built`).
  private var firstRun: Bool {
    guard let archive else { return false }
    let route = navigator.route
    return archive.data.loaded && !ShellRoutes.opensBeforeArchive(route) && ShellRoutes.needsArchive(route) && !archive.isBuilt
  }

  public var body: some View {
    Group {
      if desk { split } else { stack }
    }
    .overlay { ToastStack(center: toasts).padding(.bottom, desk ? 0 : theme.tabbarH) }
    .commandPalette(palette)
    .background {
      // ⌘K, from anywhere (a hardware keyboard), as the web's shortcut.
      Button("Search or jump to") { palette.isOpen.toggle() }
        .keyboardShortcut("k", modifiers: .command)
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
    .environment(palette)
    .environment(toasts)
    .environment(\.showsSyncBanner, (!desk || collapsed) && !firstRun)
    .environment(\.virgaTheme, ShellFigureSize.declared(in: theme, sidebar: desk ? (collapsed ? .rail : .sidebar) : .phone))
    .accountDialogs(accountDialogs)
    .environment(accountDialogs)
    .environment(dashboards)
    .onChange(of: navigator.path, initial: true) { _, _ in followDashboard() }
  }

  // MARK: Phone

  private var stack: some View {
    NavigationStack(path: Binding(get: { navigator.stack }, set: { navigator.stack = $0 })) {
      // Each page its own (its scroll, its state), not the last one's.
      RoutedPage(path: navigator.stackRoot)
        .id(navigator.stackRoot)
        .navigationDestination(for: String.self) { path in
          RoutedPage(path: path)
        }
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      TabBar()
    }
    .environment(\.shellChrome, .phone)
  }

  // MARK: Desk

  private var split: some View {
    NavigationSplitView(columnVisibility: .constant(.all)) {
      Sidebar(firstRun: firstRun)
        .navigationSplitViewColumnWidth(collapsed ? theme.railW : theme.sidebarW)
        .toolbar(removing: .sidebarToggle)
        .toolbar(.hidden, for: .navigationBar)
    } detail: {
      NavigationStack {
        RoutedPage(path: navigator.path)
          .id(navigator.path)
      }
    }
    .navigationSplitViewStyle(.balanced)
    .environment(\.shellChrome, collapsed ? .rail : .sidebar)
  }

  /// A dashboard address that names nothing (deleted, or never there) goes
  /// to the last looked at, or the first; one that names one is remembered.
  private func followDashboard() {
    let route = navigator.route
    guard route.section == .dashboard else { return }
    if dashboards.dashboard(route.dashboard) != nil {
      dashboards.visited(route.dashboard)
    } else if let home = dashboards.homeId {
      navigator.navigate("/dashboard/\(home)")
    }
  }
}

/// shell.css's --figure-size: 26% of the width a cell would have four to a
/// row (32 between them), up to --text-figure and no smaller than 2.5rem
/// except on a phone; the column is what the sidebar (or the rail) and the
/// page's margins leave, up to --content-max. Two to a row, 20 apart, from
/// 560 down.
enum ShellFigureSize {
  static func value(in theme: VirgaTheme, sidebar: ShellChrome) -> CGFloat {
    let vw = theme.windowWidth
    let figure = theme.textFigure
    let floor = Measure.Shell.figureFloor
    let share = Measure.Shell.figureShare
    if theme.isPhone {
      return min(figure, (vw - theme.pagePad * 2 - Measure.Shell.phoneFigureGaps) / 2 * share)
    }
    let column: CGFloat
    switch sidebar {
    case .sidebar: column = min(theme.contentMax, vw - theme.sidebarW - theme.pagePad * 2)
    case .rail: column = min(theme.contentMax, vw - theme.railW - theme.pagePad * 2)
    case .phone, .none: column = vw - theme.pagePad * 2
    }
    return min(figure, max(floor, (column - Measure.Shell.figureGaps) / 4 * share))
  }

  /// The theme with the shell's --figure-size declared, as `.shell` does.
  static func declared(in theme: VirgaTheme, sidebar: ShellChrome) -> VirgaTheme {
    var out = theme
    let size = Double(value(in: theme, sidebar: sidebar))
    out.tokens = theme.tokens.declaring([(.figureSize, .length(.px(size)))])
    return out
  }
}
#endif
