// Ports src/lib/router.jsx (usePath, navigate)
// Ports src/shell/routes.js (as the shell uses it: the route, the way up, the titles)
//
// The app's addresses: the path is the state, as on the web. The navigator
// holds the address a window shows (`/reports/followers`), moves it
// (`navigate`, which is Router.hrefFor's: the query is carried along unless
// the new address has one or `keepQuery` is false) and says what it means
// (ShellRoutes.parseRoute: a malformed escape is the page that names
// nothing, where the web would throw).
//
// On a phone the address is also a NavigationStack's path: the front page
// of its part at the root, and the pages above it (ShellRoutes.parentOf,
// followed up) pushed over it, so the system's back button and its swipe
// say "‹ Reports" and go there. `stack` is that path; setting it (a swipe
// back) moves the address to the page that is left on top.
//
// A new page plugs in by its address: RoutedPage (RoutedPage.swift) maps
// each route to its view.

#if canImport(UIKit)
import Foundation
import Observation
import VirgaCore
import VirgaInsights

@MainActor
@Observable
public final class ShellNavigator {
  /// The path (`/reports/followers`), as `location.pathname`.
  public private(set) var path: String
  /// The query, with its `?`, or "" (`location.search`).
  public private(set) var search: String
  /// The fragment, with its `#`, or "".
  public private(set) var hash: String

  public init(_ address: String = "/") {
    let parts = Self.split(address)
    path = parts.path
    search = parts.search
    hash = parts.hash
  }

  /// The whole address.
  public var address: String { path + search + hash }

  /// The page the path names.
  public var route: AppRoute { Self.route(path) }

  /// `parseRoute(path)`, with a path that can't be read as the page that
  /// names nothing (WEB-BUGS: the web throws while rendering).
  public static func route(_ path: String) -> AppRoute {
    (try? ShellRoutes.parseRoute(path)) ?? .missing
  }

  /// `navigate(to, { replace, keepQuery })`. The app has no history to
  /// replace in: a phone's stack follows the address either way.
  public func navigate(_ to: String, keepQuery: Bool = true) {
    let href = Router.hrefFor(to, currentSearch: search, keepQuery: keepQuery)
    let parts = Self.split(href)
    path = parts.path.isEmpty ? "/" : parts.path
    search = parts.search
    hash = parts.hash
  }

  static func split(_ address: String) -> (path: String, search: String, hash: String) {
    var rest = address
    var hash = ""
    let at = rest.jsIndexOf("#")
    if at != -1 {
      hash = rest.jsSlice(at)
      rest = rest.jsSlice(0, at)
    }
    var search = ""
    let q = rest.jsIndexOf("?")
    if q != -1 {
      search = rest.jsSlice(q)
      rest = rest.jsSlice(0, q)
    }
    return (rest.isEmpty ? "/" : rest, search, hash)
  }

  // MARK: The phone's stack

  /// The addresses from the front page of the path's part to the path
  /// itself: parentOf followed up (the weekly schedule sits over Scheduled
  /// posts, which sits over Posting).
  public static func chain(_ path: String) -> [String] {
    var out = [path]
    var route = Self.route(path)
    var seen: Set<String> = [path]
    while let parent = ShellRoutes.parentOf(route), !seen.contains(parent.to) {
      out.insert(parent.to, at: 0)
      seen.insert(parent.to)
      route = Self.route(parent.to)
    }
    return out
  }

  /// The front page under the stack.
  public var stackRoot: String { Self.chain(path).first ?? path }

  /// The pages pushed over it.
  public var stack: [String] {
    get { Array(Self.chain(path).dropFirst()) }
    set {
      // A swipe or the back button: the page left on top is the address.
      let next = newValue.last ?? stackRoot
      if !next.jsEquals(path) { navigate(next, keepQuery: false) }
    }
  }

  // MARK: Titles

  /// Shell.jsx's title for the page the path names: the tab's, and what the
  /// back button says on the page above.
  public static func title(_ route: AppRoute, dashboardName: String?, defenseEnabled: Bool) -> String {
    switch route.section {
    case .dashboard:
      return dashboardName ?? "Dashboard"
    case .reports where route.page != nil:
      return route.page.flatMap { ReportsRegistry.reportByKey[$0]?.label } ?? "Reports"
    case .tools where route.page != nil:
      return route.page.flatMap { ToolsRegistry.toolByKey[$0]?.name } ?? "Tools"
    case .posting:
      return ShellRoutes.postingTitle(route) ?? "Posting"
    case .defense where route.page != nil:
      let page = route.page.flatMap { DefenseRoutes.defensePageByKey[$0] }
      return "\(page?.title ?? "Defense") · Defense"
    default:
      return ShellRoutes.sectionTitle[route.section] ?? ""
    }
  }
}
#endif
