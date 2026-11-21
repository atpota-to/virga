// Ports src/shell/Shell.jsx (the page the address names, and NotFound)
// Ports src/posting/ui/PostingHeader.jsx (the header a posting page has)
// Ports src/tools/ToolPage.jsx (ToolHeader, and the page of a tool that isn't built)
//
// Every route resolves to a view here. A page that has been ported is its
// own view; one that hasn't is UnportedPage: its real header (the title and
// the line saying what the page is, with what it can touch) and one sentence
// that it isn't in the iOS app yet, with no made-up numbers.
//
// To plug a new page in, give its route a case in `page` below, and draw it
// with VirgaPage (Components/PageHeader.swift) so it has the sky, the header
// and the page's column:
//
//   case .reports where route.page == "followers":
//     FollowersReport()
//
// The navigation bar (a phone's) and the page's title for VoiceOver and the
// back button are put on here, so a page draws only itself.

#if canImport(UIKit)
import SwiftUI
import VirgaCore
import VirgaInsights

/// The one sentence a page that hasn't been ported yet says.
public enum Unported {
  public static let page = "This page isn’t in the iOS app yet."
  public static let section = "This section isn’t in the iOS app yet."
}

/// A page with its real header and the sentence that it isn't here yet.
public struct UnportedPage: View {
  @Environment(\.virgaTheme) private var theme
  private let header: PageHeaderModel

  public init(_ header: PageHeaderModel) {
    self.header = header
  }

  public var body: some View {
    VirgaPage(header) {
      Text(Unported.page)
        .virgaText(.textBase)
        .foregroundStyle(theme.muted)
        .accessibilityIdentifier("unported")
    }
  }
}

/// The page an address names, in the shell.
public struct RoutedPage: View {
  @Environment(\.virgaTheme) private var theme
  @Environment(\.shellChrome) private var chrome
  @Environment(ShellDashboards.self) private var dashboards
  @Environment(AppModel.self) private var app
  private let path: String

  public init(path: String) {
    self.path = path
  }

  public var body: some View {
    let route = ShellNavigator.route(path)
    let dashboard = route.section == .dashboard ? dashboards.dashboard(route.dashboard) : nil
    let title = ShellNavigator.title(route, dashboardName: dashboard?.name, defenseEnabled: app.flags.defenseEnabled)
    page(route, dashboard: dashboard)
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .modifier(PageChrome(showsBrand: ShellRoutes.parentOf(route) == nil, phone: chrome == .phone))
  }

  @ViewBuilder
  private func page(_ route: AppRoute, dashboard: Dashboard?) -> some View {
    switch route.section {
    case .dashboard:
      if let dashboard {
        UnportedPage(PageHeaderModel(title: dashboard.name, crumbs: [Crumb("Dashboards")]))
      } else {
        // An address that names no dashboard goes to the first (Shell).
        PageLoading("")
      }
    case .reports:
      reports(route.page)
    case .tools:
      tools(route.page)
    case .posting, .intent:
      posting(route.section == .intent ? "compose" : route.page)
    case .defense:
      if app.flags.defenseEnabled {
        defense(route.page)
      } else {
        NotFoundPage()
      }
    case .settings:
      SettingsPage(section: route.page)
    case .missing:
      NotFoundPage()
    }
  }

  @ViewBuilder
  private func reports(_ key: String?) -> some View {
    if let key {
      if let report = ReportsRegistry.reportByKey[key] {
        UnportedPage(PageHeaderModel(title: report.label, sub: report.desc, crumbs: [Crumb("Reports", to: "/reports")]))
      } else {
        VirgaPage(PageHeaderModel(title: "There’s no report called “\(key)”", crumbs: [Crumb("Reports", to: "/reports")])) {
          EmptyView()
        }
      }
    } else {
      UnportedPage(PageHeaderModel(title: "Reports", sub: "Every number Virga works out, one page each."))
    }
  }

  @ViewBuilder
  private func tools(_ key: String?) -> some View {
    if let key {
      if let tool = ToolsRegistry.toolByKey[key], tool.planned != true {
        UnportedPage(PageHeaderModel(title: tool.name, sub: tool.desc, access: [tool.access], crumbs: [Crumb("Tools", to: "/tools")]))
      } else {
        UnbuiltToolPage(tool: ToolsRegistry.toolByKey[key])
      }
    } else {
      UnportedPage(
        PageHeaderModel(title: "Tools", sub: "Small tools for looking after your account. Each says what it can touch before it touches it."))
    }
  }

  /// PostingHeader: Posting in the crumbs (except on the overview), the
  /// page's title and line, and what it touches.
  private func posting(_ key: String?) -> some View {
    let pageKey = key == "compose" ? "hub" : (key ?? "hub")
    let page = PostingRoutes.postingPageByKey[pageKey] ?? PostingRoutes.postingPageByKey["hub"]
    let crumbs = page?.key == "hub" || page == nil ? [] : [Crumb("Posting", to: PostingRoutes.postingBase)]
    return UnportedPage(PageHeaderModel(title: page?.title ?? "Posting", sub: page?.desc, access: page?.access ?? [], crumbs: crumbs))
  }

  @ViewBuilder
  private func defense(_ key: String?) -> some View {
    if let key, key != "scan", let page = DefenseRoutes.defensePageByKey[key] {
      UnportedPage(PageHeaderModel(title: page.title, sub: page.desc, access: ["lists"], crumbs: [Crumb("Defense", to: DefenseRoutes.defenseBase)]))
    } else {
      UnportedPage(
        PageHeaderModel(
          title: "Defense",
          sub:
            "Everyone who engaged with a post, sorted by how close each of them is to you, before anything is done about any of them.",
          access: ["read"]))
    }
  }
}

/// The navigation bar a page has: on a phone, clear over the sky with the
/// mark (or the back button) and the account; beside the sidebar, none.
struct PageChrome: ViewModifier {
  let showsBrand: Bool
  let phone: Bool

  func body(content: Content) -> some View {
    if phone {
      content
        .toolbar { AppBarToolbar(showsBrand: showsBrand) }
        .skyNavigationBar()
    } else {
      content
        .toolbar(.hidden, for: .navigationBar)
    }
  }
}

/// A tool that isn't built (or an address that names none): its header,
/// then the one way on (ToolPage.jsx).
struct UnbuiltToolPage: View {
  @Environment(\.navigate) private var navigate
  let tool: ToolEntry?

  var body: some View {
    let header = PageHeaderModel(
      title: tool.map { "\($0.name) isn’t built yet" } ?? "There’s no tool here", sub: tool?.desc,
      access: tool.map { [$0.access] } ?? [], crumbs: [Crumb("Tools", to: "/tools")])
    return VirgaPage(header) {
      Button("See every tool") { navigate("/tools") }
        .buttonStyle(.virga)
    }
  }
}

/// An address that names nothing: the usual header, and the one way on.
struct NotFoundPage: View {
  @Environment(\.navigate) private var navigate

  var body: some View {
    VirgaPage(PageHeaderModel(title: "There’s nothing at this address", sub: "It may have been a dashboard that was since deleted.")) {
      Button("Go to your dashboard") { navigate("/") }
        .buttonStyle(.virga)
    }
  }
}
#endif
