// Ports src/tools/registry.js
//
// The tools, grouped as the Tools page shows them. `access` says what each
// can touch: "read" (only reads), "follow" (uses the follow permission the
// sign-in already asks for), or "ask" (would need a permission Virga
// doesn't ask for today, so it isn't built). Writing and scheduling posts
// is a section of its own (PostingRoutes), not a tool.
// ios/parity/cases/insights-early.registries.js holds the tables to the
// web's, word for word.

import Foundation

/// A group of tools on the Tools page.
public struct ToolSection: Codable, Hashable, Sendable, Identifiable {
  public var key: String
  public var title: String
  public var desc: String
  public var id: String { key }
  public init(key: String, title: String, desc: String) {
    self.key = key
    self.title = title
    self.desc = desc
  }
}

/// One tool.
public struct ToolEntry: Codable, Hashable, Sendable, Identifiable {
  /// Its address is /tools/<key>.
  public var key: String
  public var name: String
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String
  /// A `ToolSection` key.
  public var section: String
  /// A key of `AccessBadge.access`.
  public var access: String
  /// True for one that isn't built (the palette leaves it out); nil otherwise.
  public var planned: Bool?
  public var desc: String

  public var id: String { key }
  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }

  public init(
    key: String, name: String, icon: String, section: String, access: String, planned: Bool? = nil, desc: String
  ) {
    self.key = key
    self.name = name
    self.icon = icon
    self.section = section
    self.access = access
    self.planned = planned
    self.desc = desc
  }
}

public enum ToolsRegistry {
  public static let toolSections: [ToolSection] = [
    ToolSection(key: "tidy", title: "Tidy up", desc: "Keep your follows and followers in order."),
    ToolSection(key: "understand", title: "Understand", desc: "Answers to the questions the charts raise."),
    ToolSection(key: "data", title: "Your data", desc: "What Virga keeps in this browser, and how to take it with you."),
    ToolSection(key: "later", title: "Later", desc: "Ideas that need more than Virga asks for today. Each would ask you first."),
  ]

  public static let tools: [ToolEntry] = [
    ToolEntry(key: "follow-cleanup", name: "Follow cleanup", icon: "UserMinus", section: "tidy", access: "follow", desc: "Find accounts you follow that went quiet, are gone, or don’t follow back, and unfollow in bulk."),
    ToolEntry(key: "unfollow-tracker", name: "Unfollow tracker", icon: "UserX", section: "tidy", access: "read", desc: "See who unfollowed you between two syncs, and who arrived."),
    ToolEntry(key: "follow-back", name: "Follow-back queue", icon: "UserPlus", section: "tidy", access: "follow", desc: "People who follow you and engage with your posts, that you don’t follow yet."),
    ToolEntry(key: "best-time", name: "Best time to post", icon: "Clock", section: "understand", access: "read", desc: "When your posts earn the most, by weekday and hour, from your own history."),
    ToolEntry(key: "lists", name: "Lists you’re on", icon: "Shield", section: "understand", access: "read", desc: "Every list that includes you, with moderation lists and their subscribers flagged."),
    ToolEntry(key: "interaction-lookup", name: "Interaction lookup", icon: "UsersRound", section: "understand", access: "read", desc: "Your whole history with one account: likes, replies and follows, both ways."),
    ToolEntry(key: "archive", name: "Archive search and export", icon: "Archive", section: "data", access: "read", desc: "Search every post you’ve made and download it as JSON or CSV."),
    ToolEntry(key: "identity", name: "Identity inspector", icon: "FingerprintPattern", section: "data", access: "read", desc: "Your DID, your PDS, your handle history and what each app writes to your repo."),
    ToolEntry(key: "list-manager", name: "List manager", icon: "List", section: "later", access: "ask", planned: true, desc: "Keep a Bluesky list in step with a filter, such as mutuals you talk to every week."),
  ]

  public static let toolByKey: [String: ToolEntry] =
    Dictionary(tools.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })

  /// What each tool can touch (re-exported, as the web's registry does).
  public static var access: [String: AccessKind] { AccessBadge.access }
}
