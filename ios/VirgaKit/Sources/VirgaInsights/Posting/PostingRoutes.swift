// Ports src/posting/routes.js
//
// The posting section's pages and how an address names one. The shell asks
// parsePostingRoute which page a /posting address is; the posting views
// render it; the sidebar, the tab bar and the overview list the pages from
// here.
//
// `needsBackend` marks the pages whose work happens on Virga's server
// (scheduled posts, the weekly queue, timers). `access` is what each page
// can touch (keys of AccessBadge.access), which the page header says under
// the page's sub. `pinned` lists a page under Posting in the sidebar, after
// the overview. ios/parity/cases/insights-early.routes.js holds the table
// to the web's, word for word.

import Foundation
import VirgaCore

/// One page of the posting section.
public struct PostingPage: Codable, Hashable, Sendable, Identifiable {
  public var key: String
  public var path: String
  /// What the sidebar, the tab bar and the palette call it.
  public var label: String
  /// The page's own title.
  public var title: String
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String
  public var needsBackend: Bool
  public var pinned: Bool
  /// Keys of `AccessBadge.access`.
  public var access: [String]
  public var desc: String

  public var id: String { key }
  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }

  public init(
    key: String, path: String, label: String, title: String, icon: String,
    needsBackend: Bool, pinned: Bool, access: [String], desc: String
  ) {
    self.key = key
    self.path = path
    self.label = label
    self.title = title
    self.icon = icon
    self.needsBackend = needsBackend
    self.pinned = pinned
    self.access = access
    self.desc = desc
  }
}

/// The page a /posting address names: `{ key, id }`, where `id` is the part
/// after the page (/posting/drafts/<id>), or nil. The composer is
/// `{ key: "compose", id: nil }`.
public struct PostingRoute: Codable, Hashable, Sendable {
  public var key: String
  public var id: String?

  public init(key: String, id: String? = nil) {
    self.key = key
    self.id = id
  }

  enum CodingKeys: String, CodingKey { case key, id }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    key = try c.decode(String.self, forKey: .key)
    id = try c.decodeIfPresent(String.self, forKey: .id)
  }

  /// As the web writes it: `id` is always there, null when there's none.
  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(key, forKey: .key)
    try c.encode(id, forKey: .id)
  }
}

public enum PostingRoutes {
  public static let postingBase = "/posting"

  public static let postingPages: [PostingPage] = [
    PostingPage(
      key: "hub",
      path: "/posting",
      label: "Overview",
      title: "Posting",
      icon: "SquarePen",
      needsBackend: false,
      pinned: false,
      access: ["post"],
      desc: "Write a post or a thread, pick up a draft, and see what’s going out."
    ),
    PostingPage(
      key: "drafts",
      path: "/posting/drafts",
      label: "Drafts",
      title: "Drafts",
      icon: "FileText",
      needsBackend: false,
      pinned: true,
      access: ["post"],
      desc: "Posts you’ve started, kept as private drafts on your Bluesky account."
    ),
    PostingPage(
      key: "scheduled",
      path: "/posting/scheduled",
      label: "Scheduled",
      title: "Scheduled posts",
      icon: "CalendarClock",
      needsBackend: true,
      pinned: true,
      access: ["post", "server"],
      desc: "Posts waiting to go out, and the queue they go out from."
    ),
    PostingPage(
      key: "schedule",
      path: "/posting/schedule",
      label: "Weekly schedule",
      title: "Weekly schedule",
      icon: "CalendarRange",
      needsBackend: true,
      pinned: true,
      access: ["server"],
      desc: "The times each week that a post added to the queue goes out."
    ),
    PostingPage(
      key: "timers",
      path: "/posting/timers",
      label: "Timers",
      title: "Post timers",
      icon: "Timer",
      needsBackend: true,
      pinned: true,
      access: ["post", "server"],
      desc: "Posts set to delete themselves after a while, or when something happens."
    ),
    PostingPage(
      key: "posted",
      path: "/posting/posted",
      label: "Posted",
      title: "Posted",
      icon: "Send",
      needsBackend: false,
      pinned: true,
      access: ["post"],
      desc: "Everything you’ve posted."
    ),
    PostingPage(
      key: "templates",
      path: "/posting/templates",
      label: "Templates",
      title: "Templates",
      icon: "LayoutTemplate",
      needsBackend: false,
      pinned: true,
      access: ["post"],
      desc: "Posts and replies to start from, saved in your repo where anyone can read them."
    ),
    PostingPage(
      key: "library",
      path: "/posting/library",
      label: "Library",
      title: "Library",
      icon: "Library",
      needsBackend: false,
      pinned: true,
      access: ["post"],
      desc: "Your posts, saved posts, links, feeds and lists, ready to quote or attach."
    ),
  ]

  public static let postingPageByKey: [String: PostingPage] =
    Dictionary(postingPages.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })

  /// The address of a posting page by its key ("hub" is /posting); the
  /// section's own address for a key that names no page.
  public static func postingPath(_ key: String?) -> String {
    key.flatMap { postingPageByKey[$0]?.path } ?? postingBase
  }

  /// Which posting page `path` names: a page and the id after it, the
  /// composer for /posting/compose, or nil when the address isn't in the
  /// posting section or names no page. Throws `JSURIError` where the path
  /// can't be decoded, as `pathParts` does.
  public static func parsePostingRoute(_ path: String?) throws -> PostingRoute? {
    parsePostingRoute(parts: try Router.pathParts(path))
  }

  /// `parsePostingRoute` for a path already split into its parts.
  ///
  /// The web looks a page up in a plain object, which also "finds" the
  /// names Object.prototype carries ("/posting/constructor" names a page
  /// there). Only the table's own keys name a page here.
  public static func parsePostingRoute(parts: [String]) -> PostingRoute? {
    guard parts.first == "posting" else { return nil }
    let page = parts.count > 1 ? parts[1] : nil
    let id = parts.count > 2 ? parts[2] : nil
    guard let page, !page.isEmpty else { return PostingRoute(key: "hub", id: nil) }
    if page == "compose" { return parts.count == 2 ? PostingRoute(key: "compose", id: nil) : nil }
    if page == "hub" || postingPageByKey[page] == nil { return nil }
    if parts.count > 3 { return nil }
    return PostingRoute(key: page, id: id)
  }
}
