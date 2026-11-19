// Ports src/reports/registry.js
//
// The reports, in the order the sidebar lists them. A report's icon is the
// one its figures and cards carry on a dashboard (Catalog.swift), so the
// same thing has one glyph everywhere: UsersRound is followers, UserPlus is
// new ones gained. ios/parity/cases/insights-early.registries.js holds the
// table to the web's, word for word.

import Foundation

/// One report.
public struct ReportEntry: Codable, Hashable, Sendable, Identifiable {
  /// Its address is /reports/<key>.
  public var key: String
  public var label: String
  /// The lucide icon's name; `sfSymbol` is what the views draw.
  public var icon: String
  public var desc: String

  public var id: String { key }
  public var sfSymbol: String { Icons.sfSymbol(lucide: icon) }

  public init(key: String, label: String, icon: String, desc: String) {
    self.key = key
    self.label = label
    self.icon = icon
    self.desc = desc
  }
}

public enum ReportsRegistry {
  public static let reports: [ReportEntry] = [
    ReportEntry(key: "followers", label: "Followers", icon: "UsersRound", desc: "Growth over time, new followers, and who is newest."),
    ReportEntry(key: "blocks", label: "Blocks", icon: "Ban", desc: "Who blocks you, directly or through moderation lists."),
    ReportEntry(key: "posts", label: "Posts", icon: "PenLine", desc: "How often you post, and how much of it is replies and media."),
    ReportEntry(key: "content", label: "Content", icon: "Shapes", desc: "What your posts are made of, and which kinds do best: format, length, tags and links."),
    ReportEntry(key: "engagement", label: "Engagement", icon: "Heart", desc: "What your posts earn, the rate per post, and what you give."),
    ReportEntry(key: "people", label: "People", icon: "MessagesSquare", desc: "Who engages with you, and who you engage with."),
    ReportEntry(key: "atmosphere", label: "Atmosphere", icon: "Cloud", desc: "Every record every app has written to your repo."),
  ]

  public static let reportByKey: [String: ReportEntry] =
    Dictionary(reports.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
}
