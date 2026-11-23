// Ports src/dashboards/catalog.js
//
// The report library: every card a dashboard can hold, what it shows, where
// its full report is, and the sizes it can take. The views that draw them
// are VirgaUI's; this list stays free of them so the layout code can check
// a stored dashboard against it. ios/parity/cases/insights-early.catalog.js
// holds the whole table to the web's, every field of every card.

import Foundation
import VirgaCore

/// A group of cards in Customize.
public struct WidgetCategory: Codable, Hashable, Sendable, Identifiable {
  public var key: String
  public var label: String
  public var id: String { key }
  public init(key: String, label: String) {
    self.key = key
    self.label = label
  }
}

/// What the layout code reads of a card's type: the sizes it can take, the
/// one it starts at, and what Customize can set on it. Any type the layout
/// functions check against is one of these (`WidgetDef.rules`, or a
/// registry of the caller's own).
public struct WidgetRules: Codable, Hashable, Sendable {
  public var sizes: [String]?
  public var defaultSize: String?
  public var options: [String]?
  public init(sizes: [String]? = nil, defaultSize: String? = nil, options: [String]? = nil) {
    self.sizes = sizes
    self.defaultSize = defaultSize
    self.options = options
  }
}

/// One card type of the library.
public struct WidgetDef: Codable, Hashable, Sendable, Identifiable {
  /// The type a stored card names (`DashboardCard.type`).
  public var type: String
  public var name: String
  public var desc: String
  /// A `WidgetCategory` key.
  public var category: String
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String
  /// The sizes it can take (keys of `Layouts.sizes`), smallest first.
  public var sizes: [String]
  public var defaultSize: String
  /// Its full report.
  public var href: String
  /// "stat" (a figure) or "card".
  public var kind: String
  /// What Customize can set on it besides its size: "title", "period",
  /// "kind", "rows".
  public var options: [String]

  public var id: String { type }
  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }
  public var rules: WidgetRules { WidgetRules(sizes: sizes, defaultSize: defaultSize, options: options) }

  public init(
    type: String, name: String, desc: String, category: String, icon: String, sizes: [String],
    defaultSize: String, href: String, kind: String = "card", options: [String] = Catalog.periodOptions
  ) {
    self.type = type
    self.name = name
    self.desc = desc
    self.category = category
    self.icon = icon
    self.sizes = sizes
    self.defaultSize = defaultSize
    self.href = href
    self.kind = kind
    self.options = options
  }
}

public enum Catalog {
  public static let categories: [WidgetCategory] = [
    WidgetCategory(key: "followers", label: "Followers"),
    WidgetCategory(key: "engagement", label: "Engagement"),
    WidgetCategory(key: "posts", label: "Posts"),
    WidgetCategory(key: "content", label: "Content"),
    WidgetCategory(key: "people", label: "People"),
    WidgetCategory(key: "blocks", label: "Blocks"),
    WidgetCategory(key: "repo", label: "Repo"),
    WidgetCategory(key: "posting", label: "Posting"),
  ]

  // The sizes of each kind of card.
  static let stat = ["xs", "s"]
  static let chart = ["s", "m", "l", "xl"]
  static let list = ["s", "m", "l", "xl"]

  // What a card can be set to in Customize, besides its size
  // (Layouts.cleanOptions checks a stored card against this). Every card can
  // be given a title. Period cards answer for a period and can keep one of
  // their own; kind cards count engagement and can be narrowed to one kind
  // of it; rows cards are lists and can be told how many rows to show.
  public static let titleOptions = ["title"]
  public static let periodOptions = ["title", "period"]
  static let t = titleOptions
  static let p = periodOptions
  static let pk = ["title", "period", "kind"]
  static let pr = ["title", "period", "rows"]
  static let pkr = ["title", "period", "kind", "rows"]
  static let tr = ["title", "rows"]

  private static func def(
    _ type: String, _ name: String, _ desc: String, _ category: String, _ icon: String, _ sizes: [String],
    _ defaultSize: String, _ href: String, _ kind: String = "card", _ options: [String] = p
  ) -> WidgetDef {
    WidgetDef(
      type: type, name: name, desc: desc, category: category, icon: icon, sizes: sizes,
      defaultSize: defaultSize, href: href, kind: kind, options: options)
  }

  /// Every card type, in the library's order.
  public static let widgetList: [WidgetDef] = [
    // Figures
    def("stat-followers", "Followers", "Everyone following you now", "followers", "UsersRound", stat, "xs", "/reports/followers", "stat", p),
    def("stat-new-followers", "New followers", "Gained in the period, against the one before", "followers", "UserPlus", stat, "xs", "/reports/followers", "stat", p),
    def("stat-unfollows", "Unfollows", "Who left since the last sync", "followers", "UserMinus", stat, "xs", "/tools/unfollow-tracker", "stat", t),
    def("stat-engagement", "Engagement", "Likes, reposts, replies and quotes received", "engagement", "Heart", stat, "xs", "/reports/engagement", "stat", pk),
    def("stat-per-post", "Engagement per post", "Averaged over your posts and threads", "engagement", "Heart", stat, "xs", "/reports/engagement", "stat", pk),
    def("stat-given", "Engagement given", "Likes, reposts, replies and quotes you gave", "engagement", "Repeat2", stat, "xs", "/reports/engagement?direction=given", "stat", pk),
    def("stat-posts", "Posts", "Posts and replies in the period", "posts", "PenLine", stat, "xs", "/reports/posts", "stat", p),
    def("stat-typical-post", "A typical post", "What the middle post of yours earns", "content", "Shapes", stat, "xs", "/reports/content", "stat", p),
    def("stat-alt-text", "Media described", "How many of your pictures and videos have alt text", "content", "Image", stat, "xs", "/reports/content", "stat", p),
    def("stat-blocks", "Blocked by", "Directly or through moderation lists", "blocks", "Ban", stat, "xs", "/reports/blocks", "stat", p),
    def("stat-scheduled", "Scheduled", "Posts waiting to go out, and when the next one does", "posting", "CalendarClock", stat, "xs", "/posting/scheduled", "stat", t),
    def("stat-timers", "Timers", "Post timers counting down", "posting", "Timer", stat, "xs", "/posting/timers", "stat", t),

    // Charts
    def("follower-growth", "Follower growth", "Followers over time, dated by each follow record", "followers", "UserPlus", chart, "l", "/reports/followers"),
    def("new-followers", "New followers", "Gains per day, week or month", "followers", "UserPlus", chart, "m", "/reports/followers"),
    def("engagement-over-time", "Engagement over time", "What each day’s or week’s posts have earned", "engagement", "Heart", chart, "m", "/reports/engagement", "card", pk),
    def("engagement-rate", "Engagement rate", "Engagement per post, posts and threads only", "engagement", "Heart", chart, "m", "/reports/engagement", "card", pk),
    def("engagement-by-type", "Engagement by type", "Likes, reposts, replies and quotes received", "engagement", "Heart", ["s", "m", "l"], "s", "/reports/engagement"),
    def("engagement-given", "Engagement given", "What you hand out, per day or week", "engagement", "Repeat2", chart, "m", "/reports/engagement?direction=given", "card", pk),
    def("posting-cadence", "Posting cadence", "Posts per day or week, with the trend", "posts", "PenLine", chart, "m", "/reports/posts"),
    def("best-time", "Best time to post", "What a typical post earns, by weekday and hour", "posts", "Clock", ["m", "l", "xl"], "m", "/tools/best-time"),
    def("content-formats", "Formats", "What a typical post earns, by what it carries", "content", "Shapes", ["s", "m", "l"], "m", "/reports/content"),
    def("content-length", "Post length", "What a typical post earns, by how long it is", "content", "Ruler", ["s", "m", "l"], "s", "/reports/content"),
    def("blocks-over-time", "Blocks over time", "Block reach, direct and through lists", "blocks", "Ban", chart, "m", "/reports/blocks"),
    def("repo-activity", "Repo activity", "Records written per day or week, every app", "repo", "Cloud", chart, "m", "/reports/atmosphere"),

    // Lists
    def("top-posts", "Top posts", "Your posts, ranked by engagement", "posts", "PenLine", list, "m", "/reports/engagement", "card", pkr),
    def("top-tags", "Tags", "The tags you use, and what posts with them earn", "content", "Hash", list, "m", "/reports/content", "card", pr),
    def("top-links", "Sites you link to", "Where your links go, and what those posts earn", "content", "Link2", list, "m", "/reports/content", "card", pr),
    def("top-engagers", "Top engagers", "Who interacts with you the most", "people", "MessagesSquare", list, "m", "/reports/people", "card", pkr),
    def("you-engage-with", "You engage with", "The accounts you interact with the most", "people", "Repeat2", list, "m", "/reports/people", "card", pkr),
    def("follow-back", "Follow-back queue", "Followers who engage, that you don’t follow", "people", "UserPlus", list, "m", "/tools/follow-back", "card", pr),
    def("newest-followers", "Newest followers", "The latest people to follow you", "followers", "UserPlus", list, "m", "/reports/followers", "card", pr),
    def("unfollows", "Unfollows between syncs", "Who left, and when it was noticed", "followers", "UserMinus", list, "s", "/tools/unfollow-tracker", "card", tr),
    def("lists-on", "Lists you’re on", "Moderation and curation lists that include you", "blocks", "Shield", list, "m", "/tools/lists", "card", tr),
    def("repo-collections", "Records by collection", "Every app that writes to your repo", "repo", "Database", list, "m", "/reports/atmosphere", "card", pr),
    def("posting-next", "Going out next", "Your scheduled and queued posts, soonest first", "posting", "CalendarClock", list, "m", "/posting/scheduled", "card", tr),
    def("posting-drafts", "Latest drafts", "Drafts waiting on your Bluesky account", "posting", "FileText", list, "m", "/posting/drafts", "card", tr),
  ]

  /// Every card type by its `type` (the web's WIDGETS).
  public static let widgets: [String: WidgetDef] =
    Dictionary(widgetList.map { ($0.type, $0) }, uniquingKeysWith: { _, last in last })

  /// The library as the layout code checks against it.
  public static let widgetRules: [String: WidgetRules] = widgets.mapValues(\.rules)

  /// The report library's list under its search and kind (DashboardPage.jsx's
  /// Library `shown`): a kind of "all" keeps every kind; the trimmed query,
  /// lower-cased, is a plain substring of the lower-cased name or of the
  /// lower-cased description, each on its own. Nothing is folded, so
  /// "dont" doesn't find "don’t", and a query can't run from the name into
  /// the description.
  public static func libraryMatches(query: String, category: String) -> [WidgetDef] {
    let q = query.jsTrimmed().jsLowercased()
    return widgetList.filter { w in
      (category.jsEquals("all") || w.category.jsEquals(category))
        && (q.isEmpty || w.name.jsLowercased().jsIndexOf(q) != -1 || w.desc.jsLowercased().jsIndexOf(q) != -1)
    }
  }
}
