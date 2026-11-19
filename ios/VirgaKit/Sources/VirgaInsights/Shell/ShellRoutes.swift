// Ports src/shell/routes.js
//
// Which page an address names. The shell renders from it: on iOS the
// address is the shell's navigation state (VirgaUI), and this is what it
// means. The table of addresses is at the top of VirgaCore's Router.swift.
// ios/parity/cases/insights-early.routes.js holds every function here to
// the web's, over well-formed, malformed and percent-encoded addresses.

import Foundation
import VirgaCore

/// The page an address names. Which members mean anything depends on the
/// section, as on the web: a dashboard's `dashboard` (nil for the first
/// one), a section's `page` (nil for its front page), and a posting page's
/// `id` (the part after the page). It encodes to the web's object for its
/// section, key for key.
public struct AppRoute: Hashable, Sendable {
  public enum Section: String, Codable, Hashable, Sendable, CaseIterable {
    case dashboard, reports, tools, settings, posting, defense, intent, missing
  }

  public var section: Section
  public var dashboard: String?
  public var page: String?
  public var id: String?

  public init(section: Section, dashboard: String? = nil, page: String? = nil, id: String? = nil) {
    self.section = section
    self.dashboard = dashboard
    self.page = page
    self.id = id
  }

  public static let missing = AppRoute(section: .missing)
}

extension AppRoute: Codable {
  enum CodingKeys: String, CodingKey { case section, dashboard, page, id }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    section = try c.decode(Section.self, forKey: .section)
    dashboard = try c.decodeIfPresent(String.self, forKey: .dashboard)
    page = try c.decodeIfPresent(String.self, forKey: .page)
    id = try c.decodeIfPresent(String.self, forKey: .id)
  }

  /// The keys parseRoute's object has for the section, null where empty.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(section, forKey: .section)
    switch section {
    case .dashboard:
      try c.encode(dashboard, forKey: .dashboard)
    case .reports, .tools, .settings, .defense, .intent:
      try c.encode(page, forKey: .page)
    case .posting:
      try c.encode(page, forKey: .page)
      try c.encode(id, forKey: .id)
    case .missing:
      break
    }
  }
}

/// The way up from a route: a label and an address.
public struct ParentLink: Codable, Hashable, Sendable {
  public var label: String
  public var to: String
  public init(label: String, to: String) {
    self.label = label
    self.to = to
  }
}

public enum ShellRoutes {
  /// The page `path` names. Throws `JSURIError` ("URI malformed") for an
  /// address `decodeURIComponent` can't read, as the web does.
  public static func parseRoute(_ path: String?) throws -> AppRoute {
    let parts = try Router.pathParts(path)
    guard let section = parts.first else { return AppRoute(section: .dashboard) }
    let page = parts.count > 1 ? parts[1] : nil
    switch section {
    case "dashboard":
      return AppRoute(section: .dashboard, dashboard: page)
    case "reports":
      return AppRoute(section: .reports, page: page)
    case "tools":
      return AppRoute(section: .tools, page: page)
    case "settings":
      return AppRoute(section: .settings, page: page)
    case "posting":
      guard let posting = PostingRoutes.parsePostingRoute(parts: parts) else { return .missing }
      return AppRoute(section: .posting, page: posting.key, id: posting.id)
    case "defense":
      guard let defense = DefenseRoutes.parseDefenseRoute(parts) else { return .missing }
      return AppRoute(section: .defense, page: defense.key == "scan" ? nil : defense.key)
    case "intent" where page == "compose" && parts.count == 2:
      return AppRoute(section: .intent, page: "compose")
    default:
      return .missing
    }
  }

  /// Each section's title, for the tab and the phone's app bar.
  public static let sectionTitle: [AppRoute.Section: String] = [
    .dashboard: "Dashboards",
    .reports: "Reports",
    .tools: "Tools",
    .settings: "Settings",
    .posting: "Posting",
    .defense: "Defense",
    .intent: "Posting",
    .missing: "Not found",
  ]

  /// Whether a route's page needs a built archive (until there is one, it
  /// shows the first run). Posting never does: it opens before the archive
  /// does, and the Posted page waits for the archive by itself. Defense
  /// does: a scan's canary is picked from the archive's follows.
  public static func needsArchive(_ route: AppRoute) -> Bool {
    switch route.section {
    case .dashboard, .reports, .defense: return true
    case .tools: return !(route.page ?? "").isEmpty
    default: return false
    }
  }

  /// Whether a route renders before the archive has opened. Posting and
  /// compose links don't read the archive, so they don't wait on it.
  public static func opensBeforeArchive(_ route: AppRoute) -> Bool {
    route.section == .posting || route.section == .intent
  }

  /// The way up from a route, for the back link that takes the logo's place
  /// in the phone's app bar, or nil on a part's own front page (a
  /// dashboard, Reports, Posting, Tools, Defense, Settings), which the tab
  /// bar already reaches. The weekly schedule is reached from Scheduled
  /// posts, so that is where it goes back to.
  public static func parentOf(_ route: AppRoute?) -> ParentLink? {
    guard let route, let page = route.page, !page.isEmpty else { return nil }
    switch route.section {
    case .reports, .tools, .settings, .defense:
      return ParentLink(label: sectionTitle[route.section]!, to: "/\(route.section.rawValue)")
    case .posting where page != "hub":
      if page == "schedule", let scheduled = PostingRoutes.postingPageByKey["scheduled"] {
        return ParentLink(label: scheduled.title, to: scheduled.path)
      }
      return ParentLink(label: sectionTitle[.posting]!, to: PostingRoutes.postingBase)
    default:
      return nil
    }
  }

  /// The title of a posting route, for the tab and the phone's app bar; nil
  /// outside posting.
  public static func postingTitle(_ route: AppRoute) -> String? {
    guard route.section == .posting else { return nil }
    if route.page == "compose" || route.page == "hub" { return "Posting" }
    let title = route.page.flatMap { PostingRoutes.postingPageByKey[$0]?.title } ?? ""
    return title.isEmpty ? "Posting" : title
  }
}
